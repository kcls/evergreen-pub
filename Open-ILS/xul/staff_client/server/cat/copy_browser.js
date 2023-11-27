dump('entering cat.copy_browser.js\n');

JSAN.use('cat.util');
JSAN.use('util.network');
JSAN.use('OpenILS.data');
JSAN.use('util.file');
JSAN.use('util.error');
JSAN.use('util.controller');
JSAN.use('util.functional');
JSAN.use('circ.util');
JSAN.use('util.window');
JSAN.use('util.widgets');
JSAN.use('util.list');

if (typeof cat == 'undefined') cat = {};

cat.copy_browser = function (params) {
    try {
       this.error = new util.error();
    } catch(E) {
       dump('cat.copy_browser: ' + E + '\n');
    }
}

const AVAILABLE = 0;
const MISSING = 4;
const DAMAGED = 14;

cat.copy_browser.prototype = {

   'map_tree' : {},
   'map_acn' : {},
   'map_acp' : {},
   'sel_list' : [],
   'org_ids' : [],
   'hashOfVolumes' : {}, // lib : [volume ids]
   'copy_count' : {},
   'open_objs' : {},
   'transferring' : false,

   'init' : function( params ) {

      try {

         var obj = this;

         obj.docid = params.docid;

         
         obj.network = new util.network();
         obj.data = new OpenILS.data();
         obj.data.init({'via':'stash'});

         obj.full_data_reload();

         obj.controller_init(params);

         obj.list_init(params);

         obj.source_init();

         obj.controller.render();

         obj.default_depth = obj.depth_menu_init();
         obj.default_lib = obj.data.hash.aou[ obj.library_menu_init() ];

         document.getElementById('show_acns').addEventListener(
            'command',
            function(ev) {

             var file = new util.file(
                 'copy_browser_prefs.'+obj.data.server_unadorned);
             util.widgets.save_attributes(file, {
                 'lib_menu' : [ 'value' ],
                 'depth_menu' : [ 'value' ],
                 'show_acns' : [ 'checked' ],
                 'show_acps' : [ 'checked' ],
                 'hide_aous' : [ 'checked' ] });
            },
            false
         );

         document.getElementById('show_acps').addEventListener(
            'command',
            function(ev) {

             var file = new util.file(
                 'copy_browser_prefs.'+obj.data.server_unadorned);
             util.widgets.save_attributes(file, {
                 'lib_menu' : [ 'value' ],
                 'depth_menu' : [ 'value' ],
                 'show_acns' : [ 'checked' ],
                 'show_acps' : [ 'checked' ],
                 'hide_aous' : [ 'checked' ] });
            },
            false
         );

         document.getElementById('hide_aous').addEventListener(
            'command',
            function(ev) {

             var file = new util.file(
                 'copy_browser_prefs.'+obj.data.server_unadorned);
             util.widgets.save_attributes(file, {
                 'lib_menu' : [ 'value' ],
                 'depth_menu' : [ 'value' ],
                 'show_acns' : [ 'checked' ],
                 'show_acps' : [ 'checked' ],
                 'hide_aous' : [ 'checked' ] });
            },
            false
         );

         obj.show_my_libs( obj.default_lib.id() );
         obj.show_consortial_count();

         document.getElementById('cat_copy_browser').removeChild(document.getElementById('loading_bar_box'));
       } catch(E) {
          this.error.standard_unexpected_error_alert('cat.copy_browser.init: ',E);
       }
    },

   // This clobbers all local data and reloads it all from the DB
   'full_data_reload' : function(){

      var obj = this;

      try{

         obj.map_tree = {};
         obj.map_acn = {};
         obj.map_acp = {};
         obj.sel_list = [];
         obj.org_ids = [];
         obj.hashOfVolumes = {};
         obj.copy_count = {};
         obj.open_objs = {};

         // This grabs all the relevant data in one go so we don't have
         // frequent calls to the DB
         var returnedArray = obj.network.simple_request('MAP_ASSET',[ ses(), obj.docid ]);

         if (returnedArray === null){

             throw("Database error: MAP_ASSET did not return expected results.  copy_browser.js:39");
         }

         var total_batches = returnedArray.pop();
         var listOfCopies = returnedArray;


         var current_batch = total_batches;
         var loading_bar_box = document.createElement('div');
         loading_bar_box.id = "loading_bar_box";
         var loading_bar = document.createElement('div');
         loading_bar.id = "loading_bar";
         loading_bar_box.appendChild(loading_bar);
         document.getElementById('cat_copy_browser').appendChild(loading_bar_box);

         var percentDone = (total_batches - current_batch) / (parseFloat(total_batches)) * 100;

         while(current_batch > 1){

            returnedArray = obj.network.simple_request('MAP_ASSET',[ ses(), obj.docid, current_batch, total_batches]);
            current_batch = returnedArray.pop();
            percentDone = (total_batches - current_batch) / (total_batches * 1.0) * 100;
            loading_bar.style.width = percentDone + "%";

            listOfCopies = listOfCopies.concat(returnedArray);
         }

         var orgSet = {};

         obj.copy_count.count = 0;
         obj.copy_count.available = 0;

         // For list of copy info in the list of copies
         // Make a new object from the template and insert copy data
         for (var i in listOfCopies){

            // count copies
            obj.copy_count.count ++;

            var volumeVars = listOfCopies[i].slice(0,13);
            var copyVars = listOfCopies[i].slice(13,46);
            var circVars = listOfCopies[i].slice(46,79);

            // This checks if the id is null
            // If it is, then this is an empty volume
            if (copyVars[22] != null){

               var copy = makeCopy(copyVars);

               // Slap 6 nulls after element 20
               circVars = circVars.slice(0,20).concat(
                  [null,null,null,null,null],
                  circVars.slice(20));

               var circ = makeCirc(circVars);

               // Count available copies
               if (copy.status() == AVAILABLE){

                  obj.copy_count.available ++;
               }

               // If no circ info, set circ to null
               if (circ.var_id){

                  copy.var_circulations = [circ];
               }

               else{

                  copy.var_circulations = null;
               }

               copy.circulations = function(){

                  return copy.var_circulations;
               }

               // If the volume isn't there yet, make it
               if (!obj.map_acn[ copy.call_number() ]){

                  volumeVars = [[]].concat(volumeVars.slice(0,9),
                     [null,null,null],
                     volumeVars.slice(9,13));

                  var newVolume = makeVolume(volumeVars);
                  obj.map_acn[ copy.call_number()] = newVolume;
               }

               obj.map_acn[ copy.call_number()].copies().push(copy);
            }

            // If we have an empty volume
            else{

               // This should always return true...
               // Checks if the volume isn't there yet
               if (!obj.map_acn[ volumeVars[5]]){

                  volumeVars = [[]].concat(volumeVars.slice(0,9),
                     [null,null,null],
                     volumeVars.slice(9,13));

                  var newVolume = makeVolume(volumeVars);
                  obj.map_acn[ newVolume.id()] = newVolume;
               }
            }
         }

         // populate obj.hashOfVolumes
         for (var v in obj.map_acn){

            if (!obj.hashOfVolumes[ obj.map_acn[v].owning_lib() ]){

               obj.hashOfVolumes[ obj.map_acn[v].owning_lib() ] = [];

               // And populate obj.org_ids while we're at it
               obj.org_ids.push( obj.map_acn[v].owning_lib() );
            }

            // add the volume to the end of the list
            obj.hashOfVolumes[ obj.map_acn[v].owning_lib() ].push(obj.map_acn[v].id());
         }
      }

      catch(E) {

         this.error.standard_unexpected_error_alert('cat.copy_browser.init: ',E);
      }
   },

   'controller_init' : function(params) {
      var obj = this;
      try {
         obj.controller = new util.controller();
         obj.controller.init(
            {
               control_map : {
                  'save_columns' : [ [ 'command' ], function() { obj.list.save_columns(); } ],
                  'sel_clip' : [
                     ['command'],
                     function() { obj.list.clipboard(); }
                  ],
                  'cmd_broken' : [
                     ['command'],
                     function() {
                        alert(document.getElementById('commonStrings').getString('common.unimplemented'));
                     }
                  ],
                  'cmd_show_my_libs' : [
                     ['command'],
                     function() {
                        obj.show_my_libs();
                     }
                  ],
                  'cmd_show_all_libs' : [
                     ['command'],
                     function() {
                        obj.show_all_libs();
                     }
                  ],
                  'cmd_show_libs_with_copies' : [
                     ['command'],
                     function() {
                        obj.show_libs_with_copies();
                     }
                  ],
                  'cmd_clear' : [
                     ['command'],
                     function() {
                        obj.map_tree = {};
                        obj.list.clear();
                     }
                  ],
                  'cmd_request_items' : [
                     ['command'],
                     function() {

                        var list = util.functional.filter_list( obj.sel_list, function (o) { return o.split(/_/)[0] == 'acp'; });

                        list = util.functional.map_list( list, function (o) { return o.split(/_/)[1]; });

                        cat.util.request_items( list );
                     }
                  ],
                  'sel_mark_items_damaged' : [
                     ['command'],
                     function() {

                        var list = util.functional.filter_list( obj.sel_list, function (o) { return o.split(/_/)[0] == 'acp'; });

                        list = util.functional.map_list( list, function (o) { return o.split(/_/)[1]; });

                        var copies = cat.util.mark_item_damaged( list );
                        var changed_copies = [];
                        var lib_to_update = {};

                        for (var c in copies){

                           if (copies[c].status() == DAMAGED){

                              changed_copies.push(copies[c]);
                              lib_to_update[ obj.map_acn[ copies[c].call_number() ].owning_lib() ] = true;
                           }
                        }

                        obj.refresh_list(changed_copies, undefined, lib_to_update);
                        obj.redraw_orgs(lib_to_update);
                     }
                  ],
                  'sel_mark_items_missing' : [
                     ['command'],
                     function() {

                        var list = util.functional.filter_list( obj.sel_list, function (o) { return o.split(/_/)[0] == 'acp'; });

                        list = util.functional.map_list( list, function (o) { return o.split(/_/)[1]; });

                        var copies = cat.util.mark_item_missing( list );
                        var changed_copies = [];
                        var lib_to_update = {};

                        for (var c in copies){

                           if (copies[c].status() == MISSING){

                              changed_copies.push(copies[c]);
                              lib_to_update[ obj.map_acn[ copies[c].call_number() ].owning_lib() ] = true;
                           }
                        }

                        obj.refresh_list(changed_copies);
                        obj.redraw_orgs(lib_to_update);
                     }
                  ],
                  'sel_patron' : [
                     ['command'],
                     function() {

                        var list = util.functional.filter_list(
                           obj.sel_list,
                           function (o) {
                              return o.split(/_/)[0] == 'acp';
                           }
                        );

                        list = util.functional.map_list(
                           list,
                           function (o) {
                              return { 'copy_id' : o.split(/_/)[1] };
                           }
                        );

                        circ.util.show_last_few_circs(list);
                     }
                  ],
                  'sel_copy_details' : [
                     ['command'],
                     function() {

                        var list = util.functional.filter_list(
                           obj.sel_list,
                           function (o) {
                              return o.split(/_/)[0] == 'acp';
                           }
                        );

                        circ.util.item_details_new(
                           util.functional.map_list(
                              list, function (o) {
                                 return obj.map_acp[o.split(/_/)[1]].barcode();
                              }
                           )
                        );
                     }
                  ],
                  'cmd_create_brt' : [
                     ['command'],
                     function() {

                        /* Filter selected rows that aren"t copies. */
                        var list = util.functional.filter_list(
                           obj.sel_list,
                           function (o) {
                              return o.split(/_/)[0] == "acp";
                           }
                        );
                        var results = cat.util.make_bookable(
                           util.functional.map_list(
                              list, function (o) {
                                 return obj.map_acp[o.split(/_/)[1]].id();
                              }
                           )
                        );
                        if (results && results["brsrc"]) {
                           cat.util.edit_new_brsrc(results["brsrc"]);
                        }
                     }
                  ],
                  'cmd_book_item_now' : [
                     ['command'],
                     function() {

                        /* Filter selected rows that aren"t copies. */
                        var list = util.functional.filter_list(
                           obj.sel_list,
                           function (o) {
                              return o.split(/_/)[0] == "acp";
                           }
                        );
                        var results = cat.util.make_bookable(
                           util.functional.map_list(
                              list, function (o) {
                                 return obj.map_acp[o.split(/_/)[1]].id();
                              }
                           )
                        );
                        if (results) {
                           cat.util.edit_new_bresv(results);
                        }
                     }
                  ],
                  'cmd_add_items' : [
                     ['command'],
                     function() {
                        try {

                           var list = util.functional.map_list(
                              util.functional.filter_list(
                                 obj.sel_list,
                                 function (o) {
                                    return o.split(/_/)[0] == 'acn';
                                 }
                              ),
                              function (o) {
                                 return o.split(/_/)[1];
                              }
                           );
                           if (list.length == 0) return;

                           var copy_shortcut = {};

                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 var call_number = obj.map_acn[ o ];
                                 var ou_id = call_number.owning_lib();
                                 var volume_id = o;
                                 var label = call_number.label();
                                 var acnc_id = typeof call_number.label_class() == 'object'
                                    ? call_number.label_class().id()
                                    : call_number.label_class();
                                 var acnp_id = typeof call_number.prefix() == 'object'
                                    ? call_number.prefix().id()
                                    : call_number.prefix();
                                 var acns_id = typeof call_number.suffix() == 'object'
                                    ? call_number.suffix().id()
                                    : call_number.suffix();
                                 if (!copy_shortcut[ou_id]) copy_shortcut[ou_id] = {};
                                 var callnumber_composite_key = acnc_id + ':' + acnp_id + ':' + label + ':' + acns_id;
                                 copy_shortcut[ou_id][ callnumber_composite_key ] = volume_id;
                                 vol_id = volume_id;

                                 return ou_id;
                              }
                           );
                           /* quick fix */  /* what was this fixing? */
                           list = []; for (var i in copy_shortcut) { list.push( i ); }

                           var edit = 0;
                           try {
                              edit = obj.network.request(
                                 api.PERM_MULTI_ORG_CHECK.app,
                                 api.PERM_MULTI_ORG_CHECK.method,
                                 [
                                    ses(),
                                    obj.data.list.au[0].id(),
                                    list,
                                    [ 'CREATE_COPY' ]
                                 ]
                              ).length == 0 ? 1 : 0;
                           } catch(E) {
                              obj.error.sdump('D_ERROR','batch permission check: ' + E);
                           }

                           if (edit==0) return; // no read-only view for this interface

                           if (!obj.can_have_copies) {
                              alert(document.getElementById('catStrings').getFormattedString('staff.cat.copy_browser.can_have_copies.false', obj.source));
                              return;
                           }

                           var title = document.getElementById('catStrings').getString('staff.cat.copy_browser.add_item.title');

                           var url;
                           var unified_interface = String( obj.data.hash.aous['ui.unified_volume_copy_editor'] ) == 'true';
                           if (unified_interface) {
                              var horizontal_interface = String( obj.data.hash.aous['ui.cat.volume_copy_editor.horizontal'] ) == 'true';
                              url = xulG.url_prefix( horizontal_interface ? 'XUL_VOLUME_COPY_CREATOR_HORIZONTAL' : 'XUL_VOLUME_COPY_CREATOR' );
                           } else {
                              url = xulG.url_prefix('XUL_VOLUME_COPY_CREATOR_ORIGINAL');
                           }

                           var w = xulG.new_tab(
                              url,
                              { 'tab_name' : title },
                              {
                                 'doc_id' : obj.docid,
                                 'ou_ids' : list,
                                 'copy_shortcut' : copy_shortcut,
                                 'onrefresh' : function() {
                                    obj.refresh_list(obj.get_new_copies(copy_shortcut)); 
                                 }
                              }
                           );
                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.add_item.error'),E);
                        }
                     }
                  ],
                  'cmd_add_items_to_buckets' : [
                     ['command'],
                     function() {
                        try {

                           var list = util.functional.filter_list(
                              obj.sel_list,
                              function (o) {
                                 return o.split(/_/)[0] == 'acp';
                              }
                           );

                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 return o.split(/_/)[1];
                              }
                           );

                           
                           cat.util.add_copies_to_bucket( list );

                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.add_items_bucket.error'),E);
                        }
                     }
                  ],
                  'cmd_replace_barcode' : [
                     ['command'],
                     function() {
                        try {

                           var list = util.functional.filter_list(
                              obj.sel_list,
                              function (o) {
                                 return o.split(/_/)[0] == 'acp';
                              }
                           );

                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 var cloned_copy_obj = JSON2js( js2JSON( obj.map_acp[ o.split(/_/)[1] ] ) );
                                 cloned_copy_obj.call_number( obj.map_acn[ cloned_copy_obj.call_number() ] );
                                 return cloned_copy_obj;
                              }
                           );

                           xulG.volume_item_creator( {'existing_copies':list, 'onrefresh' : function() {
                              
                              var copies = cat.util.update_copies_by_id( list );

                              var volume_id_set = {};
                              var volumes = [];
                              var libs_to_update = {};

                              for (var c in copies){

                                 // If we haven't yet handled this copy's volume
                                 if (!(copies[c].call_number() in volume_id_set)){

                                    var copy = obj.map_acp[copies[c].id()];
                                    copy.barcode( copies[c].barcode() );
                                    copy.call_number( copies[c].call_number() );

                                    volume_id_set[copy.call_number()] = true;
                                    var volume = obj.network.simple_request('FM_ACN_RETRIEVE.authoritative',[ copy.call_number() ]);
                                    libs_to_update[volume.owning_lib()] = true;

                                    // first, remove the copy from it's old location
                                    var done = false;

                                    // And then remove the old copy from it's old location
                                    var volume_ids = obj.hashOfVolumes[ volume.owning_lib() ];

                                    for (var v in volume_ids){

                                       var old_volume = obj.map_acn[ volume_ids[v] ];

                                       for (var o in old_volume.copies()){

                                          if (old_volume.copies()[o].id() == copy.id()){

                                             libs_to_update[old_volume.owning_lib()] = true;
                                             old_volume.copies().splice(o,1);
                                             delete obj.map_tree[ 'acp_' + copy.id() ];
                                             obj.map_acn[old_volume.id()] = old_volume;
                                             obj.map_acp[copy.id()] = copy;
                                             done = true;
                                             break;
                                          }
                                       }

                                       if (done){

                                          break;
                                       }
                                    }

                                    // If we don't have this volume, add it
                                    if (!(volume.id() in obj.map_acn)){

                                       volume = obj.add_copy_to_volume_in_js(volume, copy);
                                       volumes.push(volume);
                                    }

                                    // Otherwise, transfer the copies
                                    else{

                                       volume = obj.map_acn[volume.id()];
                                       volume = obj.add_copy_to_volume_in_js(volume, copy);
                                       obj.map_acn[volume.id()] = volume;
                                    }
                                 }
                              }

                              // If volumes need to be added, add them
                              if (volumes.length > 0){

                                 obj.add_new_volumes_to_js(volumes);
                              }

                              // Don't try and mess with volumes, just 
                              // update all copies and refresh the libs
                              obj.refresh_list(copies, undefined, libs_to_update);
                           }, 'doc_id' : obj.docid } );

                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.edit_items.error'),E);
                           obj.refresh_list();
                        }
                     }
                  ],
                  'cmd_edit_items' : [
                     ['command'],
                     function() {
                        try {
                           var unified_interface = String( obj.data.hash.aous['ui.unified_volume_copy_editor'] ) == 'true';
                           if (!unified_interface) {
                              obj.controller.control_map['old_cmd_edit_items'][1]();
                              return;
                           }

                           var list = util.functional.filter_list(
                              obj.sel_list,
                              function (o) {
                                 return o.split(/_/)[0] == 'acp';
                              }
                           );

                           var orgs = obj.update_orgs_from_copy_code_list(list);

                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 var cloned_copy_obj = JSON2js( js2JSON( obj.map_acp[ o.split(/_/)[1] ] ) );
                                 cloned_copy_obj.call_number( obj.map_acn[ cloned_copy_obj.call_number() ] );
                                 return cloned_copy_obj;
                              }
                           );

                           if (list.length > 0) {

                              xulG.volume_item_creator( {'existing_copies':list, 'onrefresh' : function() {
                                 
                                 var copies = cat.util.update_copies_by_id( list );

                                 // returns the leftover copies, list, and libs_to_update
                                 var returned = obj.weed_and_transfer_copies_in_js(copies);
                                 obj.refresh_list(returned[0], undefined, returned[1]);

                                 for (var c in copies){

                                    orgs[obj.map_acn[ copies[c].call_number()].owning_lib()] = true;
                                 }

                                    obj.redraw_orgs(orgs);
                                 }
                              } );
                           }
                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.edit_items.error'),E);
                           obj.refresh_list();
                        }
                     }
                  ],
                  // Called from cmd_edit_items as a backup
                  'old_cmd_edit_items' : [
                     ['command'],
                     function() {
                        try {

                           var list = util.functional.filter_list(
                              obj.sel_list,
                              function (o) {
                                 return o.split(/_/)[0] == 'acp';
                              }
                           );

                           var orgs = obj.update_orgs_from_copy_code_list(list);

                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 return o.split(/_/)[1];
                              }
                           );

                           
                           var editor_return = cat.util.spawn_copy_editor( { 'copy_ids' : list, 'edit' : 1 } );

                           if (editor_return && editor_return.length > 0){

                              var copies = cat.util.update_copies_by_id( list );

                              // returns the leftover copies, list, and libs_to_update
                              var returned = obj.weed_and_transfer_copies_in_js(copies);
                              obj.refresh_list(returned[0], undefined, returned[1]);


                              for (var c in copies){

                                 if (typeof obj.map_acn[ copies[c].call_number()] == 'object'
                                 && obj.map_acn[ copies[c].call_number()].owning_lib() != 'object'){

                                    orgs[obj.map_acn[ copies[c].call_number()].owning_lib()] = true;
                                 }
                              }

                              obj.redraw_orgs(orgs);
                           }
                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.edit_items.error'),E);
                        }
                     }
                  ],
                  'cmd_delete_items' : [
                     ['command'],
                     function() {
                        try {

                           var list = util.functional.filter_list(
                              obj.sel_list,
                              function (o) {
                                 return o.split(/_/)[0] == 'acp';
                              }
                           );

                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 return JSON2js( js2JSON( obj.map_acp[ o.split(/_/)[1] ] ) );
                              }
                           );

                           var delete_msg;
                           if (list.length != 1) {
                              delete_msg = document.getElementById('catStrings').getFormattedString('staff.cat.copy_browser.delete_items.confirm.plural', [list.length]);
                           } else {
                              delete_msg = document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_items.confirm');
                           }

                           var r = obj.error.yns_alert(
                              delete_msg,
                              document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_items.title'),
                              document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_items.delete'),
                              document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_items.cancel'),
                              null,
                              document.getElementById('commonStrings').getString('common.confirm')
                           );

                           if (r == 0) {

                              var acn_hash = {}; var acn_list = [];

                              for (var i = 0; i < list.length; i++) {

                                 list[i].isdeleted('1');
                                 var acn_id = list[i].call_number();

                                 if ( ! acn_hash[ acn_id ] ) {

                                    // Have to clone this or it will bork the data
                                    // and the page refresh will show an empty volume
                                    acn_hash[ acn_id ] = cloneVolume(obj.map_acn[ acn_id ]);
                                    acn_hash[ acn_id ].copies( [] );
                                 }

                                 var temp = acn_hash[ acn_id ].copies();
                                 temp.push( list[i] );
                                 acn_hash[ acn_id ].copies( temp );
                              }

                              for (var i in acn_hash) acn_list.push( acn_hash[i] );

                              var robj = obj.network.simple_request(
                                 'FM_ACN_TREE_UPDATE',
                                 [ ses(), acn_list, true ],
                                 null,
                                 {
                                    'title' : document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_items.override'),
                                    'overridable_events' : [
                                       1208 /* TITLE_LAST_COPY */,
                                       1227 /* COPY_DELETE_WARNING */,
                                    ]
                                 }
                              );

                              if (robj == null) throw(robj);
                              if (typeof robj.ilsevent != 'undefined') {
                                 if (
                                    (robj.ilsevent != 0)
                                    && (robj.ilsevent != 1227 /* COPY_DELETE_WARNING */)
                                    && (robj.ilsevent != 1208 /* TITLE_LAST_COPY */)
                                    && (robj.ilsevent != 5000 /* PERM_DENIED */)
                                 ) {
                                    throw(robj);
                                 }
                              }

                              if (typeof robj.ilsevent == 'undefined' || robj.ilsevent == 0){

                                 var copies = cat.util.update_copies_by_id( list );

                                 for (var c in copies){

                                    copies[c].isdeleted(1);
                                 }

                                 obj.refresh_list(copies);
                              }

                              else{

                                 obj.list.node.view.selection.clearSelection();
                              }
                           }

                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_items.error'),E);
                           obj.refresh_list(list);
                        }
                     }
                  ],
                  'cmd_print_spine_labels' : [
                     ['command'],
                     function() {
                        try {

                           var list = util.functional.filter_list(
                              obj.sel_list,
                              function (o) {
                                 return o.split(/_/)[0] == 'acp';
                              }
                           );

                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 return obj.map_acp[ o.split(/_/)[1] ];
                              }
                           );

                           xulG.new_tab(
                              xulG.url_prefix('XUL_SPINE_LABEL'),
                              { 'tab_name' : document.getElementById('catStrings').getString('staff.cat.copy_browser.print_spine.tab') },
                              {
                                 'barcodes' : util.functional.map_list( list, function(o){return o.barcode();})
                              }
                           );
                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.print_spine.error'),E);
                        }
                     }
                  ],
                  'cmd_add_volumes' : [
                     ['command'],
                     function() {
                        try {

                           var list = util.functional.filter_list(
                              obj.sel_list,
                              function (o) {
                                 return o.split(/_/)[0] == 'aou';
                              }
                           );
                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 return o.split(/_/)[1];
                              }
                           );

                           var edit = 0;
                           try {
                              edit = obj.network.request(
                                 api.PERM_MULTI_ORG_CHECK.app,
                                 api.PERM_MULTI_ORG_CHECK.method,
                                 [
                                    ses(),
                                    obj.data.list.au[0].id(),
                                    list,
                                    [ 'CREATE_VOLUME', 'CREATE_COPY' ]
                                 ]
                              ).length == 0 ? 1 : 0;
                           } catch(E) {
                              obj.error.sdump('D_ERROR','batch permission check: ' + E);
                           }

                           if (edit==0) {
                              alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.add_volume.permission_error'));
                              return; // no read-only view for this interface
                           }

                           if (!obj.can_have_copies) {
                              alert(document.getElementById('catStrings').getFormattedString('staff.cat.copy_browser.can_have_copies.false', obj.source));
                              return;
                           }

                           var title = document.getElementById('catStrings').getString('staff.cat.copy_browser.add_volume.title');

                           var url;
                           var unified_interface = String( obj.data.hash.aous['ui.unified_volume_copy_editor'] ) == 'true';
                           if (unified_interface) {
                              var horizontal_interface = String( obj.data.hash.aous['ui.cat.volume_copy_editor.horizontal'] ) == 'true';
                              url = xulG.url_prefix( horizontal_interface ? 'XUL_VOLUME_COPY_CREATOR_HORIZONTAL' : 'XUL_VOLUME_COPY_CREATOR' );
                           } else {
                              url = xulG.url_prefix('XUL_VOLUME_COPY_CREATOR_ORIGINAL');
                           }

                           // This creates a new tab in which new volumes can be created
                           // After created, the tab will close and the holdings maintenance
                           // page will refresh with the new volumes in place
                           // obj.get_new_volumes(list) is grabbing all volumes for docid in the list of libraries provided
                           var w = xulG.new_tab(
                              url,
                              { 'tab_name' : title },
                              {
                                 'doc_id' : obj.docid,
                                 'ou_ids' : list,
                                 'onrefresh' : function() {

                                    obj.refresh_list(undefined, obj.get_new_volumes(list));
                                 }
                              }
                           );

                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.add_volume.error'),E);
                        }
                     }
                  ],
                  'cmd_edit_volumes' : [
                     ['command'],
                     function() {
                        try {

                           var volumes = util.functional.map_list(
                              util.functional.filter_list(
                                 obj.sel_list,
                                 function (o) {
                                    return o.split(/_/)[0] == 'acn';
                                 }
                              ),
                              function (o) {
                                 return o.split(/_/)[1];
                              }
                           );
                           volumes = util.functional.map_list(
                              volumes,
                              function (o) {
                                 var my_acn = obj.map_acn[ o ];
                                 return function(r){return r;}(my_acn);
                              }
                           );

                           

                           var copy_lists = {};

                           for (var v in volumes){

                              copy_lists[volumes[v].id()] = volumes[v].copies();
                           }

                           volumes = cat.util.batch_edit_volumes( volumes );
                           var libs_to_update = {};

                           for (var v in volumes){

                              if (volumes[v].id() in copy_lists){

                                 // Add all the old copies to the newly edited volume
                                 volumes[v].a[0] = copy_lists[volumes[v].id()];
                              }

                              libs_to_update[volumes[v].owning_lib()] = true;
                           }

                           if ( volumes ) {

                              obj.refresh_list(undefined, volumes);
                              obj.redraw_orgs(libs_to_update);
                           }

                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.edit_volume.exception'),E);
                        }
                     }
                  ],
                  'cmd_delete_volumes' : [
                     ['command'],
                     function() {
                        try {

                           var list = util.functional.filter_list(
                              obj.sel_list,
                              function (o) {
                                 return o.split(/_/)[0] == 'acn';
                              }
                           );

                           list = util.functional.map_list(
                              list,
                              function (o) {
                                 return JSON2js( js2JSON( obj.map_acn[ o.split(/_/)[1] ] ) );
                              }
                           );

                           var del_prompt;
                           if (list.length == 1) {
                              del_prompt = document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.prompt');
                           } else {
                              del_prompt = document.getElementById('catStrings').getFormattedString('staff.cat.copy_browser.delete_volume.prompt.plural', [list.length]);
                           }

                           var r = obj.error.yns_alert(
                              del_prompt,
                              document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.title'),
                              document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.delete'),
                              document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.cancel'),
                              null,
                              document.getElementById('commonStrings').getString('common.confirm')
                           );

                           if (r == 0) { // delete vols
                              for (var i = 0; i < list.length; i++) {
                                 list[i].isdeleted('1');
                              }
                              var params = {};
                              loop: while(true) {
                                 var robj = obj.network.simple_request(
                                    'FM_ACN_TREE_UPDATE',
                                    [ ses(), list, true, params ],
                                    null,
                                    {
                                       'title' : document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.override'),
                                       'overridable_events' : [
                                          1208 /* TITLE_LAST_COPY */,
                                          1227 /* COPY_DELETE_WARNING */
                                       ]
                                    }
                                 );
                                 if (robj == null) throw(robj);
                                 if (typeof robj.ilsevent != 'undefined') {
                                    if (robj.ilsevent == 1206 /* VOLUME_NOT_EMPTY */) {
                                       var r2 = obj.error.yns_alert(
                                          document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.copies_remain'),
                                          document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.title'),
                                          document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.copies_remain.confirm'),
                                          document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.copies_remain.cancel'),
                                          null,
                                          document.getElementById('commonStrings').getString('common.confirm')
                                       );
                                       if (r2 == 0) { // delete vols and copies
                                          params.force_delete_copies = true;
                                          continue loop;
                                       }
                                       else {

                                          list = [];
                                          break;
                                       }
                                    } else {
                                       if (typeof robj.ilsevent != 'undefined') {
                                          if (
                                             (robj.ilsevent != 0)
                                             && (robj.ilsevent != 1227 /* COPY_DELETE_WARNING */)
                                             && (robj.ilsevent != 1208 /* TITLE_LAST_COPY */)
                                             && (robj.ilsevent != 5000 /* PERM_DENIED */)
                                          ) {
                                             throw(robj);
                                          }

                                          // This means nothing was deleted
                                          // So don't remove anything from the page
                                          if (robj.ilsevent == 1227
                                          || robj.ilsevent == 1208
                                          || robj.ilsevent == 5000){

                                             list = [];
                                             break loop;
                                          }
                                       }
                                    }
                                 }
                                 break loop;
                              }

                              // This removes all copies and volumes
                              for (var l in list){

                                 var copies = list[l].copies();

                                 // mark copies as deleted
                                 for (var c in copies){

                                    copies[c].isdeleted(true);
                                 }

                                 // This updates copies javascript memory
                                 obj.refresh_copies( copies );
                              }

                              if (list.length > 0){

                                 // removes volumes from javascript in memory
                                 obj.refresh_list(undefined, list);
                              }
                           }
                        } catch(E) {
                           obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.delete_volume.exception'),E);

                           obj.refresh_list(undefined, list);
                        }
                     }
                  ],
                    'cmd_mark_library' : [
                       ['command'],
                       function() {
                          try {
                             var list = util.functional.filter_list(
                                obj.sel_list,
                                function (o) {
                                    return o.split(/_/)[0] == 'aou';
                                }
                             );

                             list = util.functional.map_list(
                                list,
                                function (o) {
                                    return o.split(/_/)[1];
                                }
                             );

                             if (list.length == 1) {
                                obj.data.marked_library = { 'lib' : list[0], 'docid' : obj.docid };
                                obj.data.stash('marked_library');
                                alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.mark_library.alert'));
                             } else {
                                obj.error.yns_alert(
                                       document.getElementById('catStrings').getString('staff.cat.copy_browser.mark_library.prompt'),
                                       document.getElementById('catStrings').getString('staff.cat.copy_browser.mark_library.title'),
                                       document.getElementById('commonStrings').getString('common.ok'),
                                       null,
                                       null,
                                       document.getElementById('commonStrings').getString('common.confirm')
                                       );
                             }
                          } catch(E) {
                             obj.error.standard_unexpected_error_alert('copy browser -> mark library',E);
                          }
                       }
                    ],

                    'cmd_mark_volume' : [
                       ['command'],
                       function() {
                          try {
                             var list = util.functional.filter_list(
                                obj.sel_list,
                                function (o) {
                                    return o.split(/_/)[0] == 'acn';
                                }
                             );

                             list = util.functional.map_list(
                                list,
                                function (o) {
                                    return o.split(/_/)[1];
                                }
                             );

                             if (list.length == 1) {
                                obj.data.marked_volume = list[0];
                                obj.data.stash('marked_volume');
                                alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.mark_volume.alert'));
                             } else {
                                obj.error.yns_alert(
                                       document.getElementById('catStrings').getString('staff.cat.copy_browser.mark_volume.prompt'),
                                       document.getElementById('catStrings').getString('staff.cat.copy_browser.mark_volume.title'),
                                       document.getElementById('commonStrings').getString('common.ok'),
                                       null,
                                       null,
                                       document.getElementById('commonStrings').getString('common.confirm')
                                       );
                             }
                          } catch(E) {
                             obj.error.standard_unexpected_error_alert('copy browser -> mark volume',E);
                          }
                       }
                    ],
                     'cmd_refresh_list' : [
                        ['command'],
                        function() {

                           obj.full_data_reload();
                           obj.refresh_list();
                           document.getElementById('cat_copy_browser').removeChild(document.getElementById('loading_bar_box'));
                        }
                     ],
                     'cmd_transfer_volume' : [
                        ['command'],
                        function() {
                           try {

                              obj.transferring = true;
                              obj.data.stash_retrieve();
                              if (!obj.data.marked_library) {
                                 alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer_volume.alert'));
                                 return;
                              }

                              var libs_to_update = {};
                              libs_to_update[obj.data.marked_library.lib] = true;

                              var list = util.functional.filter_list(
                                 obj.sel_list,
                                 function (o) {
                                    return o.split(/_/)[0] == 'acn';
                                 }
                              );

                              list = util.functional.map_list(
                                 list,
                                 function (o) {
                                    return o.split(/_/)[1];
                                 }
                              );

                              var acn_list = util.functional.map_list(
                                 list,
                                 function (o) {
                                    return obj.map_acn[ o ].label();
                                 }
                              ).join(document.getElementById('commonStrings').getString('common.grouping_string'));

                              var xml = '<vbox xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul" flex="1" style="overflow: auto">';
                              xml += '<description>';
                              xml += document.getElementById('catStrings').getFormattedString('staff.cat.copy_browser.transfer.prompt', [acn_list, obj.data.hash.aou[ obj.data.marked_library.lib ].shortname()]);
                              xml += '</description>';
                              xml += '<hbox><button label="' + document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.submit.label') + '" name="fancy_submit"/>';
                              xml += '<button label="'
                              + document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.cancel.label')
                              + '" accesskey="'
                              + document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.cancel.accesskey')
                              + '" name="fancy_cancel"/></hbox>';
                              xml += '<iframe style="overflow: scroll" flex="1" src="' + urls.XUL_BIB_BRIEF + '?docid=' + obj.data.marked_library.docid + '" oils_force_external="true"/>';
                              xml += '</vbox>';

                              var data = new OpenILS.data();
                              data.init({'via':'stash'});

                              var win = new util.window();
                              var fancy_prompt_data = win.open(
                                 urls.XUL_FANCY_PROMPT,
                                 'fancy_prompt', 'chrome,resizable,modal,width=500,height=300',
                                 {
                                    'xml' : xml,
                                    'title' : document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.title')
                                 }
                              );

                              if (fancy_prompt_data.fancy_status == 'incomplete') {
                                 alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.incomplete'));
                                 return;
                              }

                              var robj = obj.network.simple_request(
                                 'FM_ACN_TRANSFER',
                                 [ ses(), { 'docid' : obj.data.marked_library.docid, 'lib' : obj.data.marked_library.lib, 'volumes' : list } ],
                                 null,
                                 {
                                    'title' : document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.override.failure'),
                                    'overridable_events' : [
                                       1208 /* TITLE_LAST_COPY */,
                                       1219 /* COPY_REMOTE_CIRC_LIB */,
                                    ],
                                 }
                              );

                              if (typeof robj.ilsevent != 'undefined') {
                                 if (robj.ilsevent == 1221 /* ORG_CANNOT_HAVE_VOLS */) {
                                    alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.ineligible_destination'));
                                 } else {
                                    throw(robj);
                                 }
                              } else {
                                 alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.success'));
                              }

                              var libs_to_update;

                              // If transferring within this tcn, move it on the page
                              if (obj.data.marked_library.docid == obj.docid){

                                 libs_to_update = obj.transfer_volumes_in_js(list, obj.data.marked_library.lib);
                              }

                              // If transferring to another tcn, remove it from the page
                              else {

                                 for (var l in list){

                                    libs_to_update = obj.remove_volume_from_js( obj.map_acn[ list[l] ], libs_to_update);
                                 }
                              }

                              obj.redraw_orgs(libs_to_update);
                              obj.list.refresh_ordinals();
                              obj.transferring = false;

                           } catch(E) {
                              obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer.unexpected_error'),E);
                           }

                        }
                     ],

                     'cmd_transfer_items' : [
                        ['command'],
                        function() {
                           try {
                              obj.data.stash_retrieve();
                              if (!obj.data.marked_volume) {
                                 alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer_items.missing_volume'));
                                 return;
                              }

                              var list = util.functional.filter_list(
                                 obj.sel_list,
                                 function (o) {
                                    return o.split(/_/)[0] == 'acp';
                                 }
                              );

                              // clear the selection list so it doesn't bork anything
                              // with volumes or libraries from the selection
                              obj.list.node.view.selection.clearSelection();

                              var orgs = obj.update_orgs_from_copy_code_list(list);

                              list = util.functional.map_list(
                                 list,
                                 function (o) {
                                    return o.split(/_/)[1];
                                 }
                              );

                              var volume = obj.network.simple_request('FM_ACN_RETRIEVE.authoritative',[ obj.data.marked_volume ]);

                              

                              var copies = cat.util.transfer_copies( {
                                 'copy_ids' : list,
                                 'docid' : volume.record(),
                                 'volume_label' : volume.label(),
                                 'owning_lib' : volume.owning_lib(),
                              } );

                              if (copies && copies != null){

                                 // If it's transferring to a volume in this tcn
                                 // move it on the page
                                 if (volume.record() == obj.docid){

                                    // returns the leftover copies, list, and libs_to_update
                                    var returned = obj.weed_and_transfer_copies_in_js(copies);

                                    // Get relevant orgs and redraw them
                                    for (var c in copies){

                                       if (typeof obj.map_acn[ copies[c].call_number() ] == 'object'
                                          && obj.map_acn[ copies[c].call_number() ].owning_lib() != 'object'){

                                          orgs[obj.map_acn[ copies[c].call_number() ].owning_lib()] = true;
                                       }
                                    }
                                 }

                                 // Otherwise, just remove them from the page
                                 // because it's transferring to a different tcn
                                 // not shown on this page
                                 else {

                                    for (var c in copies){

                                       var old_copy = obj.map_acp[ copies[c].id() ];
                                       var volume = obj.map_acn[ old_copy.call_number() ];

                                       orgs[ volume.owning_lib() ] = true;

                                       if (typeof volume == 'object' && volume.copies()){

                                          for (var v in volume.copies()){

                                             // when you find it, remove it, and break out of the for loop
                                             if (volume.copies()[v].id() == old_copy.id()){

                                                delete obj.map_acp[ old_copy.id() ];
                                                volume.copies().splice(v, 1);
                                             }
                                          }
                                       }
                                    }
                                 }

                                 obj.redraw_orgs(orgs);
                              }
                           } catch(E) {
                              obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer_items.unexpected_error'),E);
                           }
                        }
                     ],

                    'cmd_link_as_multi_bib' : [
                       ['command'],
                       function() {

                          try {
                             obj.data.stash_retrieve();
                             if (!obj.data.marked_multi_home_record) {
                                alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.link_as_multi_bib.missing_bib'));
                                return;
                             }

                             var list = util.functional.filter_list(
                                obj.sel_list,
                                function (o) {
                                    return o.split(/_/)[0] == 'acp';
                                }
                             );

                             list = util.functional.map_list(
                                list,
                                function (o) {
                                    return obj.map_acp[ o.split(/_/)[1] ].barcode();
                                }
                             );

                             xulG.new_tab(
                                window.xulG.url_prefix('MANAGE_MULTI_HOME_ITEMS'),
                                {},
                                { 'docid' : obj.data.marked_multi_home_record, 'barcodes' : list }
                             );

                          } catch(E) {
                             alert('Error in copy_browser.js, cmd_link_as_multi_bib: ' + E);
                          }

                          
                          var copies = cat.util.update_copies_by_id( list );
                          obj.refresh_list(copies);
                       }
                    ],

                    'cmd_print_tree' : [
                       ['command'],
                       function() {

                          try {
                             var p = {
                                'template' : 'holdings_maintenance',
                                'mvr_id' : obj.docid,
                                'print_data' : {}
                             };
                             bib_brief_overlay(p);
                             p.data = p.print_data;
                             obj.list.print(p);
                          } catch(E) {
                             alert('Error in copy_browser.js, cmd_print_tree: ' + E);
                          }
                       }
                    ]
                }
             }
          );

       } catch(E) {
          this.error.standard_unexpected_error_alert('cat.copy_browser.controller_init(): ',E);
       }
    },

   'update_orgs_from_copy_code_list' : function(list, orgs){

      var obj = this;

      if (!orgs){

         orgs = {};
      }

      for (var l in list){

         var old_copy = obj.map_acp[ list[l].split(/_/)[1] ];
         var old_volume = obj.map_acn[ old_copy.call_number() ];
         var lib_id = old_volume.owning_lib();

         orgs[lib_id] = true;
      }

      return orgs;
   },

    'depth_menu_init' : function(params) {
       var obj = this;
       try {
          var list = [];
          var max_depth = 0;
          for (var i = 0; i < obj.data.list.aout.length; i++) {
             var type = obj.data.list.aout[i];
             var depth = type.depth();
             if ( depth > max_depth) { max_depth = depth; }
             if (typeof list[depth] == 'undefined') {
                list[depth] = [
                    type.opac_label(),
                    type.depth(),
                    false,
                    ( type.depth() * 2)
                ];
             } else {
                list[depth][0] += ' / ' + type.opac_label();
             }
          }
          ml = util.widgets.make_menulist( list, max_depth );
          ml.setAttribute('id','depth_menu'); document.getElementById('x_depth_menu').appendChild(ml);
          ml.addEventListener(
             'command',
             function(ev) {
                obj.default_depth = ev.target.value;
                if (document.getElementById('refresh_button')) document.getElementById('refresh_button').focus();
                var file = new util.file('copy_browser_prefs.'+obj.data.server_unadorned);
                util.widgets.save_attributes(file, {
                    'lib_menu' : [ 'value' ],
                    'depth_menu' : [ 'value' ],
                    'show_acns' : [ 'checked' ],
                    'show_acps' : [ 'checked' ],
                    'hide_aous' : [ 'checked' ]
                });
             },
             false
          );

          file = new util.file('copy_browser_prefs.'+obj.data.server_unadorned);
          util.widgets.load_attributes(file);
          ml.value = ml.getAttribute('value');
          if (! ml.value) {
             ml.value = max_depth;
             ml.setAttribute('value',ml.value);
          }

          return ml.value;
       } catch(E) {
          alert('Error in copy_browser.js, depth_menu_init(): ' + E);
       }
    },

    'library_menu_init' : function(params) {
       var obj = this;
       try {

          obj.org_ids = util.functional.map_list( obj.org_ids, function (o) { return Number(o); });

          var org = obj.data.hash.aou[ obj.data.list.au[0].ws_ou() ];


          var file; var list_data; var ml;

          file = new util.file('offline_ou_list');
          if (file._file.exists()) {
             list_data = file.get_object(); file.close();
             for (var i = 0; i < list_data[0].length; i++) { // make sure all entries are enabled
                list_data[0][i][2] = false;
             }
             ml = util.widgets.make_menulist( list_data[0], list_data[1] );
             ml.setAttribute('id','lib_menu'); document.getElementById('x_lib_menu').appendChild(ml);
             for (var i = 0; i < obj.org_ids.length; i++) {
                ml.getElementsByAttribute('value',obj.org_ids[i])[0].setAttribute('class','has_copies');
             }
             ml.firstChild.addEventListener(
                'popupshowing',
                function(ev) {
                    document.getElementById('legend').setAttribute('hidden','false');
                },
                false
             );
             ml.firstChild.addEventListener(
                'popuphidden',
                function(ev) {
                    document.getElementById('legend').setAttribute('hidden','true');
                },
                false
             );
             ml.addEventListener(
                'command',
                function(ev) {
                    obj.default_lib = obj.data.hash.aou[ ev.target.value ];
                    if (document.getElementById('refresh_button')) document.getElementById('refresh_button').focus();
                    var file = new util.file('copy_browser_prefs.'+obj.data.server_unadorned);
                    util.widgets.save_attributes(file, {
                       'lib_menu' : [ 'value' ],
                       'depth_menu' : [ 'value' ],
                       'show_acns' : [ 'checked' ],
                       'show_acps' : [ 'checked' ],
                       'hide_aous' : [ 'checked' ]
                    });
                    obj.refresh_list();
                },
                false
             );
          } else {
             throw(document.getElementById('catStrings').getString('staff.cat.copy_browser.missing_library') + '\n');
          }

          file = new util.file('copy_browser_prefs.'+obj.data.server_unadorned);
          util.widgets.load_attributes(file);
          ml.value = ml.getAttribute('value');
          if (! ml.value) {
             ml.value = org.id();
             ml.setAttribute('value',ml.value);
          }

          return ml.value;

       } catch(E) {
          this.error.standard_unexpected_error_alert('cat.copy_browser.library_menu_init(): ',E);
       }
    },

   'show_consortial_count' : function() {
      var obj = this;

      var x = document.getElementById('consortial_total');
      if (x) x.setAttribute('value',obj.copy_count.count);
      x = document.getElementById('consortial_available');
      if (x) x.setAttribute('value',obj.copy_count.available);
   },

    'show_my_libs' : function(org) {
       var obj = this;
       try {
          if (!org) {
             org = obj.data.hash.aou[ obj.data.list.au[0].ws_ou() ];
          } else {
             if (typeof org != 'object') org = obj.data.hash.aou[ org ];
          }
          obj.show_libs( org, false );

       } catch(E) {
          alert(E);
       }
    },

    'show_all_libs' : function() {
       var obj = this;
       try {
          obj.show_my_libs();

          obj.show_libs( obj.data.tree.aou );


            document.getElementById('cmd_refresh_list').setAttribute('disabled','true');
            document.getElementById('cmd_show_libs_with_copies').setAttribute('disabled','true');
            document.getElementById('lib_menu').setAttribute('disabled','true');


          for (var i = 0; i < obj.data.tree.aou.children().length; i++) {

             var child = obj.data.tree.aou.children()[i];

             if (obj.data.hash.aout[child.ou_type()].depth() <= obj.default_depth
             && orgIsMine(obj.default_lib,child,obj.default_depth)) {

                    obj.show_libs( child );
             }
          }

         document.getElementById('cmd_refresh_list').setAttribute('disabled','false');
         document.getElementById('cmd_show_libs_with_copies').setAttribute('disabled','false');
         document.getElementById('lib_menu').setAttribute('disabled','false');

       } catch(E) {
          alert(E);
       }
    },

   'show_libs_with_copies' : function() {
      var obj = this;
      try {

         var orgs = util.functional.map_list(
            obj.org_ids,
            function(id) { return obj.data.hash.aou[id]; }
         ).sort(
            function( a, b ) {
               if (a.shortname() < b.shortname()) return -1;
               if (a.shortname() > b.shortname()) return 1;
               return 0;
            }
         );

         document.getElementById('cmd_refresh_list').setAttribute('disabled','true');
         document.getElementById('cmd_show_libs_with_copies').setAttribute('disabled','true');
         document.getElementById('lib_menu').setAttribute('disabled','true');

         for (var i = 0; i < orgs.length; i++) {

               obj.show_libs(orgs[i],false);
         }

         document.getElementById('cmd_refresh_list').setAttribute('disabled','false');
         document.getElementById('cmd_show_libs_with_copies').setAttribute('disabled','false');
         document.getElementById('lib_menu').setAttribute('disabled','false');

       } catch(E) {
         alert(E);
      }
   },

   // On init, load all libs
   'show_libs' : function(start_aou,show_open) {
      var obj = this;
      try {
         if (!start_aou) throw('show_libs: Need a start_aou');
         obj.data = new OpenILS.data(); obj.data.init({'via':'stash'});

         var parents = [];
         var temp_aou = start_aou;
         while ( temp_aou.parent_ou() ) {
            temp_aou = obj.data.hash.aou[ temp_aou.parent_ou() ];
            parents.push( temp_aou );
         }
         parents.reverse();

         for (var i = 0; i < parents.length; i++) {
            obj.append_org(parents[i], obj.data.hash.aou[ parents[i].parent_ou() ],{'container':'true','open':'true'});
         }

         obj.append_org(start_aou,obj.data.hash.aou[ start_aou.parent_ou() ]);

         if (start_aou.children()) {

            var x = obj.map_tree[ 'aou_' + start_aou.id() ];
            x.setAttribute('container','true');

            if (show_open) {

               x.setAttribute('open','true');
               obj.open_objs['aou_' + start_aou.id()] = true;
            }

            for (var i = 0; i < start_aou.children().length; i++) {

               var child = start_aou.children()[i];

               if (obj.data.hash.aout[child.ou_type()].depth() <= obj.default_depth
               && orgIsMine(obj.default_lib,child,obj.default_depth)) {

                  obj.append_org(child, start_aou);
               }
            }
         }
      } catch(E) {
         alert(E);
      }
   },

    'on_select' : function(list) {

       var obj = this;

       for (var i = 0; i < list.length; i++) {

          var node = obj.map_tree[ list[i] ];
          var row_type = list[i].split('_')[0];
          var id = list[i].split('_')[1];

          switch(row_type) {

             case 'aou' : obj.on_select_org(id); break;
             case 'acn' : obj.on_select_acn(id); break;
             default: break;
          }
       }
    },

   // When you click to expand an acn
   'on_select_acn' : function(acn_id) {

      var obj = this;

      var el = obj.getElementByTypeAndId("acn", acn_id);

      // Toggle open/closed
      if (obj.open_objs["acn_" + acn_id] === true){

         delete obj.open_objs["acn_" + acn_id];
      }

      else if (el != null && el.getAttribute("open")) {

         obj.open_objs["acn_" + acn_id] = true;
      }

      try {
         var acn_tree = obj.map_acn[ acn_id ];

         document.getElementById('cmd_refresh_list').setAttribute('disabled','true');
         document.getElementById('cmd_show_libs_with_copies').setAttribute('disabled','true');
         document.getElementById('lib_menu').setAttribute('disabled','true');

         if (acn_tree && acn_tree.copies()) {

            for (var i = 0; i < acn_tree.copies().length; i++) {

               obj.append_acp(acn_tree.copies()[i], acn_tree );
            }
         }

         document.getElementById('cmd_refresh_list').setAttribute('disabled','false');
         document.getElementById('cmd_show_libs_with_copies').setAttribute('disabled','false');
         document.getElementById('lib_menu').setAttribute('disabled','false');

      } catch(E) {
         alert(E);
      }
   },

   // When you click to expand an org
   'on_select_org' : function(org_id) {

      var obj = this;

      var el = obj.getElementByTypeAndId("aou", org_id);

      // Toggle open/closed
      if (obj.open_objs["aou_" + org_id]){

         delete obj.open_objs["aou_" + org_id];
      }

      else if (el != null && el.getAttribute("open")) {

         obj.open_objs["aou_" + org_id] = true;
      }

      try {

         var org = obj.data.hash.aou[ org_id ];

         document.getElementById('cmd_refresh_list').setAttribute('disabled','true');
         document.getElementById('cmd_show_libs_with_copies').setAttribute('disabled','true');
         document.getElementById('lib_menu').setAttribute('disabled','true');

         // For adding children libraries (not volumes)
         if (org.children()) {
            for (var i = 0; i < org.children().length; i++) {

               var child = org.children()[i];

               if (obj.data.hash.aout[child.ou_type()].depth() <= obj.default_depth
               && orgIsMine(obj.default_lib,child,obj.default_depth)) {

                  obj.append_org(child,org);
               }
            }
         }

         // For adding volumes
         if (obj.hashOfVolumes[ org_id ]) {

            for (var i = 0; i < obj.hashOfVolumes[ org_id ].length; i++) {

               obj.append_acn(org, obj.map_acn[ obj.hashOfVolumes[ org_id ][i] ] );
            }
         }

         document.getElementById('cmd_refresh_list').setAttribute('disabled','false');
         document.getElementById('cmd_show_libs_with_copies').setAttribute('disabled','false');
         document.getElementById('lib_menu').setAttribute('disabled','false');

      } catch(E) {
         alert('Error in copy_browser.js, on_select_org(): ' + E);
      }
   },

   'append_org' : function (org,parent_org,params) {

      var obj = this;
      obj.error.consoleService.logStringMessage('append_org: org = ' +
         org.shortname() + ' parent_org = ' +
         (parent_org ? parent_org.shortname() : '') + ' params = ' +
         js2JSON(params) + '\n');

      try {

         if (obj.map_tree[ 'aou_' + org.id() ]) {

            var x = obj.map_tree[ 'aou_' + org.id() ];

            if (params) {

               for (var i in params) {

                  x.setAttribute(i,params[i]);
               }
            }

            return x;
         }

         var data = {
            'row' : {
               'my' : {
                  'aou' : org,
               }
            },
            'skip_all_columns_except' : [0,1,2],
            'retrieve_id' : 'aou_' + org.id(),
            'to_bottom' : true,
            'no_auto_select' : true,
            'flesh_immediately' : true,
         };

         var acn_tree_list;

         if ( ! (obj.hashOfVolumes[ org.id() ] && obj.hashOfVolumes[ org.id() ].length > 0)){

            if ( get_bool( obj.data.hash.aout[ org.ou_type() ].can_have_vols() ) ) {

               data.row.my.volume_count = '0';
               data.row.my.copy_count = '<0>';
            }

            else {

               data.row.my.volume_count = '';
               data.row.my.copy_count = '';
            }
         }

         else {

            var v_count = 0; var c_count = 0;

            acn_tree_id_list = obj.hashOfVolumes[ org.id() ];

            for (var i = 0; i < acn_tree_id_list.length; i++) {

               v_count++;

               var vol_id = acn_tree_id_list[i];

               var copies = obj.map_acn[ vol_id ].copies();

               if (copies){

                  c_count += copies.length;
               }

               for (var j = 0; j < copies.length; j++) {

                  obj.map_acp[ copies[j].id() ] = copies[j];
               }
            }

            data.row.my.volume_count = String(v_count);
            data.row.my.copy_count = '<' + c_count + '>';
         }

         if (document.getElementById('hide_aous').checked) {

            if (org.children().length == 0
               && data.row.my.volume_count == '0') {

               if (!params) {

                  params = { 'hidden' : true };
               }

               else {

                  params['hidden'] = true;
               }

               dump('hiding org.id() = ' + org.id() + '\n');
            }
         }
         if (parent_org) {

            data.node = obj.map_tree[ 'aou_' + parent_org.id() ];
         }

         var nparams = obj.list.append(data);
         obj.list.refresh_ordinals();
         var node = nparams.treeitem_node;
         if (params) {
            for (var i in params) {
               node.setAttribute(i,params[i]);
            }
         }
         obj.map_tree[ 'aou_' + org.id() ] = node;

         if (org.children()) {
            node.setAttribute('container','true');
         }

         if (parent_org) {

            if ( obj.data.hash.aou[ obj.data.list.au[0].ws_ou() ].parent_ou() == parent_org.id() ) {

               data.node.setAttribute('open','true');
               obj.open_objs['aou_' + parent_org.id()] = true;
            }
         }

         else {

            obj.map_tree[ 'aou_' + org.id() ].setAttribute('open','true');
            obj.open_objs['aou_' + org.id()] = true;
         }

         if (acn_tree_list) {

            node.setAttribute('container','true');
         }

         if (document.getElementById('show_acns').checked || obj.open_objs['aou_' + org.id()]) {

            node.setAttribute('open','true');
            obj.open_objs['aou_' + org.id()] = true;
            obj.on_select_org( org.id() );
         }

      } catch(E) {
         dump(E+'\n');
         alert(E);
      }
   },

   // After you click to expand an org
   'append_acn' : function( org, acn_tree, params ) {

      var obj = this;

      try {

         if (acn_tree.copies()){// && acn_tree.copies().length > 0

            if (obj.map_tree[ 'acn_' + acn_tree.id() ]) {
               var x = obj.map_tree[ 'acn_' + acn_tree.id() ];
               if (params) {
                  for (var i in params) {
                     x.setAttribute(i,params[i]);
                  }
               }
               return x;
            }

            var parent_node = obj.map_tree[ 'aou_' + org.id() ];
            var data = {
               'row' : {
                  'my' : {
                     'aou' : org,
                     'acn' : acn_tree,
                     'volume_count' : '',
                     'copy_count' : acn_tree.copies() ? acn_tree.copies().length : '0',
                  }
               },
               'skip_all_columns_except' : [0,1,2],
               'retrieve_id' : 'acn_' + acn_tree.id(),
               'node' : parent_node,
               'to_bottom' : true,
               'no_auto_select' : true,
               'flesh_immediately' : true,
            };

            var nparams = obj.list.append(data);
            obj.list.refresh_ordinals();
            var node = nparams.treeitem_node;
            obj.map_tree[ 'acn_' + acn_tree.id() ] =  node;

            if (params) {

               for (var i in params) {

                  node.setAttribute(i,params[i]);
               }
            }

            if (acn_tree.copies()) {

               obj.map_acn[ acn_tree.id() ] = acn_tree;
               node.setAttribute('container','true');
            }

            if (document.getElementById('show_acps').checked || obj.open_objs['acn_' + acn_tree.id()]) {

               node.setAttribute('open','true');
               obj.open_objs['acn_' + acn_tree.id()] = true;
               obj.on_select_acn( acn_tree.id() );
            }
         }
      } catch(E) {
         dump(E+'\n');
         alert(E);
      }
   },

   //After you click to expand a volume
   'append_acp' : function( acp_item, acn_tree, params ) {

      var obj = this;

      try {

         if (obj.map_tree[ 'acp_' + acp_item.id() ]) {

            var x = obj.map_tree[ 'acp_' + acp_item.id() ];

            if (params) {

               for (var i in params) {

                  x.setAttribute(i,params[i]);
               }
            }

            return x;
         }

         var parent_node = obj.map_tree[ 'acn_' + acn_tree.id() ];

         var data = {
            'row' : {
               'my' : {
                  'doc_id' : obj.docid,
                  'aou' : obj.data.hash.aou[ acn_tree.owning_lib() ],
                  'acn' : acn_tree,
                  'acp' : acp_item,
                  'circ' :
                     acp_item.circulations()
                     ? (
                     acp_item.circulations().length > 0
                     ? acp_item.circulations()[0]
                     : null
                     )
                     : null,
                  'volume_count' : '',
                  'copy_count' : '',
                  'barcode' : acp_item.barcode()
               }
            },
            'retrieve_id' : 'acp_' + acp_item.id(),
            'node' : parent_node,
            'to_bottom' : true,
            'no_auto_select' : true,
            'flesh_immediately' : true,
         };

         var nparams = obj.list.append(data);
         obj.list.refresh_ordinals();
         var node = nparams.treeitem_node;
         obj.map_tree[ 'acp_' + acp_item.id() ] =  node;//always empty hash

         if (params) {//always undef
            for (var i in params) {
               node.setAttribute(i,params[i]);
            }
         }

      } catch(E) {
         dump(E+'\n');
         alert(E);
      }
   },

   'refresh_org' : function (org,parent_org,params) {

      var obj = this;

      obj.error.consoleService.logStringMessage('append_org: org = ' +
         org.shortname() + ' parent_org = ' +
         (parent_org ? parent_org.shortname() : '') + ' params = ' +
         js2JSON(params) + '\n');

      try {

         var parent_node;

         if (parent_org) {

            parent_node = obj.map_tree[ 'aou_' + parent_org.id() ];
         }

         var el = obj.getElementByTypeAndId(org.classname, org.id());

         var nextSibling = null;

         if (el != null){
			
            nextSibling = el.nextSibling;
         }

         obj.remove_from_screen(org);

         var data = {
            'row' : {
               'my' : {
                  'aou' : org,
               }
            },
            'skip_all_columns_except' : [0,1,2],
            'retrieve_id' : 'aou_' + org.id(),
            'no_auto_select' : true,
            'flesh_immediately' : true,
            'add_before' : nextSibling
         };

         var acn_tree_id_list;

         // If it doesn't have any volumes
         if ( ! (obj.hashOfVolumes[ org.id() ] && obj.hashOfVolumes[ org.id() ].length > 0)){

            if ( get_bool( obj.data.hash.aout[ org.ou_type() ].can_have_vols() ) ) {

               data.row.my.volume_count = '0';
               data.row.my.copy_count = '<0>';
            }

            else {

               data.row.my.volume_count = '';
               data.row.my.copy_count = '';
            }
         }

         else {

            var v_count = 0; var c_count = 0;

            acn_tree_id_list = obj.hashOfVolumes[ org.id() ];

            for (var i = 0; i < acn_tree_id_list.length; i++) {

               v_count++;
               var vol_id = acn_tree_id_list[i];
               var copies = obj.map_acn[ vol_id ].copies();

               if (copies){

                  c_count += copies.length;
               }
            }

            data.row.my.volume_count = String(v_count);
            data.row.my.copy_count = '<' + c_count + '>';
         }

         if (document.getElementById('hide_aous').checked) {

            if (org.children().length == 0
               && data.row.my.volume_count == '0') {

               if (!params) {

                  params = { 'hidden' : true };
               }

               else {

                  params['hidden'] = true;
               }

               dump('hiding org.id() = ' + org.id() + '\n');
            }
         }
         if (parent_node) {

            data.node = parent_node;
         }

         var nparams = obj.list.append(data);

         obj.list.refresh_ordinals();

         var node = nparams.treeitem_node;

         if (params) {

            for (var i in params) {

               node.setAttribute(i,params[i]);
            }
         }

         obj.map_tree[ 'aou_' + org.id() ] = node;

         if (org.children()) {
            node.setAttribute('container','true');
         }

         if (parent_org) {

            if ( data.node && obj.data.hash.aou[ obj.data.list.au[0].ws_ou() ].parent_ou() == parent_org.id() ) {

               obj.open_objs['aou_' + parent_org.id()] = true;
               data.node.setAttribute('open','true');
            }
         }

         else {

            obj.open_objs['aou_' + org.id()] = true;
            obj.map_tree[ 'aou_' + org.id() ].setAttribute('open','true');
         }

         if (acn_tree_id_list) {

            node.setAttribute('container','true');
         }

         // Open the library
         obj.open_objs['aou_' + org.id()] = true;
         node.setAttribute('open','true');
         obj.on_select_org( org.id() );

         // Now open it's volumes
         acn_tree_id_list = obj.hashOfVolumes[ org.id() ];

         for (var i in acn_tree_id_list) {

            obj.on_select_acn( acn_tree_id_list[i]);
         }

      } catch(E) {
         dump(E+'\n');
         alert(E);
      }
   },

   'remove_from_screen' : function( object ){

      if (typeof object == "object"){

         var obj = this;
         var type = object.classname;
         var id = object.id();

         if (obj.map_tree[ type + '_' + id ]) {

            // remove all children as well
            if (type == "aou"){

               for (var v in obj.hashOfVolumes[id]){

                  var volume_id = obj.hashOfVolumes[id][v];
                  var volume = obj.map_acn[ volume_id ];

                  obj.remove_from_screen( volume );
               }
            }

            if (type == "acn"){

               for (var c in object.copies()){

                  obj.remove_from_screen(object.copies()[c]);
               }
            }

            // Delete from the map_tree
            delete obj.map_tree[ type + '_' + id ];
         }

         // Remove the element from the page
         var el = obj.getElementByTypeAndId(type, object.id());

         if (el != null && el.parentNode){

            el.parentNode.removeChild( el );
         }
      }
   },

   //After a change is made
   'alter_acp_on_screen' : function( acp_item, acn_tree, params ) {

      var obj = this;
      try {

         // If it's in there, it means it's not new
         // So we either need to delete it or replace it
         if (obj.map_tree[ 'acp_' + acp_item.id() ]) {

            // If the item 'isdeleted', then just remove it
            if (acp_item.isdeleted()){

               // Delete the copy in the map_tree
               delete obj.map_tree[ 'acp_' + acp_item.id() ];

               var acn_id = acp_item.call_number();

               if (typeof acn_id == 'object'){

                  acn_id = acn_id.id();
               }

               // Remove the element from the page
               var el = obj.getElementByTypeAndId('acp', acp_item.id());

               if (el != null){

                  el.parentNode.removeChild( el );
               }
            }

            // Otherwise it needs replacing
            else{

               var x = obj.map_tree[ 'acp_' + acp_item.id() ];

               // Set any parameter changes
               if (params) {
                  for (var i in params) {
                     x.setAttribute(i,params[i]);
                  }
               }
            }
         }

         // It must be new, so add it
         else{

            // If no volume was passed in
            if (!acn_tree){

               // If the copy has a full acn in it, use that
               if (typeof acp_item.call_number() == 'object'){

                  acn_tree = acp_item.call_number();
               }

               else {

                  // If it's just not there, grab one from the DB by it's id
                  acn_tree = obj.network.simple_request('FM_ACN_RETRIEVE.authoritative',[ acp_item.call_number() ]);
               }
            }

            var parent_node = obj.map_tree[ 'acn_' + acn_tree.id() ];

            var data = {
               'row' : {
                  'my' : {
                     'doc_id' : obj.docid,
                     'aou' : obj.data.hash.aou[ acn_tree.owning_lib() ],
                     'acn' : acn_tree,
                     'acp' : acp_item,
                     'circ' :
                        acp_item.circulations()
                        ? (
                           acp_item.circulations().length > 0
                           ? acp_item.circulations()[0]
                           : null
                        )
                        : null,
                     'volume_count' : '',
                     'copy_count' : '',
                     'barcode' : function(){
                        return this.acp.barcode();
                     }
                  }
               },
               'retrieve_id' : 'acp_' + acp_item.id(),
               'node' : parent_node,
               'to_bottom' : true,
               'no_auto_select' : true,
               'flesh_immediately' : true,
            };

            var nparams = obj.list.append(data);
            obj.list.refresh_ordinals();
            var node = nparams.treeitem_node;
            obj.map_tree[ 'acp_' + acp_item.id() ] =  node;//always empty hash

            if (params) {//always undef
               for (var i in params) {
                  node.setAttribute(i,params[i]);
               }
            }
         }
      } catch(E) {
         dump(E+'\n');
         alert(E);
      }
   },

    'list_init' : function( params ) {

       try {
          var obj = this;

          var columns = [
             {
                'id' : 'tree_location',
                'label' : document.getElementById('catStrings').getString('staff.cat.copy_browser.list_init.tree_location'),
                'flex' : 1, 'primary' : true, 'hidden' : false,
                'render' : function(my) { return my.acp ? my.acp.barcode() : my.acn ? my.acn.label() : my.aou ? my.aou.shortname() + " : " + my.aou.name() : "???"; },
             },
             {
                'id' : 'volume_count',
                'label' : document.getElementById('catStrings').getString('staff.cat.copy_browser.list_init.volume_count'),
                'flex' : 0, 'primary' : false, 'hidden' : false,
                'render' : function(my) { return my.volume_count; },
             },
             {
                'id' : 'copy_count',
                'label' : document.getElementById('catStrings').getString('staff.cat.copy_browser.list_init.copy_count'),
                'flex' : 0,
                'primary' : false, 'hidden' : false,
                'render' : function(my) { return my.copy_count; },
             },
          ].concat(
             circ.util.columns(
                {
                    'location' : { 'hidden' : false },
                    'circ_lib' : { 'hidden' : false },
                    'owning_lib' : { 'hidden' : false },
                    'call_number' : { 'hidden' : false },
                    'parts' : { 'hidden' : false },
                    'due_date' : { 'hidden' : false },
                    'acp_status' : { 'hidden' : false },
                },
                {
                    'just_these' : [
                       'due_date',
                       'owning_lib',
                       'circ_lib',
                       'label_class',
                       'prefix',
                       'call_number',
                       'suffix',
                       'copy_number',
                       'parts',
                       'location',
                       'barcode',
                       'loan_duration',
                       'fine_level',
                       'circulate',
                       'holdable',
                       'opac_visible',
                       'ref',
                       'deposit',
                       'deposit_amount',
                       'price',
                       'circ_as_type',
                       'circ_modifier',
                       'acp_status',
                       'alert_message',
                       'acp_mint_condition',
                       'acp_id'
                    ]
                }
             )
          );

         obj.list = new util.list('copy_tree');
         obj.list.init(
            {
               'no_auto_select' : true,
               'columns' : columns,
               'retrieve_row' : function(params) {

                  var row = params.row;

                  if (typeof params.on_retrieve == 'function') {

                     params.on_retrieve(row);
                  }

                  obj.list.refresh_ordinals();

                  return row;
               },
               'on_click' : function(ev) {

                  var row = {};
                  var col = {};
                  var nobj = {};
                  obj.list.node.treeBoxObject.getCellAt(ev.clientX,ev.clientY,row,col,nobj);

                  if ((row.value == -1)||(nobj.value != 'twisty')) {

                     return;
                  }

                  var node = obj.list.node.contentView.getItemAtIndex(row.value);
                  var list = [ node.getAttribute('retrieve_id') ];

                  if (typeof obj.on_select == 'function') {

                     obj.on_select(list,true);
                  }

                  if (typeof window.xulG == 'object' && typeof window.xulG.on_select == 'function') {

                     window.xulG.on_select(list);
                  }

                  obj.list.refresh_ordinals();
               },
               'on_dblclick' : function(ev) {

                  var sel = obj.list.retrieve_selection();
                  obj.controller.view.sel_clip.disabled = sel.length < 1;

                  obj.sel_list = util.functional.map_list(
                     sel,
                     function(o) {
                        return o.getAttribute('retrieve_id');
                     }
                  );

                  obj.toggle_actions();
                  util.widgets.dispatch('command','cmd_edit_items');
                  obj.list.refresh_ordinals();

               },
               'on_select' : function(ev) {

                  /* 
                   * This is a horrible hack because for some reason on_select
                   * gets called ITERATIVELY from the 'remove_from_screen'
                   * on the line that reads - el.parentNode.removeChild( el );
                   * and goes into an infinite loop.
                   * 
                   * This only happens when you try to transfer two or more
                   * volumes to a library.  Weird huh?
                   * 
                   * This fixes it.
                   */
                  //if (!obj.transferring){

                     var sel = obj.list.retrieve_selection();
                     obj.controller.view.sel_clip.disabled = sel.length < 1;
                     obj.sel_list = util.functional.map_list(
                        sel,
                        function(o) { return o.getAttribute('retrieve_id'); }
                     );
                     obj.toggle_actions();
                     if (typeof obj.on_select == 'function' && !obj.transferring) {

                        obj.on_select(obj.sel_list);
                     }
                     if (typeof window.xulG == 'object' && typeof window.xulG.on_select == 'function') {

                        window.xulG.on_select(obj.sel_list);
                     }
                     obj.list.refresh_ordinals();
                  //}
               },
            }
         );

         $('list_actions').appendChild( obj.list.render_list_actions() );
         obj.list.set_list_actions();

      } catch(E) {
         this.error.sdump('D_ERROR','cat.copy_browser.list_init: ' + E + '\n');
         alert(E);
      }
   },

    // Sets can_have_copies and source member variables.
    'source_init' : function() {
       var obj = this;
       try {
          
          var cbsObj = cat.util.get_cbs_for_bre_id(obj.docid);
          if(cbsObj) {
             obj.can_have_copies = (cbsObj.can_have_copies() == get_db_true());
             obj.source = cbsObj.source();
          } else {
             obj.can_have_copies = true;
          }
       } catch(E) {
          obj.error.sdump('D_ERROR','can have copies check: ' + E);
          alert(E);
       }
    },

   'toggle_actions' : function() {
      var obj = this;
      try {
         var found_aou = false; var found_acn = false; var found_acp = false;
         var found_aou_with_can_have_vols = false;
         var sel_copy_libs = {};
         for (var i = 0; i < obj.sel_list.length; i++) {
            var type = obj.sel_list[i].split(/_/)[0];

            switch(type) {
               case 'aou' :
                  found_aou = true;
                  var org = obj.data.hash.aou[ obj.sel_list[i].split(/_/)[1] ];
                  if ( get_bool( obj.data.hash.aout[ org.ou_type() ].can_have_vols() ) ) found_aou_with_can_have_vols = true;
                  break;
               case 'acn' : found_acn = true; break;
               case 'acp' :
                  found_acp = true;

                  if (obj.map_acp[obj.sel_list[i]]
                     && obj.map_acn[ obj.map_acp[obj.sel_list[i]].call_number()]){

                     sel_copy_libs[
                        obj.map_acn[
                           obj.map_acp[obj.sel_list[i]].call_number()
                        ].owning_lib()
                     ] = true;
                     break;
                  }
            }
         }
         obj.controller.view.cmd_add_items.setAttribute('disabled','true');
         obj.controller.view.cmd_add_items_to_buckets.setAttribute('disabled','true');
         obj.controller.view.cmd_edit_items.setAttribute('disabled','true');
         obj.controller.view.cmd_replace_barcode.setAttribute('disabled','true');
         obj.controller.view.cmd_delete_items.setAttribute('disabled','true');
         obj.controller.view.cmd_print_spine_labels.setAttribute('disabled','true');
         obj.controller.view.cmd_add_volumes.setAttribute('disabled','true');
         obj.controller.view.cmd_mark_library.setAttribute('disabled','true');
         obj.controller.view.cmd_edit_volumes.setAttribute('disabled','true');
         obj.controller.view.cmd_delete_volumes.setAttribute('disabled','true');
         obj.controller.view.cmd_mark_volume.setAttribute('disabled','true');
         obj.controller.view.cmd_transfer_volume.setAttribute('disabled','true');
         obj.controller.view.cmd_transfer_items.setAttribute('disabled','true');
         obj.controller.view.sel_copy_details.setAttribute('disabled','true');
         obj.controller.view.cmd_create_brt.setAttribute('disabled','true');
         obj.controller.view.cmd_book_item_now.setAttribute('disabled','true');
         obj.controller.view.sel_patron.setAttribute('disabled','true');
         obj.controller.view.sel_mark_items_damaged.setAttribute('disabled','true');
         obj.controller.view.sel_mark_items_missing.setAttribute('disabled','true');
         if (found_aou && found_aou_with_can_have_vols) {
            obj.controller.view.cmd_add_volumes.setAttribute('disabled','false');
            obj.controller.view.cmd_mark_library.setAttribute('disabled','false');
         }
         if (found_acn) {
            obj.controller.view.cmd_edit_volumes.setAttribute('disabled','false');
            obj.controller.view.cmd_delete_volumes.setAttribute('disabled','false');
            obj.controller.view.cmd_mark_volume.setAttribute('disabled','false');
            obj.controller.view.cmd_add_items.setAttribute('disabled','false');
            obj.controller.view.cmd_transfer_volume.setAttribute('disabled','false');
         }
         if (found_acp) {
            obj.controller.view.sel_mark_items_damaged.setAttribute('disabled','false');
            obj.controller.view.sel_mark_items_missing.setAttribute('disabled','false');
            obj.controller.view.cmd_add_items_to_buckets.setAttribute('disabled','false');
            obj.controller.view.cmd_edit_items.setAttribute('disabled','false');
            obj.controller.view.cmd_replace_barcode.setAttribute('disabled','false');
            obj.controller.view.cmd_delete_items.setAttribute('disabled','false');
            obj.controller.view.cmd_print_spine_labels.setAttribute('disabled','false');
            obj.controller.view.cmd_transfer_items.setAttribute('disabled','false');
            obj.controller.view.sel_copy_details.setAttribute('disabled','false');
            obj.controller.view.cmd_create_brt.setAttribute('disabled','false');
            obj.controller.view.sel_patron.setAttribute('disabled','false');

            var L = 0; for (var k in sel_copy_libs) L++;
            if (L < 2) {
               obj.controller.view.cmd_book_item_now.setAttribute('disabled','false');
            }
         }
      } catch(E) {
         obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.actions.error'),E);
      }
   },

   // copies is an optional arg.  It will update org.data with the given copies
   'refresh_list' : function(copies, volumes, libs_to_update) {
      try {

         var obj = this;

         // Clear the current selection
         obj.list.node.view.selection.clearSelection();

         if (copies || volumes){

            libs_to_update = obj.refresh_copies(copies, libs_to_update);
            libs_to_update = obj.refresh_volumes(volumes, libs_to_update);
            obj.redraw_orgs(libs_to_update);
         }

         else{

            obj.list.clear();
            obj.map_tree = {};

            obj.org_ids = util.functional.map_list( obj.org_ids, function (o) { return Number(o); });

            // Renders all libs, vols, copies, etc.
            obj.show_my_libs( obj.default_lib.id() );

            obj.show_consortial_count();

            if (typeof xulG.reload_opac == 'function') {

               xulG.reload_opac();
            }
         }

      } catch(E) {
         this.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.refresh_list.error'),E);
      }
   },

   // will update org.data with the given copies
   'refresh_copies' : function(copies, libs_to_update) {

      if (!libs_to_update){

         libs_to_update = {};
      }

      try {

         if (copies && copies != null){

            var obj = this;

            // For every copy...
            for (var i in copies) {

               // So I know which libs to redraw
               var owning_lib = obj.map_acn[ copies[i].call_number() ].owning_lib();
               libs_to_update[owning_lib] = true;

               //To add the newly changed copy
               var listOfVolumeIds = obj.hashOfVolumes[owning_lib];

               // go through all volumes...
               for (var v in listOfVolumeIds){

                  var handled = false;

                  if (listOfVolumeIds[v] == copies[i].call_number()){

                     var volume = obj.map_acn[ listOfVolumeIds[v] ];

                     for (var c in volume.copies()){

                        if (volume.copies()[c].id() == copies[i].id()){

                           // Handle changes to total copy count
                           obj.update_available_copy_count(copies[i], volume.copies()[c]);

                           // If we're deleting, delete it
                           if(copies[i].isdeleted()){

                              delete obj.map_acp[ volume.copies()[c].id() ];
                              volume.copies().splice(c, 1);
                           }

                           // Otherwise we're replacing
                           else{

                              volume.copies()[c] = copies[i];
                              obj.map_acp[ copies[i].id() ] = copies[i];
                           }

                           handled = true;
                           break;
                        }
                     }

                     // If we didn't find it, it must be new
                     if (!handled && !copies[i].isdeleted()){

                        volume.copies().push(copies[i]);
                        obj.map_acp[ copies[i].id() ] = copies[i];
                        obj.update_available_copy_count(copies[i]);
                     }

                     obj.map_acn[ listOfVolumeIds[v] ] = volume;
                  }

                  if (handled){

                     break;
                  }
               }
            }

            // Update screen with any changes to total or available copies
            obj.show_consortial_count();

            return libs_to_update;
         }
      } catch(E) {
         return libs_to_update;
         this.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.refresh_list.error'),E);
      }
    },

   // This filters through the inputs and only calls transfer_copies_in_js for copies that need it
   'weed_and_transfer_copies_in_js' : function(copies){

      var obj = this;

      try{

         var transferred_copies = [];

         var leftover_copies = [];
         var libs_to_update = {};

         // Check for copies that may have been transferred
         for (var l in copies){

            // If their volume doesn't exist, it must be a new one
            if (!obj.map_acn[ copies[l].call_number()]){

               transferred_copies.push(copies[l]);
            }

            else{

               var old_lib = obj.map_acn[ obj.map_acp[ copies[l].id()].call_number()].owning_lib();
               var new_lib = obj.map_acn[ copies[l].call_number()].owning_lib();

               // If they have a new volume or new library, they must have been transferred
               if (old_lib != new_lib
               || obj.map_acp[ copies[l].id()].call_number() != copies[l].call_number()){

                  transferred_copies.push(copies[l]);

                  if (old_lib){ libs_to_update[old_lib] = true; };
                  if (new_lib){ libs_to_update[new_lib] = true; };
               }

               else{

                  leftover_copies.push(copies[l]);
               }
            }
         }

         if (transferred_copies.length > 0){

            libs_to_update = obj.transfer_copies_in_js(transferred_copies, libs_to_update);
         }

         var return_array = [ leftover_copies, libs_to_update];

         return return_array;

      } catch(E) {
         obj.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.transfer_items.unexpected_error'),E);
      }
   },

   // new_copies has to be real objects (in case we don't have in memory data on the new thing)
   // libs_to_update: optional as always
   'transfer_copies_in_js' : function(new_copies, libs_to_update){

      //var libs_to_update = obj.transfer_copies_in_js(list, copies);
      var obj = this;

      // list of the old copies
      var old_copies = [];

      if (!libs_to_update){

         libs_to_update = {};
      }

      // Update libs_to_update with old locations
      for (var c in new_copies){

         var old_copy = cloneCopy(obj.map_acp[ new_copies[c].id() ]);
         var old_volume = obj.map_acn[ old_copy.call_number()];
         libs_to_update[ old_volume.owning_lib() ] = true;
         old_copies.push(old_copy);
      }

      //
      //* Now we need to update the in memory data structures
      //*/

      // For every moved copy...
      for (var c in new_copies) {

         var new_volume = obj.map_acn[ new_copies[c].call_number() ];

         // If we don't yet have the new volume in memory...
         if (!new_volume){

            new_volume = obj.network.simple_request('FM_ACN_RETRIEVE.authoritative',[  new_copies[c].call_number() ]);

            // Add the copy to the volume
            new_volume = obj.add_copy_to_volume_in_js(new_volume, new_copies[c]);
            libs_to_update[new_volume.owning_lib()] = true;

            //To add the newly changed copy, just add the whole volume
            obj.add_new_volumes_to_js( [ new_volume ] );
         }

         else{

            //To add the newly changed copy...
            var listOfVolumeIds = obj.hashOfVolumes[new_volume.owning_lib()];

            // go through all volumes...
            for (var v in listOfVolumeIds){

               // Add copy to it's new volume
               if (listOfVolumeIds[v] == new_copies[c].call_number()){

                  new_volume = obj.add_copy_to_volume_in_js(new_volume, new_copies[c]);
                  libs_to_update[new_volume.owning_lib()] = true;
                  obj.map_acn[ listOfVolumeIds[v] ] = new_volume;

                  break;
               }
            }
         }

         // Update the copy data
         obj.map_acp[ new_copies[c].id() ] = new_copies[c];
         libs_to_update[new_volume.owning_lib()] = true;
      }

      //to remove the old copies
      for (var o in old_copies){

         // These should always match because of how the lists were built
         if (new_copies[o] && old_copies[o].id() == new_copies[o].id()){

            // get the old volume
            var old_volume = obj.map_acn[ old_copies[o].call_number()];

            // If there's no old_volume, don't worry about it
            if (old_volume){

               for (var c in old_volume.copies()){

                  // When we find it, kill it!
                  if (old_volume.copies()[c].id() == old_copies[o].id()){

                     old_volume.copies().splice(c,1);
                     obj.map_acn[ old_volume.id()] = old_volume;
                     break;
                  }
               }
            }
         }

         // So that's pretty weird...
         else{

            // Lets iterate through new_copies and see if we can find the match
            for (var n in new_copies){

               if (old_copies[o].id() == new_copies[n].id()){

                  // get the old volume
                  var old_volume = obj.map_acn[ old_copies[o].call_number()];

                  // If there's no old_volume, don't worry about it
                  if (old_volume){

                     for (var c in old_volume.copies()){

                        // When we find it, kill it!
                        if (old_volume.copies()[c].id() == old_copies[o].id()){

                           old_volume.copies().splice(c,1);
                           obj.map_acn[ old_volume.id()] = old_volume;
                           break;
                        }
                     }
                  }
               }
            }
         }
      }

      return libs_to_update;
   },

   // will update org.data with the given volumes
   'refresh_volumes' : function(volumes, libs_to_update) {

      if (!libs_to_update){

         libs_to_update = {};
      }

      try {

         var obj = this;

         if (volumes && volumes != null){

            if (typeof volumes[0] != 'object'){

               volumes = cat.util.request_volumes(volumes);
            }

            // Handle each volume
            for (var i in volumes) {

               var handled = false;
               var old_volume = obj.map_acn[ volumes[i].id() ];

               // If it's new, add it
               if (!old_volume){

                  libs_to_update = obj.add_new_volumes_to_js([volumes[i]], libs_to_update);
                  handled = true;
               }

               // If the owning_libs are different, then it's been transferred
               if (!handled && volumes[i].owning_lib() != old_volume.owning_lib()){

                  libs_to_update[old_volume.owning_lib()] = true;
                  libs_to_update = obj.transfer_volumes_in_js( [ volumes[i] ], volumes[i].owning_lib(), libs_to_update);
                  handled = true;
               }

               // If it's deleted, remove it
               if (!handled && volumes[i].isdeleted()){

                  libs_to_update = obj.remove_volume_from_js(volumes[i], libs_to_update);
                  handled = true;
               }

               // If it's still not handled, it just needs to be replaced
               if (!handled){

                  libs_to_update = obj.replace_volume_in_js(volumes[i], libs_to_update);
               }
            }
         }

         // Update screen with any changes to total or available copies
         obj.show_consortial_count();

         return libs_to_update;

      } catch(E) {

         this.error.standard_unexpected_error_alert(document.getElementById('catStrings').getString('staff.cat.copy_browser.refresh_list.error'),E);
         return libs_to_update;
      }
   },

   // Takes a list of full volume objects, libs_to_update is optional
   'add_new_volumes_to_js' : function(volumes, libs_to_update){

      var obj = this;

      if (!libs_to_update){

         libs_to_update = {};
      }

      for (var v in volumes){

         var owning_lib = volumes[v].owning_lib();
         libs_to_update[owning_lib] = true;

         // This decides whether to push the transferred volume
         // to the library list or not.  It only doesn't push
         // if a matching volume is found to inherit it's copies
         var push_volume = true;

         // If the new library's not there, add it
         if (!obj.hashOfVolumes[owning_lib]){

            obj.hashOfVolumes[owning_lib] = [];
         }

         // If the new library is there, check to see if there are any matching volumes
         else{
            for (var h in obj.hashOfVolumes[owning_lib]){

               var destination_volume = obj.map_acn[ obj.hashOfVolumes[owning_lib][h] ];
               // If transferred volume matches this volume, just transfer the copies
               if (volumes[v].label() === destination_volume.label()){

                  // just transfer all the copies to the found volume
                  var destination_copies = destination_volume.copies();
                  var copies_to_move = volumes[v].copies();

                  // Update the call number on the moving copies
                  for (var c in copies_to_move){

                     var new_copy = cloneCopy(copies_to_move[c]);
                     new_copy.call_number(destination_volume.id());
                     new_copy.circ_lib(owning_lib);
                     copies_to_move[c] = new_copy;
                  }

                  // Transfer those copies in the js
                  libs_to_update = obj.transfer_copies_in_js(copies_to_move, libs_to_update);

                  // and don't push the volume
                  push_volume = false;

                  break;
               }
            }
         }

         // just add the volume
         if (push_volume){

            // update copies circ_libs
            for (var c in volumes[v].copies()){

               volumes[v].copies()[c].circ_lib(owning_lib);
               obj.map_acp[ volumes[v].copies()[c].id() ] = volumes[v].copies()[c];
            }

            obj.hashOfVolumes[owning_lib].push(volumes[v].id());
            obj.map_acn[ volumes[v].id() ] = volumes[v];
         }
      }

      return libs_to_update;
   },

   // Takes a list of volume ids, the destination id, and (optionally) libs_to_update
   'transfer_volumes_in_js' : function(volume_ids, destination_id, libs_to_update){

      var obj = this;

      if (!libs_to_update){

         libs_to_update = {};
      }

      // We'll need to redraw the new library
      libs_to_update[obj.get_id(destination_id)] = true;

      for (var v in volume_ids){

         volume_ids[v] = obj.get_id(volume_ids[v]);

         // If it's not there, it can't be transferred
         if ( obj.map_acn[ volume_ids[v] ] ){

            var volume = obj.map_acn[ volume_ids[v] ];

            // remember the volume id we're leaving
            var old_vol_id = volume.id();

            // We'll need to redraw the old libraries
            libs_to_update[ volume.owning_lib() ] = true;

            // find the old volume and remove it
            for (var i in obj.hashOfVolumes[ volume.owning_lib() ]){

               var vol_id = obj.hashOfVolumes[ volume.owning_lib() ][i];

               // This is it
               if (vol_id == volume.id()){

                  obj.hashOfVolumes[ volume.owning_lib() ].splice(i,1);
                  break;
               }
            }

            // Set the owning library for the new volume
            volume.owning_lib(destination_id);

            // This decides whether to push the transferred volume
            // to the library list or not.  It only doesn't push
            // if a matching volume is found to inherit it's copies
            var push_volume = true;

            // If the new library's not there, add it
            if (!obj.hashOfVolumes[destination_id]){

               obj.hashOfVolumes[destination_id] = [];
            }

            // If the new library is there, check to see if there are any matching volumes
            else{

               for (var v in obj.hashOfVolumes[destination_id]){

                  var destination_volume = obj.map_acn[ obj.hashOfVolumes[destination_id][v] ];

                  // If transferred volume matches this volume, just transfer the copies
                  if (volume.label() === destination_volume.label()){

                     // just transfer all the copies to the found volume
                     var destination_copies = destination_volume.copies();
                     var copies_to_move = volume.copies();

                     // Update the call number on the moving copies
                     for (var c in copies_to_move){

                        var new_copy = cloneCopy(copies_to_move[c]);
                        new_copy.call_number(destination_volume.id());
                        new_copy.circ_lib(destination_id);
                        copies_to_move[c] = new_copy;
                     }

                     // Transfer those copies in the js
                     libs_to_update = obj.transfer_copies_in_js(copies_to_move, libs_to_update);

                     // and don't push the volume
                     push_volume = false;

                     // Don't forget to empty the old volume of copies
                     // otherwise it won't redraw them
                     obj.map_acn[ old_vol_id].copies([]);

                     break;
                  }
               }
            }

            // just add the volume
            if (push_volume){

               // update copies circ_libs
               for (var c in volume.copies()){

                  volume.copies()[c].circ_lib(destination_id);
                  obj.map_acp[ volume.copies()[c].id() ] = volume.copies()[c];
               }

               obj.hashOfVolumes[destination_id].push(volume.id());
               obj.map_acn[ volume.id() ] = volume;
            }
         }
      }

      return libs_to_update;
   },

   // simply removes a volume from the js
   'remove_volume_from_js' : function(volume, libs_to_update){

      var obj = this;

      if (volume && typeof volume == 'object'){

         if (!libs_to_update){

            libs_to_update = {};
         }

         // Grab the relevant list of volumes
         var listOfVolumeIds = obj.hashOfVolumes[volume.owning_lib()];

         var handled = false;

         // go through all volumes in this library
         for (var v in listOfVolumeIds){

            // If you find it, remove it
            if (listOfVolumeIds[v] == volume.id()){

               obj.hashOfVolumes[volume.owning_lib()].splice(v, 1);
               libs_to_update[obj.get_id(volume.owning_lib())] = true;
               delete obj.map_acn[ volume.id() ];

               break;
            }
         }
      }

      return libs_to_update ? libs_to_update : {};
   },

   // simply replaces a volume in the js
   'replace_volume_in_js' : function(volume, libs_to_update){

      var obj = this;

      if (volume && typeof volume == 'object'){

         if (!libs_to_update){

            libs_to_update = {};
         }

         obj.map_acn[volume.id()] = volume;
         libs_to_update[obj.get_id(volume.owning_lib())] = true;
      }

      return libs_to_update;
   },

   // Takes a hash of keys : true (a list of unique library ids)
   'redraw_orgs' : function(orgs){

      var obj = this;

      for (var org_id in orgs){

         org_id = obj.get_id(org_id);

         // This will update the copy count for both the library
         // and all it's child volumes
         var org = obj.data.hash.aou[ org_id ];

         if (org && org.parent_ou()){

            var parent_org = obj.data.hash.aou[ org.parent_ou() ];

            obj.refresh_org(org, parent_org);

         }
      }

      obj.list.refresh_ordinals();
   },

   'get_new_volumes' : function(ou_list) {
      try {

         var obj = this;

         var acn_tree_list = obj.network.simple_request(
            'FM_ACN_TREE_LIST_RETRIEVE_VIA_RECORD_ID_AND_ORG_IDS.authoritative',
            [ ses(), obj.docid, ou_list ]
         );

         // Fill the copies
         for (var v in acn_tree_list){

            acn_tree_list[v].a[0] = cat.util.request_copies_by_volumes([acn_tree_list[v].id()]);
         }

         return acn_tree_list;

      } catch(E) {
         alert('Error in cat.copy_browser.get_new_volumes: ' + E);
         return null;
      }
   },

   // copy_shortcut includes the library and the volume for the new copes {lib:{someKey:volume_it}}
   'get_new_copies' : function(copy_shortcut) {

      var volume_id;

      // Get the volume_id
      for (var lib in copy_shortcut){
         for (var key in copy_shortcut[lib]){
            volume_id = copy_shortcut[lib][key];
         }
      }

      try {

         var obj = this;

         var copies = cat.util.request_copies_by_volumes([volume_id]);

         return copies;

      } catch(E) {
         alert('Error in cat.copy_browser.get_new_volumes: ' + E);
         return null;
      }
   },

   // This gets the treeitem from the page that matches the type and id
   'getElementByTypeAndId' : function(type, id){

      var treeitems = document.getElementsByTagName("treeitem");

      for (var t in treeitems){

         try{

            if (treeitems[t].getAttribute('retrieve_id')
            && treeitems[t].getAttribute('retrieve_id') === type + "_" + id){

               return treeitems[t];
            }
         }

         catch(e){

            return null;
         }
      }



      return null;
   },

   // Updates copy count.  If no old_copy, it assumes a new copy
   'update_available_copy_count' : function(new_copy, old_copy){

      var obj = this;

      // Don't want the object
      if (typeof new_copy.status() == "object"){

          new_copy.status(new_copy.status().id());
      }

      if (old_copy && typeof old_copy.status() == "object"){

          old_copy.status(old_copy.status().id());
      }

      // decrement if deleted
      if (new_copy.isdeleted()){

         obj.copy_count.count--;

         // if it was availabe before deletion
         if (old_copy && old_copy.status() == AVAILABLE){

            obj.copy_count.available--;
         }
      }

      else{

         // Always decrement if old is available
         if (old_copy && old_copy.status() == AVAILABLE){

            obj.copy_count.available--;
         }

         // Always increment if new is available
         if (new_copy.status() == AVAILABLE){

            obj.copy_count.available++;
         }

         // If copy was just added
         if (!old_copy){

            obj.copy_count.count++;
         }
      }
   },

   'add_copy_to_volume_in_js' : function(volume, copy){

      if (!volume.copies() || volume.copies() == null){

         volume.a[0] = [];
         volume.copies().push(copy);
      }

      else{

         var found = false;

         for (var c in volume.copies()){

            if (volume.copies()[c].id() == copy.id()){

               found = true;
               volume.copies()[c] = copy;
               break;
            }
         }

         if (!found){

            volume.copies().push(copy);
         }
      }

      return volume;
   },

   // Makes sure we have just the id of an object
   // Safe to call on ids
   'get_id' : function( thing ){

      if (typeof thing == 'object' && typeof thing.id == 'function'){

         return thing.id();
      }

      return thing;
   }
}

function cloneVolume(oldVolume){

   var oldCopies = oldVolume.copies();
   var newCopies = [];

   for (var c in oldCopies){

      newCopies.push(cloneCopy(oldCopies[c]));
   }

   var newValueArray = JSON.parse(JSON.stringify(oldVolume.a));
   newValueArray[0] = newCopies;

   return makeVolume(newValueArray);
}

function cloneCopy(oldCopy){

   var newVars = JSON.parse(JSON.stringify(oldCopy.a));
   var newCopy = makeCopy(newVars);

   // New deal with the circs
   var oldCircs = oldCopy.circulations();
   var newCircs = [];

   // Be absolutely sure we have a real circ...
   if (oldCircs != null && oldCircs.length > 0){

      for (var c in oldCircs){

         // ...before we try to clone that circ
         if (oldCircs[c] == "object" && oldCircs[c].a && oldCircs[c].a != null){

            newCircs.push(cloneCirc(oldCircs[c]));
         }
      }

      if (newCircs.length == 0){

         newCopy.var_circulations = null;
      }

      else{

         newCopy.var_circulations = newCircs;
      }
   }

   else{

      newCopy.var_circulations = null;
   }

   newCopy.circulations = function(){

      return newCopy.var_circulations;
   }

   return newCopy;
}


function cloneCirc(oldCirc){

   var newVars = JSON.parse(JSON.stringify(oldCirc.a));

   return makeCirc(newVars)
}

function makeCopy(vars){

    var copy = new acp();

    copy.a = vars;

    return copy;
}

function makeCirc(vars){

    var circTemplate = new Array("checkin_lib", "checkin_staff", "checkin_time", "circ_lib", "circ_staff", "desk_renewal", "due_date", "duration", "duration_rule", "fine_interval", "id", "max_fine", "max_fine_rule", "opac_renewal", "phone_renewal", "recurring_fine", "recurring_fine_rule", "renewal_remaining", "grace_period", "stop_fines", "stop_fines_time", "target_copy", "usr", "xact_finish", "xact_start", "create_time", "workstation", "checkin_workstation", "checkin_scan_time", "parent_circ", "billings, payments", "billable_transaction", "circ_type", "billing_total", "payment_total", "unrecovered", "copy_location");

    return setupTemplate(circTemplate, vars);
}

function makeVolume(vars){

    var volume = new acn();

    volume.a = vars;

    return volume;
}

function setupTemplate(template, vars){

    var keys = JSON.parse(JSON.stringify(template));
    template = {};

    for (var i = 0; i < keys.length; i++){

        // If we have a key
        if (keys[i] != null && i < vars.length){

            template['var_'+keys[i]] = vars[i];

            var myFunction = 'template.'+keys[i]+' = function(){'

            +'return this.var_'+keys[i]+';}';

            eval(myFunction);

        }
    }

    return template;
}

dump('exiting cat.copy_browser.js\n');
