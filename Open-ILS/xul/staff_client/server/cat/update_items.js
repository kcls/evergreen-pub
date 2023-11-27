const g_max_copies_that_can_be_added_at_a_time_per_volume = 999;
const rel_vert_pos_volume_count = 1;
const rel_vert_pos_call_number = 2;
const rel_vert_pos_copy_count = 3;
const rel_vert_pos_barcode = 4;
const rel_vert_pos_copy_note = 5;
const update_timer = 1000;
const call_number_width = 145;
const barcode_width = 145;
const status_width = 90;
var g = {};
g.use_defaults = true;
g.map_acn = {};
g.volumes_by_ou = {};
g.acpl_list = [];


// This file was modeled off of volume_copy_creator.js, so if you need
// functionality back, take it from there
function my_init() {
    g.totalRows = 0;
    try {
        /* Initial setup */

        if (typeof JSAN == 'undefined') {

            throw( $("commonStrings").getString('common.jsan.missing') );
        }

        JSAN.use('cat.util');
        JSAN.use('OpenILS.data');
        JSAN.use('util.barcode');
        JSAN.use('util.date');
        JSAN.use('util.error');
        JSAN.use('util.file');
        JSAN.use('util.fm_utils');
        JSAN.use('util.functional');
        JSAN.use('util.money');
        JSAN.use('util.network');
        JSAN.use('util.widgets');

        g.data = new OpenILS.data();
        g.data.init({'via':'stash'});

        JSAN.errorLevel = "die"; // none, warn, or die
        JSAN.addRepository('/xul/server/');

        g.error = new util.error();
        g.error.sdump('D_TRACE','my_init() for cat/volume_copy_creator.xul');

        g.network = new util.network();

        g.refresh = xul_param('onrefresh');

        /////////////////////////// INITIALIZE DATA ///////////////////////////////////////
        var raw_lineitem_data = g.network.simple_request(
            'FM_OPEN_LI_RETRIEVE_BY_TCN',
            [ ses(), xul_param('doc_id') ]
        );
        
        // Create the list of lineitems
        g.lineitem_list = raw_lineitem_data[0][0];

        if (g.lineitem_list[0].length == 0){

            alert('TCN '+xul_param('doc_id')+"doesn't appear to have any open lineitems... ");
        }

        else{
            //copyTemplatecopyTemplate.push("owning_lib");
            g.current_lineitem_index = 0; // This keeps track of which lineitem we're on

            g.load_lineitem(raw_lineitem_data);

            g.render_batch_button();

            g.render_lineitem_dropdown();
            
            g.load_and_render_lineitem_notes(g.lineitem_list[g.current_lineitem_index][0]);

            /***********************************************************************************************************/
            /* What record am I dealing with?  */
            g.doc_id = g.doc_id || xul_param('doc_id');

            if (! g.doc_id) {

                alert('Error in update_items.js, g.doc_id not valid'+": 187");
                window.close(); return;
            }

            var sb = document.getElementById('summary_box');

            if (xul_param('no_bib_summary')) {

                sb.hidden = true;
                sb.nextSibling.hidden = true; /* splitter */
            }

            else {

                while(sb.firstChild){

                    sb.removeChild(sb.lastChild);
                }

                var summary = document.createElement('iframe');
                sb.appendChild(summary);
                summary.setAttribute('src',urls.XUL_BIB_BRIEF);
                summary.setAttribute('flex','1');
                get_contentWindow(summary).xulG = { 'docid' : g.doc_id };
            }

            /***********************************************************************************************************/
            /* Setup pcrud and fetch the monographic parts for this bib */

            dojo.require('openils.PermaCrud');
            g.pcrud = new openils.PermaCrud({'authtoken':ses()});

            /***********************************************************************************************************/
            /* For the batch drop downs */

            // OPENSRF call made
            cat.util.render_callnumbers_for_bib_menu('marc_cn',g.doc_id, g.label_class, call_number_width);

            var control_bar = document.getElementById('misc_control_bar');

            // Sets the font
            control_bar.setAttribute('class','ALL_FONTS_8PT');

            // Setup checkboxes

            // Worksheet checkbox
            var worksheetCheckbox = document.createElement('checkbox');
            worksheetCheckbox.setAttribute('id','print_worksheet');
            worksheetCheckbox.setAttribute('label',$('catStrings').getString('staff.cat.update_items.print_worksheet'));
            control_bar.appendChild( worksheetCheckbox );

            // Add Notes checkbox
            var noteCheckbox = document.createElement('checkbox');
            noteCheckbox.setAttribute('id','li_note_checkbox');
            noteCheckbox.setAttribute('label',$('catStrings').getString('staff.cat.update_items.lineitem_note.default'));

            if (g.data.notes_toggle == true){noteCheckbox.setAttribute('checked', true);}

            noteCheckbox.addEventListener('click',function(ev)
                {
                    if ($('li_note_checkbox').checked){g.data.notes_toggle = false;}
                    else{g.data.notes_toggle = true;}
                    g.data.stash(g.data.notes_toggle);
                }
            );

            control_bar.appendChild( noteCheckbox );

            // Make the textbox for the default note
            var default_liNote = document.createElement('textbox');
            default_liNote.setAttribute('id','default_li_note');
            control_bar.appendChild( default_liNote );

            // Now we add the default note text using the logged in staff's 'middle name'
            // If my initials are 'DJC' and the date is '3/6/14', the note should read: 'REC:DJC 3/6/14'
            var d = new Date();
            var date = (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear().toString().slice(-2);
            var staff_initials = ses('staff').second_given_name();
            var default_note = 'PROC:'+staff_initials+" "+date;
            default_liNote.setAttribute('value',default_note);

            // Create label for the custom note
            var liNoteLabel = document.createElement('label');
            liNoteLabel.setAttribute('id','custom_li_note_label');
            liNoteLabel.appendChild(document.createTextNode($('catStrings').getString('staff.cat.update_items.lineitem_note.custom')));
            control_bar.appendChild( liNoteLabel );

            // Align the label so it looks nice
            liNoteLabel.setAttribute('style', 'line-height:12px;padding-top:6px;');

            // Make the textbox
            var liNote = document.createElement('textbox');
            liNote.setAttribute('id','custom_li_note');
            control_bar.appendChild( liNote );

            // Create fields from Edit Items
            g.retrieve_templates();
            g.setGridId();

            // To populate g.data with current data
            g.data.stash_retrieve();

            // g.data.list.au[0].ws_ou() is the current workstations lib id
            g.init_edit_item_panes(g.data.list.au[0].ws_ou());
            g.summarize( g.existing_copies );
            g.render_edit_items_panes();

            // Set the default call number label for dropdown
            document.getElementById('marc_cn_menulist').selectedIndex = 1;
        }
    } catch(E) {

        var err_msg = $("commonStrings").getFormattedString('common.exception', ['cat/volume_copy_creator.js', E]);

        try {

            g.error.sdump('D_ERROR',err_msg);
        }

        catch(E) {

            dump(err_msg);
            dump(js2JSON(E));
        }

        alert(err_msg+": 111");
    }
}

g.load_and_render_lineitem_notes = function(lineitem_id) {
	// Fetch the notes from the DB
	var line_item_notes = g.network.simple_request(
			'FM_LI_NOTES_RETRIEVE_BY_ID',
			[ ses(), lineitem_id ]
		);

 	var rows = document.getElementById('lineitem_rows');
	
	// Remove existing notes
	var row_list = rows.childNodes;
	while(row_list.length > 1) {
		rows.removeChild(row_list[1]);
	}
		
	// Render the notes
	for(var index = 0; index < line_item_notes.length; ++index) {
		var r = document.createElement('row'); rows.appendChild( r );
		var x = document.createElement('label'); r.appendChild(x);
		x.setAttribute('value', line_item_notes[index].edit_time.substring(0,10));
		x = document.createElement('spacer'); r.appendChild(x);
		x = document.createElement('label'); r.appendChild(x);
		x.setAttribute('value', line_item_notes[index].value);
	}
}

g.load_lineitem = function(raw_lineitem_data){
    var raw_data = raw_lineitem_data[0][1];
    var copyTemplate = raw_lineitem_data[1].acp;
    var volumeTemplate = raw_lineitem_data[1].acn;
    var volTemplate = [];

    for (var i in volumeTemplate){

        if (volumeTemplate[i] != "copies" &&
            volumeTemplate[i] != "notes" &&
            volumeTemplate[i] != "uri_maps" &&
            volumeTemplate[i] != "uris"){

            volTemplate.push(volumeTemplate[i]);
        }
    }

    var copies = [];

    // Load all relevant data structures via raw DB data
    for (var i in raw_data){

        var status_string = raw_data[i].pop();
        var copy_data = raw_data[i].slice(0,31);
        var volume_data = raw_data[i].slice(31,44);
        var new_volume = new acn();

        for (var m in volTemplate){

            var val = volume_data[m];

            // booleans get a db type assignment
            val = g.makeDBFriendly(val, new_volume.Structure.fields[m].datatype);

            if (typeof new_volume[volTemplate[m]] == 'function'){

                new_volume[volTemplate[m]](val);
            }

            else {

                new_volume.a[m] = val;
            }
        }

        if (!g.map_acn[new_volume.id()] && new_volume){

            g.map_acn[new_volume.id()] = new_volume;

            if (!g.volumes_by_ou[new_volume.owning_lib()]){

                g.volumes_by_ou[new_volume.owning_lib()] = [];
            }

            g.volumes_by_ou[new_volume.owning_lib()].push(new_volume.id());
        }

        else if(new_volume){

            new_volume = g.map_acn[new_volume.id()];
        }

        var new_copy = new acp();

        for (var m in copyTemplate){

            var val = copy_data[m];

            // booleans get a db type assignment
            val = g.makeDBFriendly(val, new_copy.Structure.fields[m].datatype);

            if (typeof new_copy[copyTemplate[m]] == 'function'){

                if (copyTemplate[m] == "call_number"){

                    if (new_volume.id() && val == new_volume.id()){

                        new_copy.call_number(new_volume);
                    }

                    else{

                        new_copy.call_number(val);
                    }
                }

                else {

                    new_copy[copyTemplate[m]](val);
                }
            }

            else {

                new_copy.a[m] = val;
            }
        }

        new_copy.status_string = status_string;
        copies.push(new_copy);
    }

    // set the current callnumber label
    var marc = g.lineitem_list[g.current_lineitem_index][2];
    g.callnumber_label = marc.replace(/.*<datafield tag="09\w"/,'');
    g.callnumber_label = g.callnumber_label.replace(/<\/subfield>.*/,'');
    g.callnumber_label = g.callnumber_label.replace(/.*<subfield code="a">/,'');

    // Set global copies
    g.existing_copies = copies || [];

    if (xulG.unified_interface) {

        $('non_unified_buttons').hidden = true;

        xulG.apply_template_to_batch = function(id,value) {

            if (!isNaN(Number(value))) {

                $(id).value = value;
                util.widgets.dispatch('command',$(id));
            }

            util.widgets.dispatch('command',$('batch_button'));
        }

    }

    else {

        $('Create').hidden = true;
    }

    /***********************************************************************************************************/

    if (g.existing_copies.length > 0) {

        g.set_attr('EditThenCreate','label','staff.cat.update_items.edit_then_rebarcode.btn.label');
        g.set_attr('EditThenCreate','accesskey','staff.cat.volume_copy_creator.edit_then_rebarcode.btn.accesskey');
        g.set_attr('CreateWithDefaultsNoClose','label','staff.cat.volume_copy_creator.rebarcodenoclose.btn.label');
        g.set_attr('CreateWithDefaults','label','staff.cat.volume_copy_creator.rebarcode.btn.label');
        g.set_attr('CreateWithDefaults','accesskey','staff.cat.volume_copy_creator.rebarcode.btn.accesskey');
        g.set_attr('Create','label','staff.cat.volume_copy_creator.rebarcode.btn.label');
        g.set_attr('Create','accesskey','staff.cat.volume_copy_creator.rebarcode.btn.accesskey');
    }

    else {

        g.set_attr('EditThenCreate','label','staff.cat.volume_copy_creator.edit_then_create.btn.label');
        g.set_attr('EditThenCreate','accesskey','staff.cat.volume_copy_creator.edit_then_create.btn.accesskey');
        g.set_attr('CreateWithDefaults','label','staff.cat.volume_copy_creator.create_with_defaults.btn.label');
        g.set_attr('CreateWithDefaults','accesskey','staff.cat.volume_copy_creator.create_with_defaults.btn.accesskey');
        g.set_attr('Create','label','staff.cat.volume_copy_creator.create.btn.label');
        g.set_attr('Create','accesskey','staff.cat.volume_copy_creator.create.btn.accesskey');
    }

    var ou_ids = [];

    // Get the default callnumber classification scheme from OU settings
    // or a reasonable fall-back
    g.label_class = g.data.hash.aous['cat.default_classification_scheme'];

    // Assign a default value if none was returned
    // Begin by looking for the "Generic" label class by name
    if (!g.label_class) {

        for (var i = 0; i < g.data.list.acnc.length; i++) {

            if (g.data.list.acnc[i].name() == 'Generic') {

                g.label_class = g.data.list.acnc[i].id();
                break;
            }
        }
    }
    // Maybe this database has renamed or removed their Generic
    // entry; in that case, just return the first one that we
    // know exists
    if (!g.label_class) {

        g.label_class = g.data.list.acnc[0].id();
    }


    /***********************************************************************************************************/

    // Make a lookup object for existing copies keyed on org id and callnumber id, and another keyed on copy id. */

    // g.org_label_existing_copy_map = { ou_id : { vol_id : [ copy1, copy2, ... ] }, ... }
    g.org_label_existing_copy_map = {};

    // g.id_copy_map = { acp_id : acp, ... }
    g.id_copy_map = {};

    for (var i = 0; i < g.existing_copies.length; i++) {

        var copy = g.existing_copies[i];
        g.id_copy_map[ copy.id() ] = copy;
        var owning_lib;

        if (typeof copy.call_number() == "object" && copy.call_number().owning_lib()){

            owning_lib = copy.call_number().owning_lib();
        }

        if (!g.org_label_existing_copy_map[ owning_lib ]) {

            ou_ids.push( owning_lib );
            g.org_label_existing_copy_map[ owning_lib ] = {};
        }

        if (! g.org_label_existing_copy_map[ owning_lib ][ copy.call_number().id() ]) {

            g.org_label_existing_copy_map[ owning_lib ][ copy.call_number().id() ] = [];
        }

        g.org_label_existing_copy_map[ owning_lib ][ copy.call_number().id() ].push( copy );
    }

    g.ou_ids = g.sort_ou_ids(ou_ids);

    /***********************************************************************************************************/
    /* render the orgs and volumes/input */

    g.render_loaded_lineitem();
}

/*
 * This renders all the lineitem data to the screen
 */

g.render_loaded_lineitem = function(){
    var rows = document.getElementById('rows');

    // For every library
    for (var i = 0; i < g.ou_ids.length; i++) {

        try {

            var org = g.data.hash.aou[ g.ou_ids[i] ];

            if ( get_bool( g.data.hash.aout[ org.ou_type() ].can_have_vols() ) ) {

                var r = document.createElement('row'); rows.appendChild( r );

                var x = document.createElement('label'); r.appendChild(x);
                    x.setAttribute('value', $("catStrings").getString('staff.cat.volume_copy_creator.library_label.value'));
                    x.setAttribute('style','font-weight: bold');
                x = document.createElement('label'); r.appendChild(x);
                    x.setAttribute('value', $("catStrings").getString('staff.cat.volume_copy_creator.num_of_volumes_label.value'));
                    x.setAttribute('style','font-weight: bold');
                x = document.createElement('label'); r.appendChild(x);
                    x.setAttribute('value', $("catStrings").getString('staff.cat.volume_copy_creator.render_callnumber_copy_count_entry.call_nums'));
                    x.setAttribute('style','font-weight: bold');
                x = document.createElement('label'); r.appendChild(x);
                    x.setAttribute('value',$("catStrings").getString('staff.cat.volume_copy_creator.render_callnumber_copy_count_entry.num_of_copies'));
                    x.setAttribute('style','font-weight: bold');
                x = document.createElement('label'); r.appendChild(x);
                    x.setAttribute('value',$("catStrings").getString('staff.cat.volume_copy_creator.render_callnumber_copy_count_entry.barcodes'));
                    x.setAttribute('style','font-weight: bold');
                x = document.createElement('label'); r.appendChild(x);
                    x.setAttribute('value',$("catStrings").getString('staff.cat.copy_editor.status'));
                    x.setAttribute('style','font-weight: bold');


                var row = document.createElement('row');
                rows.appendChild(row);
                row.setAttribute('ou_id',g.ou_ids[i]);

                // First render the library label
                g.render_library_label(row,g.ou_ids[i]);

                // Then enter the number of volumes
                var num_volumes = g.render_volume_count_entry( rows, row, g.ou_ids[i] );

                var isFirst = true;

                // Draw each volume
                for (var volume_id in g.org_label_existing_copy_map[g.ou_ids[i]]) {
                    // this draws a volume
                    g.render_callnumber_copy_count_entry(rows,row,g.ou_ids[i],isFirst, volume_id);

                    isFirst = false;
                }
            }
        }

        catch(E) {

            g.error.sdump('D_ERROR',E);
        }
    }

    g.common_ancestor_ou_ids = util.fm_utils.find_common_aou_ancestors( g.ou_ids ).reverse();

    g.load_prefs();

    try {

        $('main').parentNode.scrollLeft = 9999;
    }

    catch(E) {

        dump('Error in update_items.js, my_init(), trying to auto-scroll to the far right: ' + E + '\n');
    }

    if (typeof xulG.volume_ui_callback_for_unified_interface == 'function') {

        xulG.volume_ui_callback_for_unified_interface();
    }
}

g.render_barcode = function(
        vol_id,
        number_of_copies_textbox,
        barcode_column_box,
        ou_id,
        row
    ) {
    if ( Number( number_of_copies_textbox.value ) > g_max_copies_that_can_be_added_at_a_time_per_volume ) {
        g.error.yns_alert($("catStrings").getFormattedString('staff.cat.volume_copy_creator.render_volume_count_entry.message', [g_max_copies_that_can_be_added_at_a_time_per_volume]),
            $("catStrings").getString('staff.cat.volume_copy_creator.render_volume_count_entry.title'),
            $("catStrings").getString('staff.cat.volume_copy_creator.render_volume_count_entry.ok_label'),null,null,'');
        return;
    }

    var status_column_box = barcode_column_box.nextSibling;

    // if this exists, it's worth killing if the copy no longer exists
    // otherwise, don't bother
    if (status_column_box){

        // This will throw an error if status_column_box doesn't exist

        while (barcode_column_box.childNodes.length > Number(number_of_copies_textbox.value)) {

            barcode_column_box.removeChild( barcode_column_box.lastChild );
            status_column_box.removeChild( status_column_box.lastChild );
        }
    }

    // Only place this is called
    g.render_volume_copies(
        barcode_column_box,
        vol_id,
        Number(number_of_copies_textbox.value),
        ou_id,
        row
    );
}

g.render_library_label = function(row,ou_id) {

    var label = document.createElement('label');
    row.appendChild(label);
    label.setAttribute('ou_id',ou_id);
    label.setAttribute('value',g.data.hash.aou[ ou_id ].shortname());
}

g.render_volume_count_entry = function(rows,row,ou_id) {

    var hb = document.createElement('vbox');
    row.appendChild(hb);
    var tb = document.createElement('textbox');
    hb.appendChild(tb);

    tb.value = Object.size(g.org_label_existing_copy_map[ou_id]);
    tb.setAttribute('ou_id',ou_id);
    tb.setAttribute('size','3');
    tb.setAttribute('cols','3');
    tb.setAttribute('rel_vert_pos',rel_vert_pos_volume_count);

    tb.disabled = true;
    tb.style.color = "#000000";

    return tb.value;
}

g.render_callnumber_copy_count_entry = function(rows,row,ou_id,isFirst,vol_id){

    var r = row;

    if (!isFirst){

        r = document.createElement('row');
        r.setAttribute('ou_id',ou_id);
        rows.appendChild(r);

        for (var i = 0; i < 2; i++){
            var spacer = document.createElement('vbox');
            r.appendChild(spacer);
        }
    }

    /**** CALLNUMBER COLUMN ****/
    var call_number_node = document.createElement('vbox');
    r.appendChild(call_number_node);
    call_number_node.width = $('marc_cn').parentNode.boxObject.width;
    var call_number_textbox = document.createElement('textbox');
    call_number_node.appendChild(call_number_textbox);

    call_number_textbox.setAttribute('rel_vert_pos',rel_vert_pos_call_number);
    call_number_textbox.setAttribute('ou_id',ou_id);
    call_number_textbox.setAttribute('acn_id',vol_id);
    call_number_textbox.addEventListener( 'focus', function(ev) { g.last_focus = ev.target; }, false );

    // First set the label
     var copy_call_number = g.org_label_existing_copy_map[ou_id][vol_id][0].a[3].a[7];
    call_number_textbox.value = copy_call_number.trim();
    
    /**** NUMBER OF COPIES COLUMN ****/
    var number_of_copies_node = document.createElement('vbox');
    r.appendChild(number_of_copies_node);

    var number_of_copies_textbox = document.createElement('textbox');
    number_of_copies_node.appendChild(number_of_copies_textbox);
    number_of_copies_textbox.setAttribute('size','1'); number_of_copies_textbox.setAttribute('cols','1');
    number_of_copies_textbox.setAttribute('rel_vert_pos',rel_vert_pos_copy_count);
    number_of_copies_textbox.setAttribute('ou_id',ou_id);
    number_of_copies_textbox.addEventListener( 'focus', function(ev) { g.last_focus = ev.target; }, false );
    number_of_copies_textbox.disabled = true;
    number_of_copies_textbox.style.color = "#000000";

    /**** BARCODE COLUMN ****/
    var barcode_column_box = document.createElement('vbox');
    r.appendChild(barcode_column_box);

    /**** STATUS COLUMN ****/
    var status_column_box = document.createElement('vbox');
    r.appendChild(status_column_box);

    /**** NOTE COLUMN ****/

    try {

        if (g.org_label_existing_copy_map[ou_id]) {

            var num_of_copies = 0;

            if (g.org_label_existing_copy_map[ou_id][vol_id]){

                num_of_copies = g.org_label_existing_copy_map[ou_id][vol_id].length;
            }

            if (num_of_copies>0) {

                number_of_copies_textbox.value = num_of_copies;
            }
        }

        // Grab the node within the row
        var call_number_node = call_number_textbox.parentNode;

        // Shift to the node to the right to find the number of copies node
        var number_of_copies_node = call_number_node.nextSibling; /* one over to the right */
        var number_of_copies_textbox = number_of_copies_node.firstChild;

        // Grab the barcode node
        var barcode_node = number_of_copies_node.nextSibling;

        var acn_label = call_number_textbox.value;

        call_number_textbox.setAttribute('callkey',acn_label);

        // Only place this is called
        g.render_barcode(
            vol_id,
            number_of_copies_textbox,
            barcode_node,
            ou_id,
            row
        );

    } catch(E) {
        alert(E+": 762 - "+JSON.stringify(number_of_copies_textbox));
    }
}

g.render_volume_copies = function(barcode_column,acn_id,count,ou_id,row) {

    try {
        // Add the status and note boxes
        var status_column = barcode_column.nextSibling;


        // For each copy
        for (var i = 0; i < count; i++) {

            var status_string = g.org_label_existing_copy_map[ ou_id ][ acn_id ][i].status_string;
            var status_id = g.org_label_existing_copy_map[ ou_id ][ acn_id ][i].status();

            var barcode_node;
            var barcode_textbox;
            var status_node;
            var status_textbox;
            var note_node;
            var note_textbox;
            var set_handlers = false;

            if (typeof barcode_column.childNodes[i] == 'undefined') {

                barcode_node = document.createElement('hbox');
                barcode_column.appendChild(barcode_node);

                barcode_textbox = document.createElement('textbox');
                barcode_node.appendChild(barcode_textbox);
                barcode_textbox.width = barcode_width;
                set_handlers = true;

                // JBAS-1736
                // prevent barcode changes for items in non-editable statuses
                barcode_textbox.disabled = (
                    my_constants.magical_statuses[status_id] &&
                    my_constants.magical_statuses[status_id].disable_in_copy_editor
                );

                // Make status
                status_node = document.createElement('hbox');
                status_column.appendChild(status_node);

                status_textbox = document.createElement('textbox');
                status_node.appendChild(status_textbox);
                status_textbox.value = status_string;
                status_textbox.disabled = true;
                status_textbox.style.color = "#000000";
                status_textbox.width = status_width;

                // Make notes
                note_node = document.createElement('hbox');

                note_textbox = document.createElement('textbox');

                if (g.org_label_existing_copy_map[ ou_id ] &&
                    g.org_label_existing_copy_map[ ou_id ][ acn_id ] &&
                    g.org_label_existing_copy_map[ ou_id ][ acn_id ].length > n){

                    note_textbox.setAttribute('acp_id',g.org_label_existing_copy_map[ ou_id ][ acn_id ][i].id());
                }

                else{

                    note_textbox.setAttribute('acp_id',ou_id);
                }

                note_textbox.setAttribute('ou_id',ou_id);
                note_textbox.setAttribute('rel_vert_pos',rel_vert_pos_copy_note);
                note_node.appendChild(note_textbox);
            }
            g.totalRows ++;
            barcode_textbox.setAttribute('acn_id',acn_id);
            barcode_textbox.setAttribute('ou_id',ou_id);
            barcode_textbox.setAttribute('callkey',acn_id);
            barcode_textbox.setAttribute('rel_vert_pos',rel_vert_pos_barcode);
            barcode_textbox.setAttribute('id', "barcode" + g.totalRows);
            if (!barcode_textbox.value && g.org_label_existing_copy_map[ ou_id ] &&
                g.org_label_existing_copy_map[ ou_id ][ acn_id ] &&
                g.org_label_existing_copy_map[ ou_id ][ acn_id ].length > i) {

                barcode_textbox.value = g.org_label_existing_copy_map[ ou_id ][ acn_id ][i].barcode();
               barcode_textbox.setAttribute('acp_id', g.org_label_existing_copy_map[ ou_id ][ acn_id ][i].id());

                barcode_textbox.select();

                // If this is the first barcode on the page
                // Set it accordingly to direct focus after load
                if (! g.first_focus) {
                    g.first_focus = barcode_textbox;
                    var grab_barcode = barcode_textbox.value;
                }
            }

            if (g.use_defaults && ! g.first_focus) {
                g.first_focus = barcode_textbox;
                barcode_textbox.focus();
            }

            if (set_handlers) {
                util.widgets.apply_vertical_tab_on_enter_handler(
                    barcode_textbox,
                    function() { setTimeout(function(){util.widgets.vertical_tab(barcode_textbox);},0); },
                    function() { }
                );

                barcode_textbox.addEventListener('change', function(ev) {

                    var barcode = String( ev.target.value ).replace(/\s/g,'');

                    if (barcode != ev.target.value){

                        ev.target.value = barcode;
                    }

                    if ($('check_barcodes').checked && ! util.barcode.check(barcode) ) {

                        g.error.yns_alert($("catStrings").getFormattedString('staff.cat.volume_copy_creator.render_barcode_entry.alert_message', [barcode]),
                            $("catStrings").getString('staff.cat.volume_copy_creator.render_barcode_entry.alert_title'),
                            $("catStrings").getString('staff.cat.volume_copy_creator.render_barcode_entry.alert_ok_button'),null,null,
                            $("catStrings").getString('staff.cat.volume_copy_creator.render_barcode_entry.alert_confirm'));
                        setTimeout( function() { ev.target.select(); ev.target.focus(); }, 0);
                    }
                }, false);
 
                barcode_textbox.addEventListener( 'focus', function(ev) { g.last_focus = ev.target; }, false );

                barcode_textbox.addEventListener( 'keypress', function(ev) {
                    var key = ev.which || ev.keyCode;
                    if (key == 13 && this.id == "barcode" + g.totalRows){
                            document.getElementById("barcode1").focus();
                        }
                }, false );
            }
        }

        if (g.first_focus) {  
            g.first_focus.focus();
        }

    } catch(E) {
        alert('784 : ' + E);
        g.error.sdump('D_ERROR','g.render_barcode_entry: ' + E);
    }
}

g.generate_barcodes = function() {

    try {

        var nodes = document.getElementsByAttribute('rel_vert_pos',rel_vert_pos_barcode);

        if (nodes.length < 1) { return; }

        var first_barcode = nodes[0].value;

        if (! first_barcode) { return; }

        var barcodes = g.network.simple_request(
            'AUTOGENERATE_BARCODES',
            [
                ses(),
                first_barcode,
                nodes.length - 1,
                $('check_barcodes').checked ? {} : { "checkdigit" : false }
            ]
        );

        if (typeof barcodes.ilsevent != 'undefined') {

            throw(barcodes);
        }

        for (var i = 0; i < barcodes.length; i++) {

            nodes[i+1].value = barcodes[i];
            nodes[i+1].select();
            util.widgets.dispatch('change',nodes[i+1]);
        }

    } catch(E) {
        g.error.sdump('D_ERROR','g.generate_barcodes: ' + E);
    }
}

//Set acn_id of applicable barcodes in the current PO to that of the new volume
//Takes the array of barcode fields, the original acn_id, and the desired acn_id
g.set_acn_id_for_current_po = function(barcodes, acn_id, new_acn_id) {
    for(var i = 0; i < barcodes.length; i++) {
        if(barcodes[i].getAttribute('acn_id') == acn_id) barcodes[i].setAttribute('acn_id', new_acn_id);
    }
}

//Return an array with only items in a specific volume, and only ones that we're 
//specifically working with(copies in a volume within the PO)
g.match_acn = function(acn_id, barcodes) {
    currentOrderBarcodes = [];
    for(var i = 0; i < barcodes.length; i++) {
        if(barcodes[i].getAttribute('acn_id') == acn_id) currentOrderBarcodes.push(barcodes[i]);
    }
    return currentOrderBarcodes;
}

//Return an integer value equal to the number of copies in a volume
g.get_copies_in_volume = function(tcn, ou_id, callnumber) {
    var ou_list = [];
    ou_list.push(ou_id);
    var copyInVolumeCount = 0;
    var copiesInVolume = g.network.simple_request(
        'FM_ACN_TREE_LIST_RETRIEVE_VIA_RECORD_ID_AND_ORG_IDS',
        [ses(), tcn, ou_list]
    );
    if (typeof copiesInVolume.ilsevent != 'undefined') {
        alert('error with get_copies_in_volume: ' + js2JSON(r));
    }

    for(x = 0; x < copiesInVolume.length; x++) {
        if(copiesInVolume[x].label() == callnumber) {
            copyInVolumeCount = copiesInVolume[x].copies().length;
        }
    }

    return copyInVolumeCount;
}

//Find or Create Volume call helper function
//If you find you need to use this API call, it may be simpler to call this function.
//To use this, you'll need to supply a callnumber label, the TCN, an Org Unit, and acnp/s/c ids.
g.find_or_create_volume = function(callnumber, tcn, ou_id) {
    var r = g.network.simple_request(
            'FM_ACN_FIND_OR_CREATE',
            [ses(), callnumber, tcn, ou_id]
    );
    if (typeof r.ilsevent != 'undefined') {
        alert('error with volume find/create: ' + js2JSON(r));
    }

    if (typeof g.map_acn[r.acn_id] == 'undefined') {
        var temp_acn = g.network.simple_request(
            'FM_ACN_RETRIEVE.authoritative',
            [r.acn_id]
        );

        //Make sure we're only grabbing the id for acnc/p/s fields
        temp_acn.label_class(temp_acn.label_class().id());
        temp_acn.prefix(temp_acn.prefix().id());
        temp_acn.suffix(temp_acn.suffix().id());

        g.map_acn[r.acn_id] = temp_acn;
    }
    return g.map_acn[r.acn_id];
}

g.new_acp_id = -1;
g.new_acn_id = -1;

g.gather_copies = function() {

    try {
        var nl = document.getElementsByTagName('textbox');

        var copies = g.existing_copies;
        var callnumbers = [];
        var currentOrderBarcodes = [];
        var copiesInVolume = [];
        var barcodes = [];
        var notes = [];
        g.notes = [];
        var copy_map = {};

        // collect our text fields and notes
        for (var i = 0; i < nl.length; i++) {
            if (nl[i].getAttribute('rel_vert_pos') == rel_vert_pos_copy_note) notes.push( nl[i] );
            if (nl[i].getAttribute('rel_vert_pos') == rel_vert_pos_barcode) barcodes.push( nl[i] );
            if (nl[i].getAttribute('rel_vert_pos') == rel_vert_pos_call_number) callnumbers.push(nl[i]);
        }

        //gather callnumber info
        for (var i = 0; i < callnumbers.length; i++) {
            var ou_id = callnumbers[i].getAttribute('ou_id');
            var acn_id = callnumbers[i].getAttribute('acn_id');

            if (!acn_id) {
                acn_id = g.new_acn_id--;
                callnumbers[i].setAttribute('acn_id',acn_id);
            }

            var callnumber = callnumbers[i].value;

            if (!(acn_id in g.map_acn)){
                // FIXME This needs to create a valid and helpful acn
                //var new_volume = new acn();
                //new_volume.id(acn_id);
                //new_volume.id(acn_id);
                //new_volume.id(acn_id);
            } else {
                // If there's a new label, update it and mark volume as 'changed'
                if (g.map_acn[acn_id].label() != callnumber) {

                    //Do a check to make sure we're only editing these specific copies
                    currentOrderBarcodes = g.match_acn(acn_id, barcodes);
                    copiesInVolume = g.get_copies_in_volume(g.map_acn[acn_id].record(), ou_id, g.map_acn[acn_id].label());

                    //Either update the volume or find/create a new one, depending on 
                    //volumes in if we're working with every copy in a volume or just a few
                    if (currentOrderBarcodes.length < copiesInVolume) {
                        var new_volume = g.find_or_create_volume(callnumber, g.map_acn[acn_id].record(), ou_id);
                        g.set_acn_id_for_current_po(barcodes, acn_id, new_volume.id());
                        new_volume.label(callnumber);
                        new_volume.ischanged(get_db_true());
                    } else {
                        g.map_acn[acn_id].label(callnumber);                       
                        g.map_acn[acn_id].ischanged(get_db_true());
                    }
                }
            }
        }

        // gather barcode info
        for (var i = 0; i < barcodes.length; i++) {

            var acp_id = barcodes[i].getAttribute('acp_id') || g.new_acp_id--;
            var acn_id = barcodes[i].getAttribute('acn_id') || g.new_acn_id--;

            if (acp_id < 0) {

                barcodes[i].setAttribute('acp_id',acp_id);
            }

            var ou_id = barcodes[i].getAttribute('ou_id');
            var barcode = barcodes[i].value;

            //Check if acn_id is being changed to a new/different volume
            copy_map[acp_id] = {"ou_id" : ou_id, "barcode" : barcode, "acn_id" : acn_id }; 

            var note = null;

            if (note !== null && note.length > 0 && barcode !== null && barcode.length > 0){

                //{"value":noteText, "barcode":barcode, "ou_id":ou_id, "acp_id":acp_id, "pub":public}
                // Need creator
                var note_data = {};
                note_data.value = note;
                note_data.barcode = barcode;
                note_data.ou_id = ou_id;
                note_data.acn_id = acn_id;
                note_data.pub = 'f';

                g.notes.push(note_data);
            }
        }

        // Update old copies
        for (var i in copies){

            if (copies[i].id() in copy_map){

                if (copies[i].barcode() != copy_map[copies[i].id()].barcode){
                    copies[i].barcode(copy_map[copies[i].id()].barcode);
                    copies[i].ischanged(get_db_true()); // setting ischanged to true
                }

                if (copies[i].call_number() != copy_map[copies[i].id()].acn_id){
                    copies[i].call_number(copy_map[copies[i].id()].acn_id);
                    copies[i].ischanged(get_db_true()); // setting ischanged to true
                }

                delete copy_map[copies[i].id()];
            }

            else{

                copies[i].isdeleted(get_db_true());
            }
        }
        g.update_copies(copies);

        // Get the default copy status; default to "In Process" if unset, per 1.6
        var normal_ccs = g.data.hash.aous['cat.default_copy_status_normal'] || 5;

        function new_copy(acp_id,ou_id,acn_id,barcode) {

            var copy = new acp();
            copy.id( acp_id );
            copy.isnew('1');
            copy.barcode( barcode );
            copy.call_number( acn_id );
            copy.circ_lib(ou_id);
            /* FIXME -- use constants */
            copy.deposit(0);
            copy.price(0);
            copy.deposit_amount(0);
            copy.fine_level(2); // Normal
            copy.loan_duration(2); // Normal
            copy.location(1); // Stacks
            copy.status(normal_ccs);
            copy.circulate(get_db_true());
            copy.holdable(get_db_true());
            copy.opac_visible(get_db_true());
            copy.ref(get_db_false());
            copy.mint_condition(get_db_true());
            return copy;
        }

        // Add new copies
        for (var i in copy_map){

            var copy = new_copy(i,copy_map[i].ou_id,copy_map[i].acn_id,copy_map[i].barcode);
            copies.push( copy );
        }

        xulG.copies = copies;
        return copies;

    } catch(E) {
        alert('Error in update_items.js, g.gather_copies():' + E+": 1100");
    }
}

g.update_copies = function(copies) {
    // Update copies
    var r = g.network.simple_request(
        'FM_ACP_FLESHED_BATCH_UPDATE',
        [ ses(),copies, true ]
    );

    if (r.textcode === 'ITEM_BARCODE_EXISTS') {

        alert('error with item update: ' + r.desc+": 1184");
        dont_close = true;
    }

    else if (typeof r.ilsevent != 'undefined') {

        alert('error with copy update:' + js2JSON(r)+": 1188");
    }

}
g.stash_and_close = function(param, keepOpen) {

    oils_unlock_page();

    try {
		
        if (g.update_copy_editor_timeoutID) {

            clearTimeout(g.update_copy_editor_timeoutID);
        }

        var copies;

        if (xulG.unified_interface) {

            g.gather_copies();
            xulG.refresh_copy_editor();
            copies = xulG.copies;
        }

        else {

            copies = g.gather_copies();
        }

        // Collects and persists lineitem notes
        if (!keepOpen){
            g.handle_li_notes();
        }
        var volume_list = [];

        // fill volume list
        for (var i in g.map_acn){

            volume_list.push(g.map_acn[i]);
        }

        // Update volumes
        var r = g.network.simple_request(
            'FM_ACN_TREE_UPDATE',
            [ ses(),volume_list, false, { 'auto_merge_vols' : true } ]
        );

        if (typeof r.ilsevent != 'undefined') {
            alert('error with volume update: ' + js2JSON(r));
        }

		// Check for merged volumes
        var copy_ids = [];

        for(var c = 0; c < copies.length; c++) {
            copy_ids.push(copies[c].id());
        }

        var copies_to_check = g.network.simple_request(
            'FM_ACP_UNFLESHED_BATCH_RETRIEVE.authoritative',
            [ copy_ids ]
        );
        if (typeof copies_to_check.ilsevent != 'undefined') {
            alert('error with volume update: ' + js2JSON(r));
        }

        var dont_close = false;
        if (keepOpen == true){
            dont_close = true;
        }

        var label_editor_func;
        if (copies.length > 0) {

            var altered_copies = [];
            var remaining_copies = [];

            for (var c = 0; c < copies.length; c++) {
                for (var i = 0; i < copies_to_check.length; i++) {

                    //Ensure we have the right call number
                    if (copies_to_check[i].id() == copies[c].id()) {
                        copies[c].call_number(copies_to_check[i].call_number());
                        break;
                    }
                }

                if(copies[c].ischanged() == get_db_true()
                || copies[c].isdeleted() == get_db_true()){

                    altered_copies.push(copies[c]);
                }

                if(copies[c].isdeleted() != get_db_true()){

                    remaining_copies.push(copies[c]);
                }
            }

            // User clicked 'Edit then Re-barcode'
            if (param === 'edit') {

                copies = cat.util.spawn_copy_editor({
                      'edit' : true
                    , 'docid' : g.doc_id
                    , 'copies' : copies
                    , 'caller_handles_update' : false
                });
            }

            // User clicked 'Save'
            else {
                g.update_copies(altered_copies);
            }

            try {
                // If there are copy specific notes, persist them
                // but only if the user has selected the "Save and Close" options
                if (g.notes.length > 0 && !keepOpen){

                    r = g.network.simple_request(
                        'FM_ACPN_BATCH_CREATE',
                        [ ses(),g.notes ]
                    );

					if (typeof r.ilsevent != 'undefined') {

						alert('error with copy note creation: ' + js2JSON(r));
					}
                }

                //case 1706 /* ITEM_BARCODE_EXISTS */ :
                if (remaining_copies && remaining_copies.length > 0){

                    if ($('print_labels').checked) {

                        dont_close = true;
                        var tab_name = $("catStrings").getString('staff.cat.util.spine_editor.tab_name');
                        var worksheet_tab_name = $("catStrings").getString('staff.cat.util.print_worksheet.tab_name') + g.lineitem_list[g.current_lineitem_index][0];

                        label_editor_func = function() {
                            xulG.set_tab(
                                urls.XUL_SPINE_LABEL,
                                { 'tab_name' : tab_name },
                                {
                                    'barcodes' : util.functional.map_list( remaining_copies, function(o){return o.barcode();})
                                }
                            );
                        };

                        // If they're both checked, open this in a new tab
                        if ($('print_worksheet').checked){

                            label_editor_func = function() {

                                xulG.set_tab(
                                    urls.PRINT_LINEITEM_WORKSHEET
                                        + g.lineitem_list[g.current_lineitem_index][0],
                                    { 'tab_name' : worksheet_tab_name }
                                );

                                xulG.new_tab(
                                    urls.XUL_SPINE_LABEL,
                                    { 'tab_name' : tab_name },
                                    {
                                        'barcodes' : util.functional.map_list( remaining_copies, function(o){return o.barcode();})
                                    }
                                );
                            };
                        }
                    }

                    else if ($('print_worksheet').checked){

                        dont_close = true;

                        xulG.set_tab(
                            urls.PRINT_LINEITEM_WORKSHEET + g.lineitem_list[g.current_lineitem_index][0]
                        );

                    }
                }
            } catch(E) {
                alert('2: Error in update_items.js with g.stash_and_close(): ' + E+": 1210");
            }
        }

        try { if (typeof window.refresh == 'function') { window.refresh(); } } catch(E) { dump(E+'\n'); }
        try { if (typeof g.refresh == 'function') { g.refresh(); } } catch(E) { dump(E+'\n'); }

        if (typeof xulG.unlock_copy_editor == 'function') {

            xulG.unlock_copy_editor();
        }

        if (typeof xulG.reload_opac == 'function') {

            xulG.reload_opac();
        }

        if (xul_param('load_opac_when_done')) {

            var opac_url = xulG.url_prefix('opac_rdetail') + g.doc_id;
            var content_params = {
                'session' : ses(),
                'authtime' : ses('authtime'),
                'opac_url' : opac_url
            };

            xulG.set_tab(    
                xulG.url_prefix('XUL_OPAC_WRAPPER'),
                {
                    'tab_name':'Retrieving title...',
                    'on_tab_load' : function(cw) {
                        if (typeof label_editor_func == 'function') {
                            label_editor_func();
                        }
                    }
                },
                content_params
            );
        }

        else {
			
            if (typeof label_editor_func == 'function') {

                label_editor_func();
            }

            if (! dont_close) { xulG.close_tab(); }
        }

    } catch(E) {
        alert('3: Error in update_items.js with g.stash_and_close(): ' + E+": 1251");
    }
}

// This decides whether lineitem notes should be persisted
// and persists accordingly
g.handle_li_notes = function() {

    var notes_to_add = [];

    // get default note
    var df_el = document.getElementById('default_li_note');
    var df_li_note = df_el.value;

    // Only add the default note if the checkbox is checked and there's a note there...
    if ($('li_note_checkbox').checked && df_li_note && df_li_note.length > 0){

        var note = new fieldmapper.acqlin();
        note.isnew(true);

        // Assume the note is not vendor public for now
        note.vendor_public(false);
        note.value(df_li_note);

        // Set the current lineitem id
        note.lineitem(g.lineitem_list[g.current_lineitem_index][0]);

        notes_to_add.push(note);
    }

    // get custom note
    var el = document.getElementById('custom_li_note');
    var cu_li_note = el.value;

    // Only add the custom note if the checkbox is checked and there's a note there...
    if (cu_li_note && cu_li_note.length > 0){

        var note = new fieldmapper.acqlin();
        note.isnew(true);

        // Assume the note is not vendor public for now
        note.vendor_public(false);
        note.value(cu_li_note);

        // Set the current lineitem id
        note.lineitem(g.lineitem_list[g.current_lineitem_index][0]);

        notes_to_add.push(note);
    }

    // If we end up with notes to persist, persist them!
    if (notes_to_add.length > 0){

        var r = g.network.simple_request(
        'FM_CUD_LI_NOTE',
        [ ses(), notes_to_add]);

        if (typeof r.ilsevent != 'undefined') {

			alert('error with lineitem note creation: ' + js2JSON(r));
		}
    }
}

g.load_prefs = function() {
    try {

        var file = new util.file('volume_copy_creator.prefs');

        if (file._file.exists()) {

            var prefs = file.get_object();
            file.close();

            if (prefs.check_barcodes) {

                if ( prefs.check_barcodes == 'false' ) {

                    $('check_barcodes').checked = false;
                }

                else {

                    $('check_barcodes').checked = prefs.check_barcodes;
                }
            }

            else {

                $('check_barcodes').checked = false;
            }

            if (prefs.print_labels) {

                if ( prefs.print_labels == 'false' ) {

                    $('print_labels').checked = false;
                }

                else {

                    $('print_labels').checked = prefs.print_labels;
                }
            }

            else {

                $('print_labels').checked = false;
            }

        }
    } catch(E) {
        alert('Error in update_items.js with g.load_prefs(): ' + E+": 1281");
    }
}

g.save_prefs = function () {

    try {

        var file = new util.file('volume_copy_creator.prefs');

        file.set_object(
            {
                'check_barcodes' : $('check_barcodes').checked,
                'print_labels' : $('print_labels').checked,
            }
        );

        file.close();
    } catch(E) {
        alert('Error in update_items.js with g.save_prefs(): ' + E+": 1296");
    }
}

g.render_batch_button = function() {

    var hbox = $('batch_button_box');
    var btn = document.createElement('button');
    btn.setAttribute('id','batch_button');
    btn.setAttribute('label',$('catStrings').getString('staff.cat.volume_copy_creator.my_init.btn.label'));
    btn.setAttribute('accesskey',$('catStrings').getString('staff.cat.volume_copy_creator.my_init.btn.accesskey'));
    btn.setAttribute('image','/xul/server/skin/media/images/down_arrow.gif');

    hbox.appendChild(btn);
    btn.addEventListener(
        'command',
        function() {

            var nl = document.getElementsByTagName('textbox');
            var label =  $('marc_cn').firstChild.value;   
            if (label != '') {    
                for (var i = 0; i < nl.length; i++) {
                    /* label */  
                    if (nl[i].getAttribute('rel_vert_pos')==rel_vert_pos_call_number && !nl[i].disabled) { 
                        nl[i].value = label; 
                    }
                }
            }              
            if (g.last_focus){

                g.last_focus.focus();
            }
        },   
        false
    );  
}

g.setGridId = function() {

    $('rows').parentNode.setAttribute('id','mainGrid');

    //alert(new XMLSerializer().serializeToString($('mainGrid')));
    //alert($('mainGrid').getAttribute('width') + " out of " + $('cat_volume_copy_creator_win').getAttribute('width'));
}

g.render_lineitem_dropdown = function() {

    var PO_lineitem_list = [];
    var menulist = document.createElement('menulist');
    var hbox = $('lineitem_menulist');

    hbox.appendChild(menulist);
    menulist.width = barcode_width;

    for (var i in g.lineitem_list){

        var po = g.lineitem_list[i][1];
        var li = g.lineitem_list[i][0];
        var li_string = "PO: "+po+" / LI: "+li;

        var item = menulist.appendItem( li_string, i );
    }

    menulist.selectedIndex = 0;

    menulist.addEventListener(
        'command',
        function(ev) {
            g.totalRows = 0;
			g.first_focus = null;
            g.current_lineitem_index = menulist.getIndexOfItem( menulist.selectedItem );
            g.reset_lineitem();
            g.load_and_render_lineitem_notes(g.lineitem_list[g.current_lineitem_index][0]);
            g.summarize( g.existing_copies );
            g.render_edit_items_panes();
        },
        false
    );
}

g.remove_lineitem_data = function(){

    var rows = document.getElementById('rows');
    var row_list = rows.childNodes;

    while(row_list.length > 1){

        if (row_list[0].id != "batch_bar"){

            rows.removeChild(row_list[0]);
        }

        else{

            rows.removeChild(row_list[1]);
        }
    }

    for (var i = 0; i < row_list.length; i++){

        if (!(row_list[i].id && row_list[i].id == "batch_bar")){

            rows.removeChild(row_list[i]);
        }
    }
}

g.reset_lineitem = function(){

    g.remove_lineitem_data();

    g.load_lineitem_by_id();
}

g.load_lineitem_by_id = function(){

    var raw_lineitem_data = g.network.simple_request(
        'FM_OPEN_LI_RETRIEVE_BY_ID',
        [ ses(), g.lineitem_list[g.current_lineitem_index][0] ]
    );

	if (typeof raw_lineitem_data.ilsevent != 'undefined') {

		alert('error with load: ' + js2JSON(r));
	}

    var raw_data = raw_lineitem_data[0];
    raw_lineitem_data[0] = [null];
    raw_lineitem_data[0].push(raw_data);

    g.load_lineitem(raw_lineitem_data);
}

g.sort_ou_ids = function(ou_ids){

    if (typeof g.data.hash.aou == 'undefined'){

        return ou_ids;
    }

    var id = ou_ids.pop();

    var smaller = [];
    var bigger = [];

    for (var i in ou_ids){

        if (g.data.hash.aou[ ou_ids[i] ].shortname() < g.data.hash.aou[ id ].shortname()){

            smaller.push(ou_ids[i]);
        }

        else{

            bigger.push(ou_ids[i]);
        }
    }

    if (smaller.length > 1){

        smaller = g.sort_ou_ids(smaller);
    }

    smaller.push(id);

    if (bigger.length > 1){

        bigger = g.sort_ou_ids(bigger);
    }

    return smaller.concat(bigger);
}

g.makeDBFriendly = function(data, datatype){

    // booleans get a db type assignment
    if (datatype == "bool"){

        if (data){

            data = "t";
        }

        else{

            data = "f";
        }
    }

    return data;
}

g.set_attr = function(id,attr,msgcat_key) {

    var x = $(id);

    if (x) {

        x.setAttribute(
            attr,
            $('catStrings').getString(msgcat_key)
        );
    }
}

/* The following functions were ported wholesale from copy_editor.js in 
 * order to port the fields and functionality for Price, Circulate, 
 * Location/Collection, Circulation Modifier, and Templates
 */

/******************************************************************************************************/
/* This keeps track of which fields have been edited for styling purposes */

g.changed = {};

/******************************************************************************************************/
/* This keeps track of which fields are required, and which fields have been populated */

g.required = {};
g.populated = {};

// I'm assuming this will simply apply whatever change was made to any 
// given field when the 'Apply' button is clicked for that field
g.apply = function(field,value) {
    g.error.sdump('D_TRACE','applying field = <' + field + '>  value = <' + value + '>\n');
    if (value == '<HACK:KLUDGE:NULL>') {
        value = null;
    }
    if (field == 'alert_message') { value = value.replace(/^\W+$/g,''); }
    if (field == 'price' || field == 'deposit_amount') {
        if (value == '') {
            value = null;
        } else {
            value = util.money.sanitize( value );
        }
    }
    for (var i = 0; i < g.existing_copies.length; i++) {
        var copy = g.existing_copies[i];
        try {
            copy[field]( value ); copy.ischanged('1');
        } catch(E) {
            alert(E);
        }
    }

    oils_lock_page();
}

// This appears to be required by g.apply_template
g.applied_templates = [];

// This applies the template selected to all the copies on the page
g.apply_template = function() {

    try {

        var name = g.template_menu.value;

        if (g.templates[ name ] != 'undefined') {

            var template = g.templates[ name ];

            for (var i in template) {

                if (template[i].field == 'status') {

                    if (!g.safe_to_edit_copy_status()) {

                        alert($('catStrings').getFormattedString('staff.cat.copy_editor.apply_unsafe_field',[i]));
                        continue;
                    }
                }

                g.changed[ i ] = template[ i ];

                switch( template[i].type ) {

                    case 'attribute' :

                        g.apply(template[i].field,template[i].value);
                    break;
                    case 'stat_cat' :

                        if (g.stat_cat_seen[ template[i].field ]) g.apply_stat_cat(template[i].field,template[i].value);
                    break;
                    case 'owning_lib' :

                        g.apply_owning_lib(template[i].value);
                    break;
                    case 'volume_copy_creator' :

                        if (xulG.unified_interface) {
                            xulG.apply_template_to_batch(template[i].field,template[i].value);
                        }
                    break;
                }
            }

            g.summarize( g.existing_copies );
            g.render_edit_items_panes();
        }
    } 

    catch(E) {

        alert('Error in copy_editor.js, g.apply_template('+name+'): ' + E);
    }
}

// This appears to load all the templates specific to the user to the
// templates dropdown.  Includes button functionality that will probably
// need to be stripped out

/* Retrieve Templates */

g.retrieve_templates = function() {

    try {

        g.templates = {};
        var robj = g.network.simple_request('FM_AUS_RETRIEVE',[ses(),g.data.list.au[0].id()]);

        if (typeof robj['staff_client.copy_editor.templates'] != 'undefined') {

            g.templates = robj['staff_client.copy_editor.templates'];
        }

        var list = util.functional.map_object_to_list( g.templates, function(obj,i) { return [i, i]; } ).sort();

        g.template_menu = util.widgets.make_menulist( list );
        g.template_menu.setAttribute('id','template_menu');
        $('template_placeholder').appendChild(g.template_menu);
        g.template_menu.addEventListener(
            'command',
            function() { g.apply_template(); },
            false
        );
    } 

    catch(E) {

        g.error.standard_unexpected_error_alert($('catStrings').getString('staff.cat.copy_editor.retrieve_templates.error'), E);
    }
}

/******************************************************************************************************/
/* This returns true if none of the copies being edited have a magical status found in my_constants.magical_statuses */

g.safe_to_edit_copy_status = function() {
    try {
        var safe = true;
        for (var i = 0; i < g.existing_copies.length; i++) {
            var status = g.existing_copies[i].status(); if (typeof status == 'object') status = status.id();
            if (typeof my_constants.magical_statuses[ status ] != 'undefined') safe = false;
        }
        return safe;
    } catch(E) {
        g.error.standard_unexpected_error_alert('safe_to_edit_copy_status?',E);
        return false;
    }
}


/******************************************************************************************************/
/* This actually draws the change button and input widget for a given field */
g.render_input = function(node,blob) {
    try {
        // node = hbox ;    groupbox ->  hbox, hbox

        var groupbox = node.parentNode;
        var caption = groupbox.firstChild;
        var vbox = node.previousSibling;
        var hbox = node;
        var hbox2 = node.nextSibling;

        var input_cmd = blob.input;
        var render_cmd = blob.render;
        var attr = blob.attr;

        var block = false;
        var first = true;

        function on_mouseover(ev) {

            groupbox.setAttribute('style','background: white');
        }

        function on_mouseout(ev) {

            groupbox.setAttribute('style','');
        }

        groupbox.addEventListener('mouseover',on_mouseover,false);
        groupbox.addEventListener('mouseout',on_mouseout,false);

        function on_click(ev){

            try {

                if (block || g.disabled || ev.currentTarget.classList.contains('disabled')) {

                    return;
                }

                block = true;

                oils_lock_page();

                function post_c(v) {

                    try {

                        var f = input_cmd.match(/apply\("(.+?)",/)[1];

                        g.changed[ hbox.id ] = { 'type' : 'attribute', 'field' : f, 'value' : v };
                        block = false;

                        g.summarize( g.existing_copies );
                        g.render_edit_items_panes();
                        document.getElementById(caption.id).focus();                   

                    } catch(E) {

                        g.error.standard_unexpected_error_alert('post_c',E);
                    }
                }

                var x;
                var c;
                eval( input_cmd );

                if (x) {

                    util.widgets.remove_children(vbox);
                    util.widgets.remove_children(hbox);
                    util.widgets.remove_children(hbox2);
                    hbox.appendChild(x);
                    var apply = document.createElement('button');
                    apply.setAttribute('label', $('catStrings').getString('staff.cat.copy_editor.apply.label'));
                    apply.setAttribute('accesskey', $('catStrings').getString('staff.cat.copy_editor.apply.accesskey'));
                    hbox2.appendChild(apply);
                    apply.addEventListener('command',function() { c(x.value); },false);
                    var cancel = document.createElement('button');
                    cancel.setAttribute('label', $('catStrings').getString('staff.cat.copy_editor.cancel.label'));
                    cancel.addEventListener('command',function() {
                            setTimeout( function() {
                                    g.summarize( g.existing_copies );
                                    g.render_edit_items_panes();
                                    g.check_for_unmet_required_fields();
                                    document.getElementById(caption.id).focus(); 
                                }, 0
                            );
                        }, false
                    );
                    hbox2.appendChild(cancel);
                    setTimeout( function() { x.focus(); }, 0 );
                }
            } catch(E) {
                g.error.standard_unexpected_error_alert('render_input',E);
            }
        }
        groupbox.addEventListener('click',on_click, false);
        groupbox.addEventListener('keypress',function(ev) {
            if (ev.keyCode == 13 /* enter */ || ev.keyCode == 77 /* mac enter */) on_click();
        }, false);
        caption.setAttribute('style','-moz-user-focus: normal');
        caption.setAttribute('onfocus','this.setAttribute("class","outline_me")');
        caption.setAttribute('onblur','this.setAttribute("class","")');

    } catch(E) {
        g.error.sdump('D_ERROR',E + '\n');
    }
}

// This is a really ... interesting way to define the attributes for each Edit Items field
g.init_edit_item_panes = function(lib_for_location_list) {

    g.panes_and_field_names = {

        'left_pane' :
        [
            [
                $('catStrings').getString('staff.cat.copy_editor.field.circulation_modifier.label'),
                {    
                    render: 'fm.circ_modifier() == null ? $("catStrings").getString("staff.cat.copy_editor.field.unset_or_null") : $("commonStrings").getFormattedString("staff.circ_modifier.display",[fm.circ_modifier(),g.data.hash.ccm[fm.circ_modifier()].name(),g.data.hash.ccm[fm.circ_modifier()].description()])',
                    input: 'c = function(v){ g.apply("circ_modifier",v); if (typeof post_c == "function") post_c(v); }; x = util.widgets.make_menulist( [ [ $("catStrings").getString("staff.cat.copy_editor.field.unset_or_null"), "<HACK:KLUDGE:NULL>" ] ].concat( util.functional.map_list( g.data.list.ccm, function(obj) { return [ $("commonStrings").getFormattedString("staff.circ_modifier.display",[obj.code(),obj.name(),obj.description()]), obj.code() ]; } ).sort() ) ); x.addEventListener("apply",function(f){ return function(ev) { f(ev.target.value); } }(c), false);',
                }
            ],
            [
                $('catStrings').getString('staff.cat.copy_editor.field.location.label'),
                { 
                    render: 'typeof fm.location() == "object" ? fm.location().name() : g.data.lookup("acpl",fm.location()).name()', 
                    input: 'c = function(v){ g.apply("location",v); if (typeof post_c == "function") post_c(v); }; x = util.widgets.make_menulist( util.functional.map_list( g.get_acpl_list(' + lib_for_location_list + '), function(obj) { return [ ' + (g.cl_first ? 'obj.name() + " : " + g.data.hash.aou[ obj.owning_lib() ].shortname()' : 'obj.name()') + ', obj.id() ]; }).sort()); x.addEventListener("apply",function(f){ return function(ev) { f(ev.target.value); } }(c), false);',

                }
            ]
        ],

        'right_pane' :
        [

            [
                $('catStrings').getString('staff.cat.copy_editor.field.circulate.label'),
                {     
                    render: 'fm.circulate() == null ? $("catStrings").getString("staff.cat.copy_editor.field.unset_or_null") : ( get_bool( fm.circulate() ) ? $("catStrings").getString("staff.cat.copy_editor.field.circulate.yes_or_true") : $("catStrings").getString("staff.cat.copy_editor.field.circulate.no_or_false") )',
                    input: 'c = function(v){ g.apply("circulate",v); if (typeof post_c == "function") post_c(v); }; x = util.widgets.make_menulist( [ [ $("catStrings").getString("staff.cat.copy_editor.field.circulate.yes_or_true"), get_db_true() ], [ $("catStrings").getString("staff.cat.copy_editor.field.circulate.no_or_false"), get_db_false() ] ] ); x.addEventListener("apply",function(f){ return function(ev) { f(ev.target.value); } }(c), false);',
                }
            ],
            [
                $('catStrings').getString('staff.cat.copy_editor.field.price.label'),
                { 
                    render: 'if (fm.price() == null) { $("catStrings").getString("staff.cat.copy_editor.field.unset_or_null"); } else { util.money.sanitize( fm.price() ); }', 
                    input: 'c = function(v){ g.apply("price",v); if (typeof post_c == "function") post_c(v); }; x = document.createElement("textbox"); x.addEventListener("apply",function(f){ return function(ev) { f(ev.target.value); } }(c), false);',
                }
            ]
        ]
    };
}

/******************************************************************************************************/
/* This loops through all our fieldnames and all the copies, tallying up counts for the different values */

g.summarize = function( copies ) {

    /******************************************************************************************************/
    /* Setup */

    g.summary = {};
    g.field_names = [];

    for (var i in g.panes_and_field_names) {

        g.field_names = g.field_names.concat( g.panes_and_field_names[i] );
    }

    /******************************************************************************************************/
    /* Loop through the field names */

    for (var i = 0; i < g.field_names.length; i++) {

        var field_name = g.field_names[i][0];
        var render = g.field_names[i][1].render;
        var attr = g.field_names[i][1].attr;
        g.summary[ field_name ] = {};
        g.populated[ field_name ] = 1; // delete later if we encounter a copy with the field unset

        /******************************************************************************************************/
        /* Loop through the copies */

        for (var j = 0; j < copies.length; j++) {

            var fm = copies[j];
            var value = $("catStrings").getString("staff.cat.copy_editor.field.unset_or_null");

            /**********************************************************************************************/
            /* Try to retrieve the value for this field for this copy */

            try { 

                value = eval( render ); 
            } 

            catch(E) { 

                g.error.sdump('D_ERROR','Attempted ' + render + '\n' +  E + '\n'); 
            }

            if (typeof value == 'object' && value != null) {

                alert('FIXME: field_name = <' + field_name + '>  value = <' + js2JSON(value) + '>\n');
            }

            if (value == $("catStrings").getString("staff.cat.copy_editor.field.unset_or_null")) {

                delete g.populated[field_name];
            }

            /**********************************************************************************************/
            /* Tally the count */

            if (g.summary[ field_name ][ value ]) {

                g.summary[ field_name ][ value ]++;
            } 

            else {

                g.summary[ field_name ][ value ] = 1;
            }
        }
    }

    g.error.sdump('D_TRACE','summary = ' + js2JSON(g.summary) + '\n');
}

/******************************************************************************************************/
/* Display the summarized data and inputs for editing */

g.render_edit_items_panes = function() {

    /******************************************************************************************************/
    /* Library setup and clear any existing interface */

    for (var i in g.panes_and_field_names) {

        var p = document.getElementById(i);
        if (p) util.widgets.remove_children(p);
    }

    /******************************************************************************************************/
    /* Prepare the panes */

    var groupbox;
    var caption;
    var vbox;
    var grid;
    var rows;
    
    /******************************************************************************************************/
    /* Loop through the field names */

    for (h in g.panes_and_field_names) {

        if (document.getElementById(h)){

            for (var i = 0; i < g.panes_and_field_names[h].length; i++) {

                try {

                    var f = g.panes_and_field_names[h][i];
                    var fn = f[0];
                    var attr = f[1].attr;
                    groupbox = document.createElement('groupbox');
                    document.getElementById(h).appendChild(groupbox);
                    groupbox.setAttribute('hideable',fn);

                    if (attr) {

                        for (var a in attr) {

                            groupbox.setAttribute(a,attr[a]);
                        }
                    }

                    caption = document.createElement('caption');
                    groupbox.appendChild(caption);
                    caption.setAttribute('label',fn);
                    caption.setAttribute('id','caption_'+fn); // used for focus/keyboard navigation
                    caption.setAttribute('hideable',fn);
                    vbox = document.createElement('vbox');
                    groupbox.appendChild(vbox); // main display widget goes here

                    if (typeof g.changed[fn] != 'undefined') {

                        addCSSClass(vbox,'copy_editor_field_changed');
                    }

                    if (typeof g.required[fn] != 'undefined') {

                        addCSSClass(vbox,'copy_editor_field_required');
                    }

                    grid = util.widgets.make_grid( [ { 'flex' : 1 }, {}, {} ] );
                    vbox.appendChild(grid);
                    grid.setAttribute('flex','1');
                    rows = grid.lastChild;
                    var row;
                    
                    /**************************************************************************************/
                    /* Loop through each value for the field */

                    for (var j in g.summary[fn]) {

                        var value = j;
                        var count = g.summary[fn][j];
                        row = document.createElement('row');
                        rows.appendChild(row);
                        var label1 = document.createElement('description');
                        row.appendChild(label1);

                        label1.appendChild( document.createTextNode(value) );

                        var label2 = document.createElement('description');
                        row.appendChild(label2);
                        var copy_count;

                        if (count == 1) {

                            copy_count = $('catStrings').getString('staff.cat.copy_editor.copy_count');
                        }

                        else {

                            copy_count = $('catStrings').getFormattedString('staff.cat.copy_editor.copy_count.plural', [count]);
                        }

                        label2.appendChild( document.createTextNode(copy_count) );
                    }

                    groupbox.setAttribute('id','groupbox_'+fn); // this id is meant to be referenced by cat_custom.css for hiding fields
                    var hbox = document.createElement('hbox'); // main input controls go here
                    hbox.setAttribute('id',fn); // this id gets used to color areas green, etc.
                    groupbox.appendChild(hbox);
                    var hbox2 = document.createElement('hbox'); // cancel/apply buttons go here
                    groupbox.appendChild(hbox2);

                    /**************************************************************************************/
                    /* Render the input widget */

                    if (f[1].input) {

                        g.render_input(hbox,f[1]);
                    }

                } catch(E) {
                    g.error.sdump('D_ERROR','copy editor: ' + E + '\n');
                }
            }
        }
    }
    
    
    /******************************************************************************************************/
    /* Synchronize stat cat visibility with library filter menu, and default template selection */
    JSAN.use('util.file'); 
    var file = new util.file('copy_editor_prefs.'+g.data.server_unadorned);
    g.copy_editor_prefs = util.widgets.load_attributes(file);
    for (var i in g.copy_editor_prefs) {
        if (i.match(/filter_/) && g.copy_editor_prefs[i].checked == '') {
            try { 
                g.toggle_stat_cat_display( document.getElementById(i) ); 
            } catch(E) { alert(E); }
        }
    }
    if (g.template_menu) {
        g.template_menu.value = g.template_menu.getAttribute('value');
        if (xulG.unified_interface) {
            if (typeof xulG.update_unified_template_selection == 'function') {
                xulG.update_unified_template_selection(g.template_menu.value);
            }
        }
    }

    util.hide.generate_css('ui.hide_copy_editor_fields');
}

/******************************************************************************************************/
/* This returns a list of acpl's appropriate for the copies being edited */

g.get_acpl_list = function(lib_id) {

    try {

        var acpl_list = g.get_acpl_list_for_lib(lib_id);

        var returnList = acpl_list.sort(

            function(a,b) {

                var label_a = g.data.hash.aou[ a.owning_lib() ].shortname() + ' : ' + a.name();
                var label_b = g.data.hash.aou[ b.owning_lib() ].shortname() + ' : ' + b.name();

                if (label_a < label_b) return -1;
                if (label_a > label_b) return 1;

                return 0;
            }
        );

        return returnList;
    
    } catch(E) {

        g.error.standard_unexpected_error_alert('get_acpl_list',E);
        return [];
    }
}

/***************************************************************************************************************/
/* This returns a list of acpl's appropriate for the copies being edited (and caches them in the global stash) */

g.get_acpl_list_for_lib = function(lib_id) {

    var label = 'acpl_list_for_lib_'+lib_id;

    if (typeof g.data[label] == 'undefined') {

        var robj = g.network.simple_request('FM_ACPL_RETRIEVE', [ lib_id ]); // This returns acpl's for all ancestors and descendants as well as the lib

        if (typeof robj.ilsevent != 'undefined') throw(robj);

        var temp_list = [];

        for (var j = 0; j < robj.length; j++) {

            var my_acpl = robj[j];

            if (typeof g.data.hash.acpl[ my_acpl.id() ] == 'undefined') {

                g.data.hash.acpl[ my_acpl.id() ] = my_acpl;
                g.data.list.acpl.push( my_acpl );
            }

            temp_list.push( my_acpl );
        }

        g.data[label] = temp_list;
        g.data.stash(label,'hash','list');
    }

    return g.data[label];
}

Object.size = function(obj) {
    var size = 0, key;
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};
