dojo.require('dijit.Dialog');
dojo.require('dijit.form.DateTextBox');
dojo.require('dijit.form.Button');
dojo.require('dojo.date.locale');
dojo.require("fieldmapper.Fieldmapper");
dojo.require('openils.CGI');
dojo.require('openils.PermaCrud');
dojo.require('openils.Util');
dojo.require('openils.XUL');

var cgi = new openils.CGI();
var pcrud = new openils.PermaCrud();
var page_size = 50; // TODO UI
var page_offset = 0; // TODO UI
var start_date;
var end_date;
// Max summary display field length before truncation
var max_val_length = 80;
var headings_tbody;
var template_row;
var cached_headings
var all_fetched;
var mattypes = [];
var mattype_container;
var mattype_template;

// Force a minimum start date for new headings to avoid reporting on
// (practically) all headings, which occurs when the start date preceeds
// or includes the SQL deployment date, which stamps a create_date on
// every heading to NOW().  Such queries cause heavy load and eventually
// time out anyway.
// NOTE: using English dates instead of ISO dates since English
// dates tell Date.parse() to use the local time zone instead of UTC.
var min_start_date = new Date(Date.parse('December 5, 2016 00:00:00'));

var summary_fields = [
    'prev_entry_value',
    'entry_value',
    'next_entry_value',
    'field_label',
    'bib_record',
    'heading_date',
    'bib_editor_usrname',
    'prev_auth_tag',
    'next_auth_tag',
    'bib_marc_1xx',
    'bib_marc_245'
];

var extended_fields = [
    'prev_entry',
    'prev_bib_record',
    'prev_field_label',
    'entry',
    'entry_create_date',
    'bib_edit_date',
    'bib_create_date',
    'bib_cataloging_date',
    'next_entry',
    'next_bib_record',
    'next_field_label',
];

extended_fields = extended_fields.concat(summary_fields);

function load() {

    if (!headings_tbody) {
        headings_tbody = dojo.byId('headings-tbody');
        template_row = headings_tbody.removeChild(
            dojo.byId('headings-row-template'));
    } 

    if (!mattype_container) {
        mattype_container = dojo.byId('mattype-select-container');
        mattype_template = mattype_container.removeChild(
            dojo.byId('mattype-filter-template'));
    }

    fetch_mattypes();

    setup_paging();

    dojo.byId('apply-dates-btn').onclick = function() {
        page_offset = 0;
        load_headings(true); // reset 
    }

    // seed the report date with yesterday's date.
    var initDate = new Date();
    initDate.setDate(initDate.getDate() - 1);
    startDate.attr('value', initDate);
    endDate.attr('value', initDate);
}

function fetch_mattypes() {

    pcrud.search('ccvm', {ctype : 'mattype'}, {
        order_by : {ccvm : ['value']},
        async : true,
        oncomplete : function(r) { 
            mattypes = openils.Util.readResponse(r);
            dojo.forEach(mattypes, function(type) {
                var row = mattype_template.cloneNode(true);
                var namebox = openils.Util.getNodeByName('mattype-name', row);
                var chkbox = openils.Util.getNodeByName('mattype-checkbox', row);
                chkbox.setAttribute('code', type.code());
                namebox.innerHTML = type.value();
                // also modify checkbox by clicking on label
                namebox.onclick = function() {chkbox.checked = !chkbox.checked}
                mattype_container.appendChild(row);
            });
        }
    });
}

// Fetch headings.
// Limiting each pcrud query by browse_axis significantly speeds up
// the DB query, so fetch in order of display: author -> subject -> series.
function load_headings(is_new, new_page) {

    if (is_new) { // reset cache
        cached_headings = [];
        all_fetched = false;
        new_page = true;
        openils.Util.hide('zero-hits');
    }

    if (new_page) {
        openils.Util.show('loading-indicator');
        dojo.byId('ind-page').innerHTML = page_number();
        openils.Util.hide('headings-table');
        openils.Util.hide('author-header-row');
        openils.Util.hide('subject-header-row');
        openils.Util.hide('series-header-row');
        dojo.query('[class=heading-row]').forEach(function(node) {
            node.parentNode.removeChild(node)
        });
    }

    // force the main dojo body div to scroll to the top
    // during all navigation.
    dojo.byId('oils-base-body-block').scrollTop = 0;

    if (cached_headings.length >= page_offset + page_size || all_fetched) {
        return draw();
    }

    /* cache 4 pages, plus 1 heading at a time */
    var fetch_count = page_size * 4 + 1;

    pcrud.search('rcbed', compile_query_filter(), {
        offset : page_offset,
        limit : fetch_count, 
        async : true,
        oncomplete : function(r) { 
            var new_headings = openils.Util.readResponse(r);
            cached_headings = cached_headings.concat(new_headings);

            var fetched = new_headings.length;
            console.log('Loaded ' + fetched + ' headings');

            if (fetched < fetch_count) all_fetched = true;
            draw();
        }
    });
}

function compile_query_filter() {
    start_date = startDate.attr('value');
    end_date = endDate.attr('value');

    if (!start_date || start_date < min_start_date) {
        console.log("Selected start date " + start_date + " is too early. "
            + "Using min start date " + min_start_date + " instead");

        // clone the date since it will get clobbered by getYMD.
        startDate.attr('value', min_start_date);
        start_date = min_start_date;
    }

    start_date = openils.Util.getYMD(start_date);

    if (end_date) {
        // the end date has to be extended by one day, since the between
        // query cuts off at midnight (0 hour) on the end date, which 
        // would miss all headings for that date created after hour 0.
        // note: setDate() will rollover to the next month when needed.
        end_date.setDate(end_date.getDate() + 1);
        end_date = openils.Util.getYMD(end_date);
    }

    var query_filter = {}

    if (start_date && end_date) {
        // use -and instead of BETWEEN so that end_date is not inclusive.
        query_filter['-and'] = [
            {heading_date : {'>=' : start_date}},
            {heading_date : {'<' : end_date}}
        ];
    } else if (start_date) {
        query_filter.heading_date = {'>=' : start_date};
    } else {
        query_filter.heading_date = {'<' : end_date};
    }

    dojo.query('[name=mattype-checkbox]').forEach(function(chkbox) {
        if (chkbox.checked) {
            if (!query_filter.mattype)
                query_filter.mattype = {'not in' : []};
            query_filter.mattype['not in'].push(chkbox.getAttribute('code'));
        }
    });

    return query_filter;
}

function page_number() {
    return (page_offset / page_size) + 1
}

function setup_paging() {

    dojo.byId('page-number').innerHTML = page_number();

    dojo.byId('prev-page-btn').onclick = function() {
        if (page_offset <= 0) return;
        page_offset -= page_size;
        load_headings(false, true);
        dojo.byId('page-number').innerHTML = page_number();
    }

    dojo.byId('next-page-btn').onclick = function() {
        page_offset += page_size;
        load_headings(false, true);
        dojo.byId('page-number').innerHTML = page_number();
    }
}

function draw() {

    headings = cached_headings.slice(page_offset, page_offset + page_size);
    openils.Util.hide('loading-indicator');

    if (headings.length == 0) {
        openils.Util.show('zero-hits');
        return;
    }

    openils.Util.show('headings-table', 'table');

    if (page_offset == 0) {
        dojo.byId('prev-page-btn').setAttribute('disabled', true);
    } else {
        dojo.byId('prev-page-btn').removeAttribute('disabled');
    }

    console.log('total = ' + cached_headings.length);
    console.log('page size = ' + page_size);
    console.log('page offset = ' + page_offset);

    if (cached_headings.length > page_size + page_offset) {
        dojo.byId('next-page-btn').removeAttribute('disabled'); 
    } else {
        dojo.byId('next-page-btn').setAttribute('disabled', true); 
    }

    dojo.forEach(headings, function(heading, idx) {

        var row = template_row.cloneNode(true);
        row.id = 'headings-row-' + idx;

        if (heading.browse_axis() == 'author') {
            headings_tbody.insertBefore(row, dojo.byId('subject-header-row')); 
            openils.Util.show('author-header-row', 'table-row');
        } else if (heading.browse_axis() == 'subject') {
            openils.Util.show('subject-header-row', 'table-row');
            headings_tbody.insertBefore(row, dojo.byId('series-header-row')); 
        } else {
            openils.Util.show('series-header-row', 'table-row');
            headings_tbody.appendChild(row);
        }

        if (!heading.prev_bib_record()) {
            openils.Util.show(
              openils.Util.getNodeByName('prev-auth-tag-wrapper', row),
              'inline'
            );
        }

        if (!heading.next_bib_record()) {
            openils.Util.show(
              openils.Util.getNodeByName('next-auth-tag-wrapper', row),
              'inline'
            );
        }
            
        dojo.forEach(summary_fields, function(heading_field) {
            var value = heading[heading_field]();

            if (heading_field.match(/date/)) {
                value = dojo.date.locale.format(
                    new Date(Date.parse(value)), {formatLength:'short'});
            } else {
                // prevent values from being crazy long
                if (value && value.length > max_val_length) 
                    value = value.substr(0, max_val_length) + '...';
            }

            openils.Util.getNodeByName(heading_field, row).innerHTML = value;

            if (heading_field == 'entry_value') {
                var link = openils.Util.getNodeByName(
                  'heading-dialog-link', row);

                link.onclick = function() {
                    flesh_details_dialog(heading);
                }
            } else if (heading_field.match('entry_value')) {
                var node = openils.Util.getNodeByName(
                   heading_field + '-auth-bib-tag', row);
                if (heading_field == 'prev_entry_value') {
                    node.innerHTML = heading.prev_bib_record() ? 'B: ' : 'A: ';
                } else {
                    node.innerHTML = heading.next_bib_record() ? 'B: ' : 'A: ';
                }
            }
        });

        openils.Util.getNodeByName('mattype_label', row).innerHTML = 
            mattypes.filter(function(m) {
                return m.code() == heading.mattype() })[0].value();
    });
}

function flesh_details_dialog(heading) {

    detail_dialog.show();

    dojo.forEach(extended_fields, function(heading_field) {
        var value = heading[heading_field]();

        if (heading_field.match(/date/)) {
            value = dojo.date.locale.format(
                new Date(Date.parse(value)), {formatLength:'short'});
        }
        
        try {
            openils.Util.getNodeByName('extended-' + heading_field, 
                detail_dialog.domNode).innerHTML = value;
        } catch (E) {
            console.error('Error setting value for field ' + heading_field);
            throw E;
        }
    });
}

dojo.addOnLoad(load);

