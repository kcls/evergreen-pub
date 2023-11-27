/**
 * Update Items
 */

angular.module('egUpdateItems',
    ['ngRoute', 'ui.bootstrap', 'egCoreMod', 'egUiMod', 'egGridMod'])

.filter('boolText', function(){
    return function (v) {
        return v == 't';
    }
})

.config(['ngToastProvider', function(ngToastProvider) {
  ngToastProvider.configure({
    verticalPosition: 'bottom',
    animation: 'fade'
  });
}])

.config(function($routeProvider, $locationProvider, $compileProvider) {
    $locationProvider.html5Mode(true);
    $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|blob):/); // grid export

    var resolver = {
        delay : ['egStartup','egProgressDialog', function(egStartup,egProgressDialog) { return egStartup.go().then(egProgressDialog.open()); }]
    };

    $routeProvider.when('/acq/update_items/:dataKey', {
        templateUrl: './acq/update_items/t_update_items',
        controller: 'UpdateCtrl',
        resolve : resolver
    });
})

.factory('updateItemSvc',
       ['egCore','$q','$routeParams','$window','$timeout','egItem','hotkeys','egProgressDialog',
function(egCore , $q , $routeParams , $window , $timeout , egItem , hotkeys , egProgressDialog) {

    var service = {
        record_id : $routeParams.dataKey,
        currently_generating : false,
        auto_gen_barcode : false,
        barcode_checkdigit : false,
        lineitems : [],
        selected_lineitem: {}
    };

    service.fetchLineItems = function() {
        return egCore.net.request(
            'open-ils.acq', 'open-ils.acq.lineitems_for_bib.by_bib_id',
            egCore.auth.token(), service.record_id, {
                flesh_po: true,
                flesh_li_details: true,
                flesh_notes: true,
                flesh_li_details_copy: true,
                lineitem_state: ['on-order', 'received']
            }
        ).then(function() {
            egProgressDialog.close();
        },null,function(jub) {
            var duplicateLineItem = false;
            var purchaseOrder = service.objectifyLineItems(jub);
            angular.forEach(service.lineitems, function(li) {
                if (li.li_id == purchaseOrder.li_id) duplicateLineItem = true;
            });
            if (!duplicateLineItem) service.lineitems.push(purchaseOrder);
        });
    }

    service.find_or_create_volume = function(cn_label, record_id, ou_id) {
        return egCore.net.request(
            'open-ils.cat', 
            'open-ils.cat.call_number.find_or_create',
            egCore.auth.token(), 
            cn_label, 
            record_id, 
            ou_id
        ).then(function(res) {
            if (!res.existed) console.debug("service.find_or_create_volume: Creating new volume");
            return res.acn_id;
        });
    }

    service.updateCopies = function(acpArray, exit, print_options, copy_ids) {
        egCore.net.request(
            'open-ils.cat',
            'open-ils.cat.asset.copy.fleshed.batch.update',
            egCore.auth.token(),
            acpArray
        ).then(function(res) {
            if (res != 1) console.debug("service.updateCopies: Copies failed to update");

            if (print_options) {
                $timeout(function() {
                    service.handlePrintOptions(copy_ids, print_options);
                }).then(function() {service.handlePostSave(exit);});
            } else {
            service.handlePostSave(exit);
            }
        });
    }

    // Copied over from egItems for Optimizing saving
    service.print_spine_labels = function(copy_ids){
        return egCore.net.request(
            'open-ils.actor',
            'open-ils.actor.anon_cache.set_value',
            null, 'print-labels-these-copies', {
                copies : copy_ids
            }
        ).then(function(key) {
            if (!key) alert('service.print_spine_labels: Could not create anonymous cache key!');
            return key;
        });
    }

    service.updateLineitemNotes = function(acqlin_list) {
        egCore.net.request(
            'open-ils.acq',
            'open-ils.acq.lineitem_note.cud.batch',
            egCore.auth.token(),
            acqlin_list
        ).then(function(res) {
            if (res != 1) console.debug("service.updateLineitemNotes: Notes failed to update");
        });
    }

    service.orgArrayCleanup = function(orgs) {
        var finalOrgs = [];

        angular.forEach(orgs, function(o) {
            var hasVol = false;
            if (o.vols.length > 0) finalOrgs.push(o);
        });
        return finalOrgs;
    }

    service.objectifyOrgs = function(jub) {
        var orgs = [];
        var volumes = [];

        // Populate our Org units for the parent array
        angular.forEach(egCore.org.list(), function(org) {
            orgs.push({id: org.id(), shortname: org.shortname(), vols: []});
        });

        //Fill out our volumes list
        angular.forEach(jub.lineitem_details(), function(acqlid) {
            volume = egCore.idl.toHash(acqlid.eg_copy_id());
            var existingVolume = false;
            var owningLib = egCore.org.get(acqlid.owning_lib()).shortname();
            angular.forEach(orgs, function(o) {

                //Volume already exists? Push copy to existing volume
                angular.forEach(o.vols, function(v) {
                    if (volume.call_number.label == v.cn_label && o.shortname == owningLib) {
                        existingVolume = true;
                        v.copies.push(service.objectifyCopy(volume));
                    }

                });

                // If the volume doesn't exist yet, push a new volume
                if (!existingVolume) {
                    if (acqlid.eg_copy_id().call_number) {
                        var tempVolume = service.objectifyVolume(acqlid);
                        if (tempVolume.owning_lib == o.shortname) o.vols.push(tempVolume);
                    }
                }
            });
        });
        orgs = service.orgArrayCleanup(orgs);
        return orgs;
    }

    //Fill out our Volume object
    service.objectifyVolume = function(acqlid) {
        acp = egCore.idl.toHash(acqlid.eg_copy_id());
        return {
            id: acp.call_number.id,
            owning_lib: egCore.org.get(acqlid.owning_lib()).shortname(),
            cn_label: acp.call_number.label,
            copies: [acp]
        }
    }

    //Fill out our Copy object
    service.objectifyCopy = function(acp) {
        return egCore.idl.toHash(acp);
    }

    service.objectifyNotes = function(acqlinArray) {
        var notes = [];

        angular.forEach(acqlinArray, function(note) {
            notes.push({
                id: note.id(),
                creator: note.creator(),
                create_time: note.create_time(),
                value: note.value()
            });
        });

        return notes;
    }

    service.objectifyLineItems = function(jub) {
        /* We want to make the lineitem into an object with the following information:
        {
            dropdownLabel: PO: POID / LI: LIID
            po_id:
            li_id:
            rawData:
            notes: [{id,create_time,value,creator}],
            orgs: [{
                id:
                shortname:
                vols: [{
                    id:
                    owning_lib:
                    cn_label:
                    copies: [acp]
                }] 
            }]
        } */
        var purchaseOrder = {};
        purchaseOrder.orgs = service.objectifyOrgs(jub);
        //Defining this here so we can use ng-options
        purchaseOrder.dropdownLabel = "PO: " + jub.purchase_order().id() + " / LI: " + jub.id();
        purchaseOrder.po_id = jub.purchase_order().id();
        purchaseOrder.li_id = jub.id();
        purchaseOrder.notes = service.objectifyNotes(jub.lineitem_notes());
        purchaseOrder.rawData = jub;

        return purchaseOrder;
    }

    service.generateNote = function(note, li_id) {
        var acqlin = new egCore.idl.acqlin();
        acqlin.isnew(true);
        acqlin.lineitem(li_id);
        acqlin.value(note);

        return acqlin;
    }

    service.saveChanges = function(args) {
        var liToSave = service.getCurrentLineItem();
        var changesToSave = false;
        copy_ids = [];

        if (!liToSave) {
            console.debug("service.saveChanges: No Lineitem Selected.");
            return;
        }

        angular.forEach(liToSave.orgs, function(org) {
            angular.forEach(org.vols, function(volume) {
                angular.forEach(volume.copies, function(copy) {
                    copy_ids.push(copy.id);
                });
            });
        });

        if (args.add_notes) {
            var notes = [];

            if (!args.note_a) {
                console.debug("service.saveChanges: No data in note fields.");
                return;
            }
            var acqlin_a = service.generateNote(args.note_a, liToSave.li_id);
            notes.push(acqlin_a);
            if (args.note_b) {
                var acqlin_b = service.generateNote(args.note_b, liToSave.li_id);
                notes.push(acqlin_b);
            }

            changesToSave = true;
            service.updateLineitemNotes(notes);
        }
        if (args.copies.length) {
            changesToSave = true;
            service.updateCopies(args.copies, args.exit, args.print_options, copy_ids);
        } else if (changesToSave) {
            if (args.print_options) {
                service.handlePrintOptions(copy_ids, args.print_options);
            }
            service.handlePostSave(args.exit);
        } else {
            if (args.print_options) {
                service.handlePrintOptions(copy_ids, args.print_options);
            }
            console.debug("service.saveChanges: There are no changes to save.")
        }
    }

    service.handlePrintOptions = function(copy_ids, print_options) {
        if (print_options.print_label && print_options.print_worksheet) {
            service.print_spine_labels(copy_ids).then(function(key) {
                var lurl = egCore.env.basePath + 'cat/printlabels/' + key;
                var wurl ='/eg/acq/lineitem/worksheet/' + service.getCurrentLineItem().li_id;
                $timeout(function() { $window.open(lurl, '_blank') });
                $timeout(function() { $window.open(wurl, '_blank') });
            });
        } else if (print_options.print_label && !print_options.print_worksheet) {
            service.print_spine_labels(copy_ids).then(function(key) {
                var url = egCore.env.basePath + 'cat/printlabels/' + key;
                $timeout(function() { $window.open(url, '_blank') });
            });
        } else if (print_options.print_worksheet && !print_options.print_label) {
            var url = '/eg/acq/lineitem/worksheet/' + service.getCurrentLineItem().li_id;
            $timeout(function() { $window.open(url, '_blank') });
        }
    }

    service.handlePostSave = function(exit) {
        if (exit) $window.close();
        $window.location.reload();
    }

    // Search service.lineitems for the copy with a specific ID
    service.findCopy = function(cp_id) {
        var unHashedCopy;
        angular.forEach(service.lineitems, function(lineitem) {
           angular.forEach(lineitem.orgs, function(org) {
               angular.forEach(org.vols, function(volume) {
                   angular.forEach(volume.copies, function(copy) {
                        if (copy.id == cp_id) {
                            unHashedCopy = egCore.idl.fromHash('acp',copy);
                            unHashedCopy.status(copy.status.id);
                            unHashedCopy.call_number(copy.call_number.id);
                        }
                   });
               });
           });
        });
        return unHashedCopy;
    }

    // Compare two copies, returning true if the copies differ on specified fields
    service.compareCopy = function(copy_a, copy_b) {
        if (copy_a.barcode() != copy_b.barcode()) return true;
        if (copy_a.call_number() != copy_b.call_number()) return true;
        if (copy_a.location() != copy_b.location()) return true;
        if (copy_a.circ_modifier() != copy_b.circ_modifier()) return true;
        if (copy_a.circulate() != copy_b.circulate()) return true;
        if (copy_a.price() != copy_b.price()) return true;
        return false;
    }

    service.updateLocalLineItemData = function(li) {
        if (li) {
            service.selected_lineitem = li;
        } else {
            console.debug("service.updateLocalLineItemData: No Lineitem specified");
        }
    }

    service.getLineItems = function() {
        if(!service.lineitems.length) {
            console.debug("service.getLineItems: No Lineitems registered. Fetching...");
            service.fetchLineItems();
        }
        return service.lineitems;
    }

    service.getCurrentLineItem = function() {
        return service.selected_lineitem;
    }

    service.nextBarcode = function(bc,bcCount,use_checkdigit) {
        service.currently_generating = true;
        return egCore.net.request(
            'open-ils.cat',
            'open-ils.cat.item.barcode.autogen',
            egCore.auth.token(),
            bc, bcCount, { checkdigit: use_checkdigit }
        ).then(function(resp) { // get_barcodes
            var evt = egCore.evt.parse(resp);
            if (!evt) return resp;
            return '';
        });
    };

    service.checkBarcode = function(bc) {
        if (bc != Number(bc)) return false;
        bc = bc.toString();
        // "16.00" == Number("16.00"), but the . is bad.
        // Throw out any barcode that isn't just digits
        if (bc.search(/\D/) != -1) return false;
        var last_digit = bc.substr(bc.length-1);
        var stripped_barcode = bc.substr(0,bc.length-1);
        return service.barcodeCheckdigit(stripped_barcode).toString() == last_digit;
    };

    service.barcodeCheckdigit = function(bc) {
        var reverse_barcode = bc.toString().split('').reverse();
        var check_sum = 0; var multiplier = 2;
        for (var i = 0; i < reverse_barcode.length; i++) {
            var digit = reverse_barcode[i];
            var product = digit * multiplier; product = product.toString();
            var temp_sum = 0;
            for (var j = 0; j < product.length; j++) {
                temp_sum += Number( product[j] );
            }
            check_sum += Number( temp_sum );
            multiplier = ( multiplier == 2 ? 1 : 2 );
        }
        check_sum = check_sum.toString();
        var next_multiple_of_10 = (check_sum.match(/(\d*)\d$/)[1] * 10) + 10;
        var check_digit = next_multiple_of_10 - Number(check_sum); if (check_digit == 10) check_digit = 0;
        return check_digit;
    };

    service.get_locations = function(orgs) {
        return egCore.pcrud.search('acpl',
            {owning_lib : orgs, deleted : 'f'},
            {
                flesh : 1,
                flesh_fields : {
                    acpl : ['owning_lib']
                },
                order_by : { acpl : 'name' }
            },
            {atomic : true}
        );
    };

    service.get_circ_mods = function() {
        if (egCore.env.ccm)
            return $q.when(egCore.env.ccm.list);

        return egCore.pcrud.retrieveAll('ccm', {}, {atomic : true}).then(
            function(list) {
                egCore.env.absorbList(list, 'ccm');
                return list;
            }
        );

    };

    service.addHotkey = function(key, desc, elm) {
        angular.forEach(key.split(' '), function(k) {
            hotkeys.add({
                combo: k,
                description: desc,
                callback: function(e) {
                    e.preventDefault();
                    return $timeout(function(){$(elm).trigger('click')});
                }
            });
        });
    }

    return service;
}])

.directive("egUpdateItemHotkey", function() {
    return {
        restrict: 'A',
        controller: ['$scope','$q','$timeout','$element','updateItemSvc','egCore',
            function ( $scope , $q , $timeout , $element , updateItemSvc , egCore) {

            function find_accesskeys(elm) {
                    elm = angular.element(elm);
                    if (elm.attr('eg-accesskey')) {
                        updateItemSvc.addHotkey(
                            elm.attr('eg-accesskey'),
                            elm.attr('eg-accesskey-desc'),
                            elm
                        );
                    }
                    angular.forEach(elm.children(), find_accesskeys);
                }

                egCore.startup.go().then(
                    function() {
                        $timeout(function(){find_accesskeys($element)});
                    }
                );
        }]
    }
})

.directive("egLineItemDropdown", function() {
    return {
        restrict: 'E',
        replace: true,
        template:
        '<div class="input-group">' +
            '<div class="input-group-addon">Lineitem</div>' +
                '<div ng-if="purchaseOrders.length">' +
                    '<select class="form-control" ng-model="selectedPO"' +
                        'ng-init="initLineItem()"' +   
                        'ng-change="updatePO()"' +
                        'ng-options="li.dropdownLabel for li in purchaseOrders track by li.po_id">' +
                    '</select>' +
                '</div>' +
                '<div ng-if="!purchaseOrders.length">' +
                    '<select class="form-control">' +
                        '<option value="">{{strings.noneOption}}</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
        '</div>',

        controller : "UpdateCtrl"
    }
})

.directive("egProductOrderNotes", function() {
    return {
        restrict: 'E',
        replace: true,
        template:
            '<div class="row" ng-repeat="note in currentLineItem.notes track by note.id">' +
              '<div class="col-md-12 well">' +
                '<div class="row">' +
                  '<div class="col-md-2">' +
                    '{{note.create_time | date: "yyyy-MM-dd"}}' +
                  '</div>' +
                  '<div class="col-md-10">' +
                    '{{note.value}}' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>',
        controller: "UpdateCtrl"
    }
})

.directive("egLineItemSaveButton", function() {
    return {
        restrict: 'E',
        template:
          '<button class="btn btn-default" type="button"' +
            'ng-click="saveLineItem(exit)" ng-disabled="!selected" eg-accesskey="{{accessKey}}" eg-accesskey-desc="{{content}}" >' +
              '{{content}}' +
            '</button>',
        scope: {exit: "=", content: "=", noteData: "=", printOptions: "=", itemArgs: "=", selected: "=", accessKey: "="},
        controller : ['$scope','$q','$timeout','$element','$window','egConfirmDialog','egAlertDialog','egProgressDialog','updateItemSvc','egCore',
            function ( $scope , $q , $timeout , $element , $window , egConfirmDialog , egAlertDialog , egProgressDialog , updateItemSvc , egCore) {
                $scope.saveLineItem = function(exit) {
                    if ($scope.selected) {
                        copies = $scope.collectCopies();

                        egProgressDialog.open();
                        $timeout(function() {
                            updateItemSvc.saveChanges({
                                exit: exit,
                                copies: copies,
                                add_notes: $scope.noteData.add_notes,
                                note_a: $scope.noteData.note_a,
                                note_b: $scope.noteData.note_b,
                                print_options: $scope.printOptions
                            });
                        },1000);
                    } else {
                        return egAlertDialog.open(
                            egCore.strings.UPDATE_ITEMS_NO_CHANGES,
                        ).result;
                    }
                }

                $scope.collectCopies = function() {
                    var copies = [];
                    angular.forEach(updateItemSvc.getCurrentLineItem().orgs, function(org) {
                        angular.forEach(org.vols, function(volume) {
                            var promises = [];
                            promises.push(updateItemSvc.find_or_create_volume(volume.cn_label, updateItemSvc.record_id, org.id).then(function(res) {
                                return res;
                            }));

                            $q.all(promises).then(function(vol_id) {
                                angular.forEach(volume.copies, function(copy) {
                                    var orig_cp = updateItemSvc.findCopy(copy.id);
                                    var cp = egCore.idl.fromHash('acp', copy);
                                    cp.status(copy.status.id);
                                    cp.call_number(vol_id[0]);
                                    if ($scope.itemArgs.location) cp.location($scope.itemArgs.location);
                                    if ($scope.itemArgs.circ_modifier) cp.circ_modifier($scope.itemArgs.circ_modifier);
                                    if ($scope.itemArgs.circulate == true) cp.circulate('t');
                                    if ($scope.itemArgs.circulate == false) cp.circulate('f');
                                    if ($scope.itemArgs.price) cp.price($scope.itemArgs.price);

                                    if (updateItemSvc.compareCopy(cp, orig_cp)) {
                                        cp.ischanged(true);
                                        copies.push(cp);
                                    }
                                });
                            });
                        });
                    });
                    return copies;
                }
            }],
            link: function(scope, element, attrs) {
                var noteData = scope.noteData;
                var itemArgs = scope.itemArgs;

                scope.$watch('noteData', function(value) {
                    noteData = value;
                });
                scope.$watch('itemArgs', function(value) {
                    itemArgs = value;
                });
            }
    }
})

.directive('egBarcodeEnter', function() {
    return {
        restrict: 'A',
        link: function ($scope, elem) {
            elem.bind('keydown', function(e) {
                var code = e.keyCode || e.which;
                if (code == 13 && $scope.copy.barcode) {
                    var barcodes = document.getElementsByClassName('barcode-field');
                    var arrayEndIndex = barcodes.length - 1;
                    for (var i = 0; i < barcodes.length; i++) {
                        if (barcodes[i].value == $scope.copy.barcode && i != arrayEndIndex) {
                            barcodes[i + 1].select();
                            barcodes[i + 1].focus();
                        }
                    }
                }
            });
        }
    }
})

.controller('UpdateCtrl',
       ['$scope','$q','$window','$routeParams','$location','$timeout','$filter','egCore','updateItemSvc','egConfirmDialog','ngToast',
function($scope , $q , $window , $routeParams , $location , $timeout , $filter , egCore , updateItemSvc , egConfirmDialog , ngToast) {
    var staff_initials = egCore.auth.user().second_given_name();
    var noteDate = $filter('date')(new Date(), "dd/MM/yy");
    $scope.record_id = $routeParams.dataKey;
    $scope.purchaseOrders = updateItemSvc.getLineItems();
    if(JSON.parse(window.localStorage.getItem('cat.copy.last_template'))){
        $scope.selectedTemplate = JSON.parse(window.localStorage.getItem('cat.copy.last_template'));
    }
    $scope.i18n = egCore.i18n;
    $scope.strings = {
        noneOption : egCore.strings.UPDATE_ITEMS_NONE,
        warningNoSelectedPO : egCore.strings.UPDATE_ITEMS_WARNING_NO_SELECTED_PO,
        warningNoAvailablePO : egCore.strings.UPDATE_ITEMS_WARNING_NO_AVAILABLE_PO,
        warningNoNotes : egCore.strings.UPDATE_ITEMS_WARNING_NO_NOTES,
        warningUnknownError : egCore.strings.UPDATE_ITEMS_WARNING_FAILED_TO_DISPLAY_LINEITEM,
        saveChanges : egCore.strings.UPDATE_ITEMS_HOTKEY_SAVE,
        saveExit : egCore.strings.UPDATE_ITEMS_HOTKEY_SAVE_EXIT,
        saveAccessKey : "alt+shift+s",
    }

    $scope.itemArgs = {use_checkdigit: false};
    $scope.printOptions = {
        print_label: false,
        print_worksheet: false
    };
    $scope.templates = {};
    $scope.template_name_list = [];
    $scope.noteData = {
        add_notes: false,
        note_a: "PROC:" + staff_initials + " " + noteDate,
        note_b: null
    }
    $scope.circ_modifier_list = [];
    $scope.location_list = [];

    egCore.net.request(
        'open-ils.cat',
        'open-ils.cat.biblio.record.marc_cn.retrieve',
        $scope.record_id
    ).then(function(cn_list) {
        $scope.marc_cns = [];
        for (var i = 0; i < cn_list.length; i++) {
            var key = Object.keys(cn_list[i]);
            var value = Object.values(cn_list[i]);
            if (key == 092) {
                $scope.marc_cns.push(value[0]);
            }
            if (key == 099) {
                $scope.marc_cns.push(value[0]);
            }
        }
    });

    updateItemSvc.get_circ_mods().then(function(list) {
        $scope.circ_modifier_list = list;
    });

    updateItemSvc.get_locations(egCore.auth.user().ws_ou()).then(function(list) {
        $scope.location_list = list;
    });

    $scope.setCheckboxValues = function() {
        $scope.$watch('itemArgs.use_checkdigit', function(newVal, oldVal) {
            if (typeof newVal == 'undefined') {
                newVal = false;
            }
            egCore.hatch.setItem('eg.acq.update_items.use_checkdigit', newVal);
        });
        $scope.$watch('printOptions.print_label', function(newVal, oldVal) {
            if (typeof newVal == 'undefined') {
                newVal = false;
            }
            egCore.hatch.setItem('eg.acq.update_items.print_labels', newVal);
        });
        $scope.$watch('printOptions.print_worksheet', function(newVal, oldVal) {
            if (typeof newVal == 'undefined') {
                newVal = false;
            }
            egCore.hatch.setItem('eg.acq.update_items.print_worksheet', newVal);
        });
    }

    $scope.fetchCheckboxValues = function() {
        var useCheckdigit = egCore.hatch.getItem('eg.acq.update_items.use_checkdigit');
        useCheckdigit.then(function(checkboxValue) {
            $scope.itemArgs.use_checkdigit = checkboxValue;
        });

        var printLabels = egCore.hatch.getItem('eg.acq.update_items.print_labels');
        printLabels.then(function(checkboxValue) {
            $scope.printOptions.print_label = checkboxValue;
        });

        var printWorksheet = egCore.hatch.getItem('eg.acq.update_items.print_worksheet');
        printWorksheet.then(function(checkboxValue) {
            $scope.printOptions.print_worksheet = checkboxValue;
        });
    }
    $scope.fetchCheckboxValues();

    $scope.circulateButtonClasses = function(circulateLabel) {
        if (circulateLabel == $scope.itemArgs.circulate) {
            return "btn btn-primary ng-untouched ng-valid ng-dirty active ng-not-empty ng-valid-parse";
        } else {
            return "btn btn-primary"
        }
    }

    /**
     * When the barcode input is clicked once, then highlight it
     */
    $scope.clickBarCode = function(e) {
        if(window.getSelection().type == "Caret"){
            e.select();
            e.focus();
        }
    }

    $scope.updateVolCopy = function() {
        updateItemSvc.updateLocalLineItemData($scope.currentLineItem);
    }

    $scope.fetchTemplates = function () {
        egCore.hatch.getItem('cat.copy.templates').then(function(templates) {
            if (templates) {
                $scope.templates = templates;
                $scope.template_name_list = Object.keys(templates);
            }
        });
    }
    $scope.fetchTemplates();

    $scope.applyTemplate = function(template) {
        egCore.hatch.setItem('cat.copy.last_template', template);
    }
    $scope.onApplyClick = function() {
        egCore.hatch.getItem('cat.copy.last_template').then(function(template) {
        if (template) {
            angular.forEach($scope.templates[template], function (value,key) {
            if (!angular.isObject(value)) {
                $scope.itemArgs[key] = angular.copy(value);
            }
        });
        }
    });
    }

    $scope.initLineItem = function() {
        $scope.selectedPO = $scope.purchaseOrders[0];
        $scope.updatePO();
    }

    $scope.updatePO = function() {
        $scope.selectedTemplate = JSON.parse(window.localStorage.getItem('cat.copy.last_template'));

        $scope.lineitemDisplayErrorFlag = false;

        if ($scope.selectedPO && $scope.selectedPO.orgs.length) {
            $scope.currentLineItem = $scope.selectedPO;
            updateItemSvc.updateLocalLineItemData($scope.selectedPO);
            $scope.itemArgs.location = $scope.selectedPO.orgs[0].vols[0].copies[0].location;
            $scope.itemArgs.circ_modifier = $scope.selectedPO.orgs[0].vols[0].copies[0].circ_modifier;
            $scope.itemArgs.circulate = $scope.selectedPO.orgs[0].vols[0].copies[0].circulate;
            $scope.itemArgs.price = $scope.selectedPO.orgs[0].vols[0].copies[0].price;
        } else {
            if ($scope.selectedPO) $scope.lineitemDisplayErrorFlag = true;
            $scope.currentLineItem = null;
            $scope.itemArgs.location = null;
            $scope.itemArgs.circ_modifier = null;
            $scope.itemArgs.circulate = null;
            $scope.itemArgs.price = null;
        }
    }

    $scope.callnumberBatchApply = function() {
        angular.forEach(updateItemSvc.getCurrentLineItem().orgs, function(org) {
            angular.forEach(org.vols, function(vol) {
                if ($scope.batchApply) {
                    vol.cn_label = $scope.batchApply.callnumber;
                } else {
                    vol.cn_label = "";
                }
            });
        });
    }

    $scope.autogenBarcode = function() {
        var volumeCount = 0

        angular.forEach(updateItemSvc.getCurrentLineItem().orgs, function(org) {
           angular.forEach(org.vols, function(vol) {
                volumeCount = volumeCount + vol.copies.length;
           });
        });

        updateItemSvc.nextBarcode(
            $scope.selectedPO.orgs[0].vols[0].copies[0].barcode,
            volumeCount - 1,
            $scope.itemArgs.use_checkdigit).then(function(res){
                $scope.barcodes = res;
                var currentCopy = 0;
                angular.forEach(updateItemSvc.getCurrentLineItem().orgs, function(org) {
                    angular.forEach(org.vols, function(vol) {
                        for (c = 0; c < vol.copies.length; c++) { 
                            if (currentCopy != 0) {
                            vol.copies[c].barcode = $scope.barcodes[currentCopy - 1];}
                            currentCopy++
                        }
                    });     
                })  
         });
    }

    $scope.barcodeBoxValidation = function(copy,args,cssBoolean) {
        if (!args.use_checkdigit) {
            copy._invalidBarcode = false;
            return true;
        } else {
            var barcodeNum;
            var barcode = copy.barcode;
            var barcodeSplit = barcode.split(/^\D*/);
            if(barcodeSplit[1]) {
                barcodeNum = barcodeSplit[1];
            } else {
                barcodeNum = barcodeSplit[0];
            }
            var isValid = updateItemSvc.checkBarcode(barcodeNum);

            if (cssBoolean && !isValid) {
                copy._invalidBarcode = true;
                return 'alert-danger';
            } else if (cssBoolean && isValid) {
                copy._invalidBarcode = false;
            }
            return isValid;
        }
    }

    $scope.barcodeCheck = function(copy) {
        $scope.updateVolCopy();
        var validBarcode = $scope.barcodeBoxValidation(copy,$scope.itemArgs);
        if (!validBarcode) {
            ngToast.danger(copy.barcode + " " + egCore.strings.UPDATE_ITEMS_WARNING_INVALID_CHECKDIGIT);
        }
    }

    $scope.editItemAttributes = function() {
        var copyIds = [];
        angular.forEach(updateItemSvc.getCurrentLineItem().orgs, function(org) {
            angular.forEach(org.vols, function(vol) {
                angular.forEach(vol.copies, function(copy) {
                    copyIds.push(copy.id);
                });
            });
        });
        egCore.net.request(
            'open-ils.actor',
            'open-ils.actor.anon_cache.set_value',
            null, 'edit-these-copies', {
                record_id: $scope.record_id,
                copies: copyIds,
                hide_vols : true,
                hide_copies : false
            }
        ).then(function(key) {
            if (key) {
                var url = egCore.env.basePath + 'cat/volcopy/' + key;
                $timeout(function() { $window.open(url, '_blank') });
                return egConfirmDialog.open(
                  egCore.strings.UPDATE_ITEMS_REFRESH_REQUEST_TITLE,
                  egCore.strings.UPDATE_ITEMS_REFRESH_REQUEST,
                  null,
                  egCore.strings.UPDATE_ITEMS_REFRESH,
                  egCore.strings.UPDATE_ITEMS_NOREFRESH
                ).result.then(function() {
                    $window.location.reload();
                });
            } else {
                alert('Could not create anonymous cache key!');
            }
        });
    }
}])