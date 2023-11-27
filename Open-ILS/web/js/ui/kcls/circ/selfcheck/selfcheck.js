dojo.require('dojo.date.locale');
dojo.require('dojo.date.stamp');
dojo.require('dijit.form.CheckBox');
dojo.require('dijit.form.NumberSpinner');
dojo.require('openils.CGI');
dojo.require('openils.Util');
dojo.require('openils.User');
dojo.require('openils.Event');
dojo.require('openils.widget.ProgressDialog');
dojo.require('openils.widget.OrgUnitFilteringSelect');

dojo.requireLocalization('openils.circ', 'selfcheck');
var localeStrings = dojo.i18n.getLocalization('openils.circ', 'selfcheck');

// set patron timeout default
var patronTimeout = 160000; /* 2 minutes, 40 seconds */
var timerId = null;
// 20 second inactivity warning; total default timeout is 3 minutes.
var patronTimeoutWarning = 20000; 
var selfckWarningSetup = false;
var selfckWarningTimer;
var selfCheckManager;

var seenBarcodes = {};

var selfCheckMgr;
var itemsOutCirc = [];
var itemsOutMod = [];
var itemsOutCopy = [];
var readyHolds = false;

// Rest on the Thank You page this many ms.
var thankYouPageTimeout = 5000;

// Ignore duplicate barcode scans that happen within this many ms.
// Dupe scans that happen farther apart result in a patron warning.
var dblScanWarnTimeout = 2000;

const SET_BARCODE_REGEX = 'opac.barcode_regex';
const SET_PATRON_TIMEOUT = 'circ.selfcheck.patron_login_timeout';
const SET_AUTO_OVERRIDE_EVENTS = 'circ.selfcheck.auto_override_checkout_events';
const SET_PATRON_PASSWORD_REQUIRED = 'circ.selfcheck.patron_password_required';
const SET_AUTO_RENEW_INTERVAL = 'circ.checkout_auto_renew_age';
const SET_WORKSTATION_REQUIRED = 'circ.selfcheck.workstation_required';
const SET_ALERT_POPUP = 'circ.selfcheck.alert.popup';
const SET_ALERT_SOUND = 'circ.selfcheck.alert.sound';
const SET_CC_PAYMENT_ALLOWED = 'credit.payments.allow';
// This setting only comes into play if COPY_NOT_AVAILABLE is in the SET_AUTO_OVERRIDE_EVENTS list
const SET_BLOCK_CHECKOUT_ON_COPY_STATUS = 'circ.selfcheck.block_checkout_on_copy_status';

// set before the login dialog is rendered
openils.User.default_login_agent = 'selfcheck';

// start the logout timer
function selfckStartTimer(noWarning) {
    timerId = setTimeout(
        function() {
            if (noWarning) {
                selfCheckMgr.logoutPatron();
            } else {
                selfckLogoutWarning();
            }
        },
        patronTimeout
    );
}

// reset the logout timer
function selfckResetTimer() {
    console.log('clearing login timer');
    clearTimeout(timerId);
    if (!selfCheckManager) return;
    console.log('Starting new login timer');
            
    // do not show a warning dialog if the inactivity timeout
    // occurs between entering a barcode and password.
    selfckStartTimer(!Boolean(selfCheckManager.patron));
}

function selfckLogoutWarning() {

    // connect the logout warning dialog button handlers if needed
    if (!selfckWarningSetup) {
        selfckWarningSetup = true;

        dojo.connect(oilsSelfckLogout, 'onClick',
            function() {
                clearTimeout(selfckWarningTimer);
                oilsSelfckLogoutDialog.hide();
                selfCheckMgr.logoutPatron();
            }
        );

        dojo.connect(oilsSelfckContinue, 'onClick',
            function() {
                clearTimeout(selfckWarningTimer);
                oilsSelfckLogoutDialog.hide();
                selfckResetTimer();
                selfckScanBox.focus();
            }
        );
    }

    // warn the patron of imminent logout
    oilsSelfckLogoutDialog.show();

    // avoid focusing any of the warning dialog buttons.
    setTimeout(function(){selfckScanBox.focus()}, 500);

    selfckWarningTimer = setTimeout(
        function() {
            // no action was taken, force a logout
            oilsSelfckLogoutDialog.hide();
            selfCheckMgr.logoutPatron();
        },
        patronTimeoutWarning
    );
}

function SelfCheckManager() {
    selfCheckMgr = this;
    switchTo('step1');

    this.timer = null;
    this.cgi = new openils.CGI();
    this.staff = null; 
    this.workstation = null;
    this.authtoken = null;
    this.fail_count = 0;

    this.patron = null; 
    this.patronBarcodeRegex = null;

    this.checkouts = [];
    this.itemsOut = [];
    this.holdsArray = [];

    // During renewals, keep track of the ID of the previous circulation.
    // Previous circ is used for tracking failed renewals (for receipts).
    this.prevCirc = null;

    // current item barcode
    this.itemBarcode = null; 

    // are we currently performing a renewal?
    this.isRenewal = false; 

    // dict of org unit settings for "here"
    this.orgSettings = {};

    // Construct a mock checkout for debugging purposes
    if(this.mockCheckouts = this.cgi.param('mock-circ')) {

        this.mockCheckout = {
            payload : {
                record : new fieldmapper.mvr(),
                copy : new fieldmapper.acp(),
                circ : new fieldmapper.circ()
            }
        };

        this.mockCheckout.payload.record.title('Jazz improvisation for guitar');
        this.mockCheckout.payload.record.author('Wise, Les');
        this.mockCheckout.payload.record.isbn('0634033565');
        this.mockCheckout.payload.copy.barcode('123456789');
        this.mockCheckout.payload.circ.renewal_remaining(1);
        this.mockCheckout.payload.circ.parent_circ(1);
        this.mockCheckout.payload.circ.due_date('2012-12-21');
    }

    this.initPrinter();
}


/**
 * Fetch the org-unit settings, initialize the display, etc.
 */
SelfCheckManager.prototype.init = function() {
    this.staff = openils.User.user;
    this.workstation = openils.User.workstation;
    this.authtoken = openils.User.authtoken;
    this.loadOrgSettings();

    this.circTbody = dojo.byId('oils-selfck-circ-tbody');
    this.itemsOutTbody = dojo.byId('oils-selfck-circ-out-tbody');

    // workstation is required but none provided
    if(this.orgSettings[SET_WORKSTATION_REQUIRED] && !this.workstation) {
        if(confirm(dojo.string.substitute(localeStrings.WORKSTATION_REQUIRED))) {
            this.registerWorkstation();
        }
        return;
    }

    var self = this;
    // connect onclick handlers to the various navigation links
    var linkHandlers = {
        'oils-selfck-hold-details-link' : function() { self.drawHoldsPage(); },
        'oils-selfck-view-fines-link' : function() {
            self.drawFinesPage();
        },
        'oils-selfck-nav-logout' : function() { self.logoutPatron(); },
        'oils-selfck-nav-logout-print' : function() { self.logoutPatron(true); },
        'oils-selfck-nav-logout-email' : function() { self.logoutPatron(false, true); },
        'oils-selfck-items-out-details-link' : function() { self.drawItemsOutPage(); },
        'oils-selfck-items-out-renew-details-link' : function() { self.drawItemsOutPage(); },
        'scko-contrast-toggle-button' : function() {
            if(dojo.byId('scko-contrast-toggle').innerHTML == "Turn off High Contrast Mode") {
                dojo.byId('scko-contrast-toggle').innerHTML = "Turn on High Contrast Mode";
            } else {
                dojo.byId('scko-contrast-toggle').innerHTML = "Turn off High Contrast Mode";
            }
        }
    }

    for(var id in linkHandlers) {
        dojo.connect(dojo.byId(id), 'onclick', linkHandlers[id]);
    }

    // High-contrast mode applied by URL.  Swap the style sheets
    // then hide the button.
    if (this.cgi.param('high-contrast')) {
        dojo.byId('scko-contrast-toggle-button').click();
        openils.Util.hide('scko-contrast-toggle-button');
    }


    if(this.cgi.param('patron')) {
        
        // Patron barcode via cgi param.  Mainly used for debugging and
        // only works if password is not required by policy
        this.loginPatron(this.cgi.param('patron'), this.cgi.param('password'));

    } else {
        this.drawLoginPage();
    }

    /**
     * To test printing, pass a URL param of 'testprint'.  The value for the param
     * should be a JSON string like so:  [{circ:<circ_id>}, ...]
     */
    var testPrint = this.cgi.param('testprint');
    if(testPrint) {
        this.checkouts = JSON2js(testPrint);
        this.printSessionReceipt();
        this.checkouts = [];
    }
}


/**
 * Registers a new workstion
 */
SelfCheckManager.prototype.registerWorkstation = function() {
    
    oilsSelfckWsDialog.show();

    new openils.User().buildPermOrgSelector(
        'REGISTER_WORKSTATION',
        oilsSelfckWsLocSelector,
        this.staff.home_ou()
    );


    var self = this;
    dojo.connect(oilsSelfckWsSubmit, 'onClick',

        function() {
            oilsSelfckWsDialog.hide();
            var name = oilsSelfckWsLocSelector.attr('displayedValue') +
                '-' + oilsSelfckWsName.attr('value');

            var res = fieldmapper.standardRequest(
                ['open-ils.actor', 'open-ils.actor.workstation.register'],
                { params : [
                        self.authtoken, name, oilsSelfckWsLocSelector.attr('value')
                    ]
                }
            );

            if(evt = openils.Event.parse(res)) {
                if(evt.textcode == 'WORKSTATION_NAME_EXISTS') {
                    if(confirm(localeStrings.WORKSTATION_EXISTS)) {
                        location.href = location.href.replace(/\?.*/, '') + '?ws=' + name;
                    } else {
                        self.registerWorkstation();
                    }
                    return;
                } else {
                    alert(evt);
                }
            } else {
                location.href = location.href.replace(/\?.*/, '') + '?ws=' + name;
            }
        }
    );
}

/**
 * Loads the org unit settings
 */
SelfCheckManager.prototype.loadOrgSettings = function() {

    var settings = fieldmapper.aou.fetchOrgSettingBatch(
        this.staff.ws_ou(), [
            SET_BARCODE_REGEX,
            SET_PATRON_TIMEOUT,
            SET_ALERT_POPUP,
            SET_ALERT_SOUND,
            SET_AUTO_OVERRIDE_EVENTS,
            SET_BLOCK_CHECKOUT_ON_COPY_STATUS,
            SET_PATRON_PASSWORD_REQUIRED,
            SET_AUTO_RENEW_INTERVAL,
            SET_WORKSTATION_REQUIRED,
            SET_CC_PAYMENT_ALLOWED
        ]
    );

    for(k in settings) {
        if(settings[k])
            this.orgSettings[k] = settings[k].value;
    }

    if(settings[SET_BARCODE_REGEX])
        this.patronBarcodeRegex = new RegExp(settings[SET_BARCODE_REGEX].value);

    // Subtract the timeout warning interval from the configured timeout
    // so that when taken together they add up to the configured amount.
    if(settings[SET_PATRON_TIMEOUT]) {
        patronTimeout = 
            (parseInt(settings[SET_PATRON_TIMEOUT].value) * 1000)
            - patronTimeoutWarning;
    }
}

SelfCheckManager.prototype.drawLoginPage = function() {
    var self = this;
    var bcHandler = function(barcode) {
        // handle patron barcode entry


        if(self.orgSettings[SET_PATRON_PASSWORD_REQUIRED]) {

            // password is required.  wire up the scan box to read it
            self.updateScanBox({
                msg : 'Please enter your password', // TODO i18n 
                handler : function(pw) { self.loginPatron(barcode, pw); },
                password : true
            });

        } else {
            // password is not required, go ahead and login
            self.loginPatron(barcode);
        }
    };

    this.updateScanBox({
        msg : 'Please log in with your library barcode.', // TODO
        handler : bcHandler
    });

    try {
        var a = dojo.byId('patron-login-username');
        a.focus();
        a.select();
    } catch(e) {}
    SelfCheckManager.fail_count = 0;
}

/**
 * Login the patron.  
 */
SelfCheckManager.prototype.loginPatron = function(barcode_or_usrname, passwd) {

    // reset timeout
    selfckResetTimer();

    //if(this.orgSettings[SET_PATRON_PASSWORD_REQUIRED]) { // password always reqired, per KCLS - fail safe
        if(!passwd) {
            // would only happen in dev/debug mode when using the patron= param
            //alert('password required by org setting.  remove patron= from URL');
            return;
        }

        var barcode = null;
        var usrname = null;
        if(barcode_or_usrname.match(this.patronBarcodeRegex)) {
            barcode = barcode_or_usrname;
        } else {
            usrname = barcode_or_usrname;
        }
        // patron password is required.  Verify it.

        var res = fieldmapper.standardRequest(
            ['open-ils.actor', 'open-ils.actor.verify_user_password'],
            {params : [this.authtoken, barcode, usrname, hex_md5(passwd)]}
        );

        if(res == 0) {
            // user-not-found results in login failure
            this.fail_count++;
            // Double-Scan of Barcode
            if (dojo.byId('patron-login-username').value == dojo.byId('patron-login-password').value) {
              dojo.byId('patron-login-password').value = '';
              dojo.byId('patron-login-password').focus();
              if (this.fail_count > 0) {
                // Barcode and PIN are the same, but fails login? That means double scan
                this.handleAlert(localeStrings.LOGIN_BARCODE_DOUBLE, false, 'login-failure');
              }
            } else {
              this.handleAlert(
                 dojo.string.substitute(localeStrings.LOGIN_FAILED, [barcode || usrname]),
                 false, 'login-failure'
              );
             this.drawLoginPage();
           }
            return;
        }
    //}

    // retrieve the fleshed user by barcode
    var patron_id = fieldmapper.standardRequest(
        ['open-ils.actor', 'open-ils.actor.user.retrieve_id_by_barcode_or_username'],
        {params : [this.authtoken, barcode, usrname]}
    );

    this.patron = fieldmapper.standardRequest(
        ['open-ils.actor', 'open-ils.actor.user.fleshed.retrieve.authoritative'],
        {params : [this.authtoken, patron_id]}
    );

    var evt = openils.Event.parse(this.patron);
    if(evt) {
        this.handleAlert(
            dojo.string.substitute(localeStrings.LOGIN_FAILED, [barcode || usrname]),
            false, 'login-failure'
        );
        this.drawLoginPage();

    } else {

        this.handleAlert('', true, 'login-success');
        dojo.byId('user_name').innerHTML = 
            dojo.string.substitute(localeStrings.WELCOME_BANNER, [this.patron.first_given_name()]);
		dojo.byId('oils-selfck-status-div').innerHTML = '';
		dojo.byId('oils-selfck-status-div2').innerHTML = '';
        if(this.patron.email() && this.patron.email().match(/.+@.+/) != null){
          openils.Util.removeCSSClass( dojo.byId('oils-selfck-nav-logout-email'), 'hidden' );
        }
        this.drawCircPage();
   }
}


SelfCheckManager.prototype.handleAlert = function(message, shouldPopup, sound) {
    console.log("Handling alert " + message);

    dojo.byId('oils-selfck-status-div').innerHTML = message;
    if(!this.patron){
        dojo.byId('oils-selfck-status-div2').innerHTML = message;
        //dojo.byId('oils-selfck-status-div3').innerHTML = message;
    }


    if(shouldPopup)
        openils.Util.addCSSClass( dojo.byId('oils-selfck-status-div'), 'checkout_failure' );
    else
        openils.Util.removeCSSClass( dojo.byId('oils-selfck-status-div'), 'checkout_failure' );

    if(message && shouldPopup && this.orgSettings[SET_ALERT_POPUP])
        alert(message);

    if(this.orgSettings[SET_ALERT_SOUND])
        openils.Util.playAudioUrl(SelfCheckManager.audioConfig[sound]);
}


/**
 * Manages the main input box
 * @param msg The context message to display with the box
 * @param clearOnly Don't update the context message, just clear the value and re-focus
 * @param handler Optional "on-enter" handler.  
 */
SelfCheckManager.prototype.updateScanBox = function(args) {
    args = args || {};

    if(args.select) {
        selfckScanBox.domNode.select();
    } else {
        selfckScanBox.attr('value', '');
    }

    if(args.password) {
        selfckScanBox.domNode.setAttribute('type', 'password');
    } else {
        selfckScanBox.domNode.setAttribute('type', '');
    }

    if(args.value)
        selfckScanBox.attr('value', args.value);

    if(args.msg) 
        dojo.byId('oils-selfck-scan-text').innerHTML = args.msg;

    if(selfckScanBox._lastHandler && (args.handler || args.clearHandler)) {
        dojo.disconnect(selfckScanBox._lastHandler);
    }

    if(args.handler) {

        selfckScanBox._lastHandler = dojo.connect(
            selfckScanBox,
            'onKeyDown', 
            function(e) {
                if(e.keyCode == dojo.keys.ESCAPE)
                    selfCheckMgr.logoutPatron(true);
                if(e.keyCode != dojo.keys.ENTER)
                    return;
                args.handler(selfckScanBox.attr('value'));
            }
        );
    }

    selfckScanBox.focus();
}

/**
 *  Sets up the checkout/renewal interface
 */
SelfCheckManager.prototype.drawCircPage = function() {
    openils.Util.show('oils-selfck-circ-tbody', 'table-row-group');
    switchTo('step3');

    var timeScanned = new Date().getTime();
    var self = this;
    this.updateScanBox({
        msg : 'Please enter an item barcode', // TODO i18n
        handler : function(barcode) {

            var curTime = new Date().getTime();
            var prevScanTime = seenBarcodes[barcode];

            if (prevScanTime) {
                console.log('barcode previously scanned at ' + 
                    prevScanTime + ' ; current time ' + curTime );

                // This barcode has already been seen
                var selfckScanbox = document.getElementById('selfckScanBox');

                if (curTime - prevScanTime > dblScanWarnTimeout) {
                    // this barcode was scanned more than dblScanWarnTimeout
                    // milliseconds ago -- alert the patron.
                    dojo.byId('oils-selfck-status-div').innerHTML = 
                        dojo.string.substitute(
                            localeStrings.DOUBLE_SCAN, [barcode]);
                }

                selfckScanbox.value = '';
                selfckScanbox.focus();
            } else {
                seenBarcodes[barcode] = curTime;
                switchTo('step3');
                self.checkout(barcode);
            }
        }
    });

    if(!this.circTemplate)
        this.circTemplate = this.circTbody.removeChild(dojo.byId('oils-selfck-circ-row'));

    // fines summary
    this.updateFinesSummary();

    // holds summary
    this.updateHoldsSummary();

    // items out summary
    this.updateCircSummary();

    // render mock checkouts for debugging?
    if(this.mockCheckouts) {
        for(var i in [1,2,3])
            this.displayCheckout(this.mockCheckout, 'checkout');
    }
}


SelfCheckManager.prototype.updateFinesSummary = function() {
    var self = this;

    // fines summary
    fieldmapper.standardRequest(
        ['open-ils.actor', 'open-ils.actor.user.fines.summary'],
        {   async : false,
            params : [this.authtoken, this.patron.id()],
            oncomplete : function(r) {
                var summary = openils.Util.readResponse(r);
                var finesSum = dojo.byId('acct_fines');
                var bal = summary ? summary.balance_owed() : 0;
                var bal2 = parseFloat(bal);
                self.creditPayableBalance = bal2 + '';
            }
        }
    );

    fieldmapper.standardRequest(
        ['open-ils.actor', 'open-ils.actor.user.transactions.have_balance.fleshed'],
        {   async : false,
            params : [this.authtoken, this.patron.id()],
            oncomplete : function(r) {
                var dataList = openils.Util.readResponse(r);
                var hasPositiveFee = false;
                for(var i = 0; i < dataList.length; i++) {
                    var data = dataList[i];
                    if(data.transaction.balance_owed() > 0) {
                        hasPositiveFee = true;
                    }
                }

                if (hasPositiveFee) openils.Util.addCSSClass( dojo.byId('oils-selfck-view-fines-link'), 'fines-exist' );
            }
    });
}


SelfCheckManager.prototype.drawItemsOutPage = function() {
    switchTo('step3','step3d');
    dojo.byId('oils-selfck-status-div').innerHTML = ''; // reset notices
    dojo.byId('scko-renewal-alerts').innerHTML = '';

    // Reset items checked out in case it changed
    this.updateCircSummary(false, true);

    if(!this.outTemplate)
        this.outTemplate = this.itemsOutTbody.removeChild(dojo.byId('oils-selfck-circ-out-row'));
    while(this.itemsOutTbody.childNodes[0])
        this.itemsOutTbody.removeChild(this.itemsOutTbody.childNodes[0]);

    progressDialog.show(true);
    var self = this;
    self.itemsOutArray = [];

    fieldmapper.standardRequest(
        ['open-ils.circ', 'open-ils.circ.actor.user.checked_out.atomic'],
        {
            async : false,
            params : [this.authtoken, this.patron.id()],
            oncomplete : function(r) {
                var resp = openils.Util.readResponse(r);
                var circs = resp.sort(
                    function(a, b) {
                        if(a.circ.due_date() > b.circ.due_date())
                            return -1;
                        return 1;
                    }
                );

                self.itemsOut = [];
                dojo.forEach(circs,
                    function(circ) {
                        self.itemsOut.push(circ.circ.id());
                        self.itemsOutArray.push(circ);
                    }
                );
                progressDialog.hide();
            }
        }
    );
    handleCheckedItems(self.itemsOutArray);
}

function handleCheckedItems(circs) {
    var self = selfCheckMgr;
    var row = self.outTemplate.cloneNode(true);

    dojo.forEach(circs, function(circ) {

        var row = self.outTemplate.cloneNode(true);

        var barcode = circ.copy.barcode();
        row.setAttribute('copy_barcode', barcode);

        self.byName(row, 'barcode').innerHTML = barcode;
        self.byName(row, 'title').innerHTML = circ.record.title();
        self.byName(row, 'author').innerHTML = circ.record.author();
        self.byName(row, 'remaining_renewals').innerHTML = circ.circ.renewal_remaining();
        
        if(dojo.date.stamp.fromISOString(circ.circ.due_date()) < (new Date()))
            self.byName(row,'due_date').style.color="red";
        
        self.byName(row,'due_date').innerHTML = dojo.date.locale.format(
            dojo.date.stamp.fromISOString(circ.circ.due_date()),
            {selector: 'date', fullYear: true}
        );
        
        // Disallow renewals of items with no renewals remaining or 
        // items that were already scanned in the current session.
        if (circ.circ.renewal_remaining() < 1 || seenBarcodes[barcode]) {
            self.byName(row, 'renew_selector').checked = false;
            self.byName(row, 'renew_selector').setAttribute('disabled', true);
        }

        self.byName(row,'format').innerHTML = circ.record.types_of_resource()[0];
        self.itemsOutTbody.appendChild(row);
    });
}

SelfCheckManager.prototype.goToTab = function(name) {
    this.tabName = name;

    openils.Util.hide('oils-selfck-fines-page');
    openils.Util.hide('oils-selfck-payment-page');
    openils.Util.hide('oils-selfck-holds-page');
    openils.Util.hide('oils-selfck-circ-page');

    // reset timeout
    selfckResetTimer();

    switch(name) {
        case 'checkout':
            openils.Util.show('oils-selfck-circ-page');
            break;
        case 'items_out':
            openils.Util.show('oils-selfck-circ-page');
            break;
        case 'holds':
            openils.Util.show('oils-selfck-holds-page');
            break;
        case 'fines':
            openils.Util.show('oils-selfck-fines-page');
            break;
    }
}

/*
 * Renew ticked checkbox items
 */
SelfCheckManager.prototype.renewItems = function() {
    var self = this;

    var rows = document.getElementsByClassName('oils-selfck-items-row');
    var renew_count = 0;
    var success_count = 0;

    dojo.forEach(rows, function(row) {
        var checkbox = self.byName(row, 'renew_selector');
        if (!checkbox.checked) return;

        renew_count++;
        checkbox.checked = false; // de-select all

        var barcode = row.getAttribute('copy_barcode');
        var stat = self.renew(barcode, false, true);

        if (stat.success) {
            // prevent any more renewal attempts (batch or scan) on this 
            // item by adding it to the list of already seen barcodes.
            seenBarcodes[barcode] = new Date().getTime();
            success_count++;
        }
    });

    //this.drawCircPage();
    this.drawItemsOutPage();

    // Display a generic success/failure batch renewal notification
    // Renewal messages appear on the items-out page, not the checkouts
    // page, so the message is manually inserted into the DOM instead
    // of using the existing handleAlert message handling.
    var msg = dojo.string.substitute(
        localeStrings.BATCH_RENEW_SUCCESS, [success_count]);
    var sound = 'checkout-success';

    if (success_count < renew_count) {
        msg = dojo.string.substitute(localeStrings.BATCH_RENEW_FAILURE);
        sound = 'checkout-failure';
    }

    dojo.byId('scko-renewal-alerts').innerHTML = msg;
    this.handleAlert('', false, sound);
}


SelfCheckManager.prototype.printList = function(which) {
    // reset timeout
    selfckResetTimer();

    function afterPrint() {
        // Called after the print window is closed.
        // Re-focus input box after all print actions.
        setTimeout(function(){selfckScanBox.focus()}, 100);
    }

    switch(which) {
        case 'checkout':
            this.printSessionReceipt(afterPrint);
            break;
        case 'items_out':
            this.printItemsOutReceipt(afterPrint);
            break;
        case 'holds':
            this.printHoldsReceipt(afterPrint);
            break;
        case 'ready':
            readyHolds = true;
            this.printHoldsReceipt(afterPrint);
            readyHolds = false;
            break;
        case 'fines':
            this.printFinesReceipt(afterPrint);
            break;
    }

    // afterPrint() is only called as a callback when there is stuff to
    // print.  Call it here too to ensure it's invokded one way or the
    // other.
    afterPrint();
}

SelfCheckManager.prototype.updateHoldsSummary = function() {
    if(!this.holdsSummary) {
        var summary = fieldmapper.standardRequest(
            ['open-ils.circ', 'open-ils.circ.holds.user_summary'],
            {params : [this.authtoken, this.patron.id()]}
        );

        this.holdsSummary = {};
        this.holdsSummary.ready = Number(summary['4']);
        this.holdsSummary.total = 0;

        for(var i in summary)
            this.holdsSummary.total += Number(summary[i]);
    }

    dojo.byId('oils-selfck-holds-total')
        .innerHTML = dojo.string.substitute("${0} Hold" + 
            (this.holdsSummary.total == 1 ? "" : "s"),
            [this.holdsSummary.total]
        );
    dojo.byId('oils-selfck-holds-ready').innerHTML = this.holdsSummary.ready;

}


SelfCheckManager.prototype.updateCircSummary = function(increment, force) {

    if (!this.circSummary || force) {
        
        // Avoid clobbering the session counts so for on a force refresh
        var sessionCount = this.circSummary ? this.circSummary.session : 0;

        var summary = fieldmapper.standardRequest(
            ['open-ils.actor', 'open-ils.actor.user.checked_out.count'],
            {params : [this.authtoken, this.patron.id()]}
        );

        this.circSummary = {
            total : Number(summary.out) + Number(summary.overdue),
            overdue : Number(summary.overdue),
            session : sessionCount
        };
    }

    if (increment) {
        // local checkout occurred.  Add to the total and the session.
        this.circSummary.total += 1;
        this.circSummary.session += 1;

        console.log('incrementing circ totals total='+
            this.circSummary.total+'; session=' + this.circSummary.session);
    }

    dojo.byId('oils-selfck-circ-account-total')
        .innerHTML = this.circSummary.total;

    dojo.byId('oils-selfck-circ-session-total')
        .innerHTML = this.circSummary.session;
}


SelfCheckManager.prototype.drawHoldsPage = function() {
    switchTo('step3','step3e');
    dojo.byId('oils-selfck-status-div').innerHTML = ''; // reset notices

    this.holdTbody = dojo.byId('oils-selfck-hold-tbody');
    this.readyTbody = dojo.byId('oils-selfck-rdy-tbody');
    this.suspendedTbody = dojo.byId('oils-selfck-suspended-tbody');
    if(!this.readyTemplate) {
        this.noReadyTemplate = this.readyTbody.removeChild(dojo.byId('oils-selfck-noready'));
        this.readyTemplate = this.readyTbody.removeChild(dojo.byId('oils-selfck-rdy-row'));
    }
    if(!this.holdTemplate)
        this.holdTemplate = this.holdTbody.removeChild(dojo.byId('oils-selfck-hold-row'));
    if(!this.suspendedTemplate)
        this.suspendedTemplate = this.suspendedTbody.removeChild(dojo.byId('oils-selfck-suspended-row'));

    while(this.holdTbody.childNodes[0])
        this.holdTbody.removeChild(this.holdTbody.childNodes[0]);
    while(this.readyTbody.childNodes[0])
        this.readyTbody.removeChild(this.readyTbody.childNodes[0]);
    while(this.suspendedTbody.childNodes[0])
        this.suspendedTbody.removeChild(this.suspendedTbody.childNodes[0]);

    progressDialog.show(true);

    var self = this;
    self.holdsArray = [];
    fieldmapper.standardRequest( // fetch the hold IDs

        ['open-ils.circ', 'open-ils.circ.holds.id_list.retrieve'],
        {   async : false,
            params : [this.authtoken, this.patron.id()],

            oncomplete : function(r) { 
                var ids = openils.Util.readResponse(r);
                if(!ids || ids.length == 0) {
                    progressDialog.hide();
                    return;
                }

                fieldmapper.standardRequest( // fetch the hold objects with fleshed details
                    ['open-ils.circ', 'open-ils.circ.hold.details.batch.retrieve'],
                    {   async : false,
                        params : [self.authtoken, ids],

                        onresponse : function(rr) {
                            progressDialog.hide();
                            self.holdsArray.push(openils.Util.readResponse(rr));
                        }
                    }
                );
            }
        }
    );
    self.drawHolds(self.holdsArray);
}

/**
 * Fetch and add a single hold to the list of holds
 */
SelfCheckManager.prototype.drawHolds = function(holds) {
    this.holds = holds;
    progressDialog.hide();

    var readyHolds = [];
    var suspendedHolds = [];
    var regularHolds = [];

    for(var hold = 0; hold < holds.length; hold++) {
        if(holds[hold].status == 4) {
            readyHolds.push(holds[hold]);
        } else if(holds[hold].status == 7) {
            suspendedHolds.push(holds[hold]);
        } else {
            regularHolds.push(holds[hold]);
        }
    }
    if(readyHolds.length) {
        for(hold = 0; hold < readyHolds.length; hold++) {
            var row2 = this.readyTemplate.cloneNode(true);
            this.byName(row2, 'title').innerHTML = readyHolds[hold].mvr.title();
            this.byName(row2, 'author').innerHTML = readyHolds[hold].mvr.author();
            this.byName(row2, 'call_number').innerHTML = readyHolds[hold].volume.label();
            this.byName(row2, 'status').innerHTML = "Ready for pickup";
            this.byName(row2, 'pickup_lib').innerHTML = 
                fieldmapper.aou.findOrgUnit(
                    readyHolds[hold].hold.pickup_lib()).name(); // TODO
            this.readyTbody.appendChild(row2);
        }
    } else {
        var noRow2 = this.noReadyTemplate.cloneNode(true);
        this.readyTbody.appendChild(noRow2);
    }
    if(suspendedHolds.length) {
        for(hold = 0; hold < suspendedHolds.length; hold++) {
            var row3 = this.suspendedTemplate.cloneNode(true);
            this.byName(row3, 'title').innerHTML = suspendedHolds[hold].mvr.title();
            this.byName(row3, 'author').innerHTML = suspendedHolds[hold].mvr.author();
            this.byName(row3, 'status').innerHTML = dojo.string.substitute(
                localeStrings.HOLD_STATUS_WAITING,
                [suspendedHolds[hold].queue_position]
            );
            this.suspendedTbody.appendChild(row3);
        }
    }
    if(regularHolds.length) {
        for(hold = 0; hold < regularHolds.length; hold++) {
            var row = this.holdTemplate.cloneNode(true);
            this.byName(row, 'title').innerHTML = regularHolds[hold].mvr.title();
            this.byName(row, 'author').innerHTML = regularHolds[hold].mvr.author();

            // hold is still pending
            this.byName(row, 'status').innerHTML = dojo.string.substitute(
                localeStrings.HOLD_STATUS_WAITING,
                [regularHolds[hold].queue_position]
            );
            this.holdTbody.appendChild(row);
        }
    }
}


SelfCheckManager.prototype.drawFinesPage = function() {
    // TODO add option to hid scanBox
    // this.updateScanBox(...)

    switchTo('step3','step3c');
    dojo.byId('oils-selfck-status-div').innerHTML = ''; // reset notices

    progressDialog.show(true);

    this.finesTbody = dojo.byId('oils-selfck-fines-tbody');
    if(!this.finesTemplate)
        this.finesTemplate = this.finesTbody.removeChild(dojo.byId('oils-selfck-fines-row'));
    while(this.finesTbody.childNodes[0])
        this.finesTbody.removeChild(this.finesTbody.childNodes[0]);

    var self = this;
    var handler = function(dataList) {

        self.finesCount = dataList.length;
        self.finesData = dataList;
        var outstandingFines = [];

        for(var i = 0; i < dataList.length; i++) {
            var data = dataList[i];
            if(data.transaction.balance_owed() > 0) {
                outstandingFines.push(data);
            }
        }

        function stringifyBtype(btype) {
            // avoid confusion around "grocery".  TODO i18n
            return btype || "Miscellaneous";
        }

        for(var fine = 0; fine < outstandingFines.length; fine++) {
            var row = self.finesTemplate.cloneNode(true);
            var data = outstandingFines[fine];
            var type = data.transaction.xact_type();

            if(type == 'circulation') {
                self.byName(row, 'title').innerHTML = data.record.title();
                if(dojo.date.stamp.fromISOString(data.circ.due_date()) < (new Date()))
                    self.byName(row, 'due_date').style.color="red";
                self.byName(row, 'due_date').innerHTML = dojo.date.locale.format(dojo.date.stamp.fromISOString(
                    data.circ.due_date()),
                {selector: 'date', fullYear: true}
                );
                self.byName(row, 'date_return').innerHTML = (data.circ.checkin_time()) ? dojo.date.locale.format(
                    dojo.date.stamp.fromISOString(data.circ.checkin_time()),
                    {selector: 'date', fullYear: true}
                ) : "";

                self.byName(row, 'btype').innerHTML = 
                    stringifyBtype(data.transaction.last_billing_type());

            } else if(type == 'grocery') {
                self.byName(row, 'title').innerHTML = 
                    stringifyBtype(data.transaction.last_billing_type());
            }

            self.byName(row, 'balance').innerHTML = data.transaction.balance_owed();
            self.finesTbody.appendChild(row);
            if(!self.byName(row,'due_date').innerHTML ) {
                document.getElementsByClassName('dueDate')[fine].style.display = 'none';
            }
            if(!self.byName(row,'date_return').innerHTML) {
                document.getElementsByClassName('dateReturn')[fine].style.display = 'none';
            }
            if(!self.byName(row,'btype').innerHTML) {
                document.getElementsByClassName('billingType')[fine].style.display = 'none';
            }
        }

    }


    fieldmapper.standardRequest( 
        ['open-ils.actor', 'open-ils.actor.user.transactions.have_balance.fleshed'],
        {   async : false,
            params : [this.authtoken, this.patron.id()],
            oncomplete : function(r) { 
                progressDialog.hide();
                handler(openils.Util.readResponse(r));
            }
        }
    );
}

SelfCheckManager.prototype.checkin = function(barcode, abortTransit) {
    var resp = fieldmapper.standardRequest(
        ['open-ils.circ', 'open-ils.circ.transit.abort'],
        {params : [this.authtoken, {barcode : barcode}]}
    );

    // resp == 1 on success
    if(openils.Event.parse(resp))
        return false;

    var resp = fieldmapper.standardRequest(
        ['open-ils.circ', 'open-ils.circ.checkin.override'],
        {params : [
            this.authtoken, {
                patron_id : this.patron.id(),
                copy_barcode : barcode,
                noop : true
            }
        ]}
    );

    if(!resp.length) resp = [resp];
    for(var i = 0; i < resp.length; i++) {
        var tc = openils.Event.parse(resp[i]).textcode;
        if(tc == 'SUCCESS' || tc == 'NO_CHANGE') {
            continue;
        } else {
            return false;
        }
    }

    return true;
}

/**
 * Check out a single item.  If the item is already checked 
 * out to the patron, redirect to renew()
 */
SelfCheckManager.prototype.checkout = function(barcode, override) {

    // reset timeout
    selfckResetTimer();

    this.prevCirc = null;

    if(!barcode) {
        // commenting this line out becuase it's misspelled and
        // not doing anything but throwing an error.
        //this.updateScanbox(null, true);
        return;
    }

    if(this.mockCheckouts) {
        // if we're in mock-checkout mode, just insert another
        // fake circ into the table and get out of here.
        this.displayCheckout(this.mockCheckout, 'checkout');
        return;
    }

    // TODO see if it's a patron barcode
    // TODO see if this item has already been checked out in this session

    var method = 'open-ils.circ.checkout.full';
    if(override) method += '.override';

    console.log("Checkout out item " + barcode + " with method " + method);

    var result = fieldmapper.standardRequest(
        ['open-ils.circ', method],
        {params: [
            this.authtoken, {
                patron_id : this.patron.id(),
                copy_barcode : barcode
            }
        ]}
    );

    var stat = this.handleXactResult('checkout', barcode, result);

    if(stat.override) {
        this.checkout(barcode, true);
    } else if(stat.doOver) {
        this.checkout(barcode);
    } else if(stat.renew) {
        this.renew(barcode);
    }
}

SelfCheckManager.prototype.failPartMessage = function(result) {
    if (result.payload && result.payload.fail_part) {
        var stringKey = "FAIL_PART_" +
            result.payload.fail_part.replace(/\./g, "_");
        return localeStrings[stringKey];
    } else {
        return null;
    }
}

SelfCheckManager.prototype.handleXactResult = function(action, item, result, isBatch) {
    var displayText = '';

    // If true, the display message is important enough to pop up.  Whether or not
    // an alert() actually occurs, depends on org unit settings
    var popup = false;  
    var sound = ''; // sound file reference
    var payload = result.payload || {};
    var overrideEvents = this.orgSettings[SET_AUTO_OVERRIDE_EVENTS];
    var blockStatuses = this.orgSettings[SET_BLOCK_CHECKOUT_ON_COPY_STATUS];
    result.payload = payload;
    var success = false;

    if(result.textcode == 'NO_SESSION') {

        return this.logoutStaff();

    } else if(result.textcode == 'SUCCESS') {

        if(action == 'checkout') {

            displayText = dojo.string.substitute(localeStrings.CHECKOUT_SUCCESS, [item]);
            this.displayCheckout(result, 'checkout');

            if(payload.holds_fulfilled && payload.holds_fulfilled.length) {
                // A hold was fulfilled, update the hold numbers in the circ summary
                console.log("fulfilled hold " + payload.holds_fulfilled + " during checkout");
                this.holdsSummary = null;
                this.updateHoldsSummary();
            }

            this.updateCircSummary(true);

        } else if(action == 'renew') {

            displayText = dojo.string.substitute(localeStrings.RENEW_SUCCESS, [item]);

            // Avoid displaying batch renewal circs in the session circs
            // page.  The are displayed in session receipts and emails,
            // though, so they get added to this.checkouts (below).
            if (!isBatch) this.displayCheckout(result, 'renew');
        }

        success = true;
        sound = 'checkout-success';
        this.checkouts.push({circ : result.payload.circ.id()});
        this.updateScanBox();

    } else if(result.textcode == 'OPEN_CIRCULATION_EXISTS' && action == 'checkout') {

        // Server says the item is already checked out.  If it's checked out to the
        // current user, we may need to renew it.  

        if(payload.old_circ) {

            /*
            old_circ refers to the previous checkout IFF it's for the same user. 
            If no auto-renew interval is not defined, assume we should renew it
            If an auto-renew interval is defined and the payload comes back with
            auto_renew set to true, do the renewal.  Otherwise, let the patron know
            the item is already checked out to them.  */

            if( !this.orgSettings[SET_AUTO_RENEW_INTERVAL] ||
                (this.orgSettings[SET_AUTO_RENEW_INTERVAL] && payload.auto_renew) ) {
                this.prevCirc = payload.old_circ.id();
                return { renew : true };
            }

            popup = true;
            sound = 'checkout-failure';
            displayText = dojo.string.substitute(localeStrings.ALREADY_OUT, [item]);
            delete seenBarcodes[item];

        } else {

            if( // copy is marked lost.  if configured to do so, check it in and try again.
                result.payload.copy && 
                result.payload.copy.status() == /* LOST */ 3 &&
                overrideEvents && overrideEvents.length &&
                overrideEvents.indexOf('COPY_STATUS_LOST') != -1) {

                    if(this.checkin(item)) {
                        return { doOver : true };
                    }
            }

            
            // item is checked out to some other user
            popup = true;
            sound = 'checkout-failure';
            displayText = dojo.string.substitute(localeStrings.OPEN_CIRCULATION_EXISTS, [item]);
            delete seenBarcodes[item];
        }

        this.updateScanBox();

    } else {

        if(overrideEvents && overrideEvents.length) {
            
            // see if the events we received are all in the list of
            // events to override

            if(!result.length) result = [result];

            var override = true;
            for(var i = 0; i < result.length; i++) {

                var match = overrideEvents.filter(function(e) { return (e == result[i].textcode); })[0];

                if(!match) {
                    override = false;
                    break;
                }

                if(result[i].textcode == 'COPY_NOT_AVAILABLE' && blockStatuses && blockStatuses.length) {

                    var stat = result[i].payload.status(); // copy status
                    if(typeof stat == 'object') stat = stat.id();

                    var match2 = blockStatuses.filter(function(e) { return (e == stat); })[0];

                    if(match2) { // copy is in a blocked status
                        override = false;
                        break;
                    }
                }

                if(result[i].textcode == 'COPY_IN_TRANSIT') {
                    // to override a transit, we have to abort the transit and check it in first
                    if(this.checkin(item, true)) {
                        return { doOver : true };
                    } else {
                        override = false;
                    }
                }
            }

            if(override) 
                return { override : true };
        }

        this.updateScanBox();
        popup = true;
        sound = 'checkout-failure';
        delete seenBarcodes[item];

        // JBAS-1728
        // this.prevCirc is only set when attempting to auto-renew
        // an existing checkout.  It is not (currently) set when doing
        // a straight up renewal.  This means renewal failures will only
        // appear in receipts in the auto-renew context.  If we need to 
        // add support for showing renewal failures to receipts in batch-
        // renewal mode, see renewItems() and pass the circ ID in to use
        // as the prevCirc value instead.
        if(action == 'renew' && this.prevCirc)
            this.checkouts.push({circ : this.prevCirc, renewal_failure : true});

        if(result.length)
            result = result[0];

        switch(result.textcode) {

            // TODO custom handler for blocking penalties

            case 'MAX_RENEWALS_REACHED' :
                displayText = dojo.string.substitute(
                    localeStrings.MAX_RENEWALS, [item]);
                break;

            case 'ITEM_NOT_CATALOGED' :
                displayText = dojo.string.substitute(
                    localeStrings.ITEM_NOT_CATALOGED, [item]);
                break;

            case 'OPEN_CIRCULATION_EXISTS' :
                displayText = dojo.string.substitute(
                    localeStrings.OPEN_CIRCULATION_EXISTS, [item]);

                break;

            default:
                console.error('Unhandled event ' + result.textcode);

                if (!(displayText = this.failPartMessage(result))) {
                    if (action == 'checkout' || action == 'renew') {
                        if (isBatch) {
                            // show generic 'see staff' message
                            displayText = dojo.string.substitute(
                                localeStrings.GENERIC_BATCH_CIRC_FAILURE);
                        } else {
                            // show item-specific error message
                            displayText = dojo.string.substitute(
                                localeStrings.GENERIC_CIRC_FAILURE, [item]);
                        }
                    } else {
                        displayText = dojo.string.substitute(
                            localeStrings.UNKNOWN_ERROR, [result.textcode]);
                    }
                }
        }
    }

    // avoid per-item notifications in batch mode.
    if (!isBatch) this.handleAlert(displayText, popup, sound);
    return {success : success};
}


/**
 * Renew an item
 */
SelfCheckManager.prototype.renew = function(barcode, override, isBatch) {

    var method = 'open-ils.circ.renew';
    if(override) method += '.override';

    console.log("Renewing item " + barcode + " with method " + method);

    var result = fieldmapper.standardRequest(
        ['open-ils.circ', method],
        {params: [
            this.authtoken, {
                patron_id : this.patron.id(),
                copy_barcode : barcode
            }
        ]}
    );

    var stat = this.handleXactResult('renew', barcode, result, isBatch);

    if (stat.override)
        return this.renew(barcode, true, isBatch);

    return stat;
}

/**
 * Display the result of a checkout or renewal in the items out table
 */
SelfCheckManager.prototype.displayCheckout = function(evt, type, itemsOut) {
    var copy = evt.payload.copy;
    var record = evt.payload.record;
    var circ = evt.payload.circ;
    var row = this.circTemplate.cloneNode(true);

    this.byName(row, 'barcode').innerHTML = copy.barcode();
    this.byName(row, 'title').innerHTML = record.title();
    openils.Util.show(this.byName(row, type));

    var date = dojo.date.stamp.fromISOString(circ.due_date());
    this.byName(row, 'due_date').innerHTML =
        dojo.date.locale.format(date, {selector : 'date'});

    // put new circs at the top of the list
    var tbody = this.circTbody;
    if(itemsOut) tbody = this.itemsOutTbody;
    tbody.insertBefore(row, tbody.getElementsByTagName('tr')[0]);
}


SelfCheckManager.prototype.byName = function(node, name) {
    return dojo.query('[name=' + name+']', node)[0];
}


SelfCheckManager.prototype.initPrinter = function() {
    try { // Mozilla only
        netscape.security.PrivilegeManager.enablePrivilege("UniversalBrowserRead");
        netscape.security.PrivilegeManager.enablePrivilege('UniversalXPConnect');
        netscape.security.PrivilegeManager.enablePrivilege('UniversalPreferencesRead');
        netscape.security.PrivilegeManager.enablePrivilege('UniversalPreferencesWrite');
        var pref = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);
        if (pref)
            pref.setBoolPref('print.always_print_silent', true);
    } catch(E) {
        console.log("Unable to initialize auto-printing");
    }
}

/**
 * Print a receipt for this session's checkouts
 */
SelfCheckManager.prototype.printSessionReceipt = function(callback) {
    var circIds = [];
    var circCtx = []; // circ context data.  in this case, renewal_failure info

    // collect the circs and failure info
    dojo.forEach(
        this.checkouts,
        function(blob) {
            circIds.push(blob.circ);
            circCtx.push({renewal_failure:blob.renewal_failure});
        }
    );

    var params = [
        this.authtoken,
        this.staff.ws_ou(),
        null,
        'format.selfcheck.checkout',
        'print-on-demand',
        circIds,
        circCtx
    ];

    var self = this;
    fieldmapper.standardRequest(
        ['open-ils.circ', 'open-ils.circ.fire_circ_trigger_events'],
        {
            async : false,
            params : params,
            oncomplete : function(r) {
                var resp = openils.Util.readResponse(r);
                var output = resp.template_output();
                if(output) {
                    self.printData(output.data(), self.checkouts.length, callback);
                } else {
                    var error = resp.error_output();
                    if(error) {
                        throw new Error("Error creating receipt: " + error.data());
                    } else {
                        throw new Error("No receipt data returned from server");
                    }
                }
            }
        }
    );
}

SelfCheckManager.prototype.printData = function(data, numItems, callback) {
    var win = window.open('', '', 'resizable,width=350,height=250,scrollbars=1');
    win.document.body.innerHTML = data;
    win.print();

    /*
     * There is no way to know when the browser is done printing.
     * Make a best guess at when to close the print window by basing
     * the setTimeout wait on the number of items to be printed plus
     * a small buffer
     */
    var sleepTime = 1000;
    if(numItems > 0)
        sleepTime += (numItems / 2) * 1000;

    setTimeout(
        function() {
            win.close(); // close the print window
            if(callback) callback(); // fire callback to return to main page 
        },
        sleepTime
    );
}


/**
 * Print a receipt for this user's items out
 */
SelfCheckManager.prototype.printItemsOutReceipt = function(callback) {
    if(!this.itemsOut.length) return;

    progressDialog.show(true);

    var params = [
        this.authtoken,
        this.staff.ws_ou(),
        null,
        'format.selfcheck.items_out',
        'print-on-demand',
        this.itemsOut
    ];

    var self = this;
    fieldmapper.standardRequest(
        ['open-ils.circ', 'open-ils.circ.fire_circ_trigger_events'],
        {
            async : false,
            params : params,
            oncomplete : function(r) {
                progressDialog.hide();
                var resp = openils.Util.readResponse(r);
                var output = resp.template_output();
                if(output) {
                    self.printData(output.data(), self.itemsOut.length, callback);
                } else {
                    var error = resp.error_output();
                    if(error) {
                        throw new Error("Error creating receipt: " + error.data());
                    } else {
                        throw new Error("No receipt data returned from server");
                    }
                }
            }
        }
    );
}
/**Send email receipt for this session's checkouts
 */
SelfCheckManager.prototype.emailSessionReceipt = function(callback) {

    var circIds = [];
    var circCtx = []; // circ context data.  in this case, renewal_failure info

    // collect the circs and failure info
    dojo.forEach(
        this.checkouts,
        function(blob) {
            circIds.push(blob.circ);
            circCtx.push({renewal_failure:blob.renewal_failure});
        }
    );
    var params = [
        this.authtoken,
        this.staff.ws_ou(),
        null,
        'email.selfcheck.checkout',
        '', // granularity
        circIds,
        circCtx
    ];

    var self = this;
    fieldmapper.standardRequest(
        ['open-ils.circ', 'open-ils.circ.fire_circ_trigger_events'],
        {
            async : false,
            params : params,
            oncomplete : function(r) {
                var resp = openils.Util.readResponse(r);
                var evt = openils.Event.parse(resp);
                // Email events are passive, so all we're doing here is
                // creating an event that will be fired later.  
                if (evt) {
                    throw new Error("Error creating receipt email: " + evt);
                } else {
                    if (callback) callback();
                }
            }
        }
    );
}



/**
 * Print a receipt for this user's holds
 */
SelfCheckManager.prototype.printHoldsReceipt = function(callback) {
    if(!this.holdsArray.length) return;

    progressDialog.show(true);

    var holdIds = [];
    var holdData = [];
    var rdyForPickup = false;

    if(readyHolds) {
        dojo.forEach(this.holdsArray,
            function(data) {
                if(data.status == 4) {
                    holdIds.push(data.hold.id());
                    holdData.push({ready : true});
                    rdyForPickup = true;
                }
            }
        );
        if(!rdyForPickup) {
            progressDialog.hide();
            return;

        }
    } else {

        dojo.forEach(this.holdsArray,
            function(data) {
                holdIds.push(data.hold.id());
                if(data.status == 4) {
                    holdData.push({ready : true});
                } else {
                    holdData.push({
                        queue_position : data.queue_position
                    });
                }
            }
        );
    }

    var params = [
        this.authtoken,
        this.staff.ws_ou(),
        null,
        'format.selfcheck.holds',
        'print-on-demand',
        holdIds,
        holdData
    ];

    var self = this;
    fieldmapper.standardRequest(
        ['open-ils.circ', 'open-ils.circ.fire_hold_trigger_events'],
        {
            async : false,
            params : params,
            oncomplete : function(r) {
                progressDialog.hide();
                var resp = openils.Util.readResponse(r);
                var output = resp.template_output();
                if(output) {
                    self.printData(output.data(), self.holdsArray.length, callback);
                } else {
                    var error = resp.error_output();
                    if(error) {
                        throw new Error("Error creating receipt: " + error.data());
                    } else {
                        throw new Error("No receipt data returned from server");
                    }
                }
            }
        }
    );
}

/**
 * Print a receipt for this user's items out
 */
SelfCheckManager.prototype.printFinesReceipt = function(callback) {
    progressDialog.show(true);

    var params = [
        this.authtoken,
        this.staff.ws_ou(),
        null,
        'format.selfcheck.fines',
        'print-on-demand',
        [this.patron.id()]
    ];

    var self = this;
    fieldmapper.standardRequest(
        ['open-ils.circ', 'open-ils.circ.fire_user_trigger_events'],
        {
            async : false,
            params : params,
            oncomplete : function(r) {
                progressDialog.hide();
                var resp = openils.Util.readResponse(r);
                var output = resp.template_output();
                if(output) {
                    self.printData(output.data(), self.finesCount, callback);
                } else {
                    var error = resp.error_output();
                    if(error) {
                        throw new Error("Error creating receipt: " + error.data());
                    } else {
                        throw new Error("No receipt data returned from server");
                    }
                }
            }
        }
    );
}

/**
 * Logout the patron and return to the login page
 */
SelfCheckManager.prototype.logoutPatron = function(print, email) {

    if(print && this.checkouts.length) {
        progressDialog.show(true); // prevent patron from clicking logout link twice
        this.printSessionReceipt(selfCheckManager.processLogout);

    } else if(email && this.checkouts.length) {
        this.emailSessionReceipt(selfCheckManager.processLogout);

    } else {
        selfCheckManager.processLogout();
    }
}


SelfCheckManager.prototype.processLogout = function() {
    var return_url = this.cgi.param('return-to') || location.href;

    // Display the Thank-You page
    openils.Util.show('step4');
    switchTo('step4');

    // NOTE: The variable resets below are likely not necessary, since
    // the page reloads after a few seconds.  Leaving for now in case
    // there's something I'm missing.

    this.timer = null;
    this.cgi = new openils.CGI();
    this.staff = null; 
    this.workstation = null;
    this.authtoken = null;
    this.fail_count = 0;

    this.patron = null; 
    this.patronBarcodeRegex = null;

    this.checkouts = [];
    this.itemsOut = [];
    this.holdsArray = [];

    // During renewals, keep track of the ID of the previous circulation.
    // Previous circ is used for tracking failed renewals (for receipts).
    this.prevCirc = null;

    // current item barcode
    this.itemBarcode = null; 

    // are we currently performing a renewal?
    this.isRenewal = false; 

    // dict of org unit settings for "here"
    this.orgSettings = {};

    var goHomeFunc = function() {location.href = return_url};

    // "return to login" link
    dojo.connect(dojo.byId('oils-selfck-nav-return-login'), 'onclick', goHomeFunc);

    // automatically redirect if return link is not clicked
    setTimeout(goHomeFunc, thankYouPageTimeout);
}

//TODO: Remove
function checkLogin() {
    if(selfCheckMgr.orgSettings[SET_PATRON_PASSWORD_REQUIRED]) {
        try {
            dojo.byId('patron-login-password').focus();
         }catch(e) {}
    } else {
        selfCheckMgr.loginPatron(dojo.byId('patron-login-username').value);
    }
}


function cancelLogin() {
    SelfCheckManager.fail_count = 0;
    dojo.byId('oils-selfck-status-div').innerHTML = '';
    dojo.byId('oils-selfck-status-div2').innerHTML = '';
    //dojo.byId('oils-selfck-status-div3').innerHTML = '';
    dojo.byId('patron-login-password').value = '';
    switchTo('step1');
    try {
        dojo.byId('patron-login-username').focus();
        dojo.byId('patron-login-username').select();
    } catch(e) {}
}

/**
 * Fire up the manager on page load
 */
openils.Util.addOnLoad(
    function() {
        selfCheckManager = new SelfCheckManager();
        selfCheckManager.init();
        openils.Util.registerEnterHandler(dojo.byId('patron-login-username'),
            function(){checkLogin();});
        openils.Util.registerEnterHandler(
            dojo.byId('patron-login-password'),
            function(){
                selfCheckMgr.loginPatron(
                    dojo.byId('patron-login-username').value,dojo.byId('patron-login-password').value
                );
            }
        );
    }
);
/**
 * Toogle stylesheet - intended for high contrast mode toggling.
 */
function swapStyleSheet(sheet1, sheet2) {
  var currentStyle = document.getElementById('style');
  if(currentStyle.getAttribute('href') != sheet1) {
    currentStyle.setAttribute('href', sheet1);
  } else {
    currentStyle.setAttribute('href', sheet2);
  }
  setTimeout(function(){
    dojo.byId('patron-login-username').focus()}, 100);
}


