dojo.require("dojo.cookie");
dojo.require("dojox.xml.parser");
dojo.require("openils.widget.ProgressDialog");

var authtoken;
var cgi;

// extract the title and author from a MARCXML string.
function get_marc_bits(marcxml) {
    var m100a = '';
    var m100c = '';
    var m245a = '';
    var m245b = '';
    var m245p = '';
    var m245n = '';
    var xmlDoc = new DOMParser().parseFromString(marcxml, 'text/xml');

    dojo.forEach(
        xmlDoc.documentElement.getElementsByTagName('datafield'), 
        function(node) {
            var tag = node.getAttribute('tag');
            if (tag == '100') {
                dojo.forEach(node.childNodes, function(sub_node) {
                    if (sub_node.nodeType == Node.ELEMENT_NODE) {
                        var code = sub_node.getAttribute('code');
                        if (code == 'a') m100a = sub_node.textContent;
                        if (code == 'c') m100c = sub_node.textContent;
                    }
                });
            } else if (tag == '245') {
                dojo.forEach(node.childNodes, function(sub_node) {
                    if (sub_node.nodeType == Node.ELEMENT_NODE) {
                        var code = sub_node.getAttribute('code');
                        if (code == 'a') m245a = sub_node.textContent;
                        if (code == 'b') m245b = sub_node.textContent;
                        if (code == 'p') m245p = sub_node.textContent;
                        if (code == 'n') m245n = sub_node.textContent;
                    }
                });
            }
        }
    );

    return {
        author : m100a + ' ' + m100c,
        title : m245a + ' ' + m245b + ' ' + m245n + ' ' + m245p
    };
}


function do_pull_list() {
    progress_dialog.show(true);

    var any = false;

    fieldmapper.standardRequest(
        ['open-ils.circ','open-ils.circ.hold_pull_list.print.stream'],
        { async : true,
          params: [
            authtoken, {
              org_id     : cgi.param('o'),
              limit      : cgi.param('limit'),
              offset     : cgi.param('offset'),
              chunk_size : cgi.param('chunk_size'),
              sort       : sort_order
            }
          ],
          onresponse : function (r) {
            any = true;
            dojo.forEach( openils.Util.readResponse(r), function (hold_fm) {

                // hashify the hold
                var hold = hold_fm.toHash(true);
                hold.usr = hold_fm.usr().toHash(true);
                hold.usr.card = hold_fm.usr().card().toHash(true);
                hold.current_copy = hold_fm.current_copy().toHash(true);
                hold.current_copy.location = hold_fm.current_copy().location().toHash(true);
                hold.current_copy.call_number = hold_fm.current_copy().call_number().toHash(true);
                hold.current_copy.call_number.record = hold_fm.current_copy().call_number().record().toHash(true);
                hold.current_copy.call_number.prefix = hold_fm.current_copy().call_number().prefix().toHash(true);
                hold.current_copy.call_number.suffix = hold_fm.current_copy().call_number().suffix().toHash(true);
                hold.current_copy.parts_stringified = '';
                dojo.forEach( hold_fm.current_copy().parts(), function(part) {
                    hold.current_copy.parts_stringified += ' ' + part.label();
                });

                var bits = get_marc_bits(
                    hold.current_copy.call_number.record.marc);

                hold.title = bits.title;
                hold.author = bits.author;


                // clone the template's html
                var tr = dojo.clone(
                    dojo.query("tr", dojo.byId('template'))[0]
                );
                dojo.query("td:not([type])", tr).forEach(
                    function(td) {
                        td.innerHTML =
                            dojo.string.substitute(td.innerHTML, hold);
                    }
                );

                dojo.place(tr, "target");
            });
          },
          oncomplete : function () {
            progress_dialog.hide();
            setTimeout(
                function() {
                    if (any) window.print();
                    else alert(dojo.byId("no_results").innerHTML);
                }, 500  /* give the progress_dialog more time to go away */
            );
          }
        }
    );
}

function place_by_sortkey(node, container) {
    /*Don't use a forEach() or anything like that here. too slow.*/
    var sortkey = dojo.attr(node, "sortkey");
    for (var i = 0; i < container.childNodes.length; i++) {
        var rover = container.childNodes[i];
        if (rover.nodeType != 1) continue;
        if (dojo.attr(rover, "sortkey") > sortkey) {
            dojo.place(node, rover, "before");
            return;
        }
    }
    dojo.place(node, container, "last");
}

function hashify_fields(fields) {
    var hold  = {
        "usr": {},
        "current_copy": {
            "barcode": fields.barcode,
            "call_number": {
                "label": fields.label,
                "record": {"marc": fields.marc}
            },
            "location": {"name": fields.name}
        }
    };

    if (fields.alias) {
        hold.usr.display_name = fields.alias;
    } else {
        hold.usr.display_name = [
            (fields.family_name ? fields.family_name : ""),
            (fields.first_given_name ? fields.first_given_name : ""),
            (fields.second_given_name ? fields.second_given_name : "")
        ].join(" ");
    }

    ["first_given_name","second_given_name","family_name","alias"].forEach(
        function(k) { hold.usr[k] = fields[k]; }
    );

    hold.current_copy.call_number.prefix = fields.prefix;
    hold.current_copy.call_number.suffix = fields.suffix;
    hold.current_copy.parts_stringified = '';   /* no real support for parts here */
    return hold;
}

function do_clear_holds() {
    progress_dialog.show(true);

    fieldmapper.standardRequest(
        ["open-ils.circ", "open-ils.circ.hold.clear_shelf.process.fire"], {
            "async": true,
            "params": [authtoken, cgi.param("o")],
            "onresponse": function(r) {
                if (r = openils.Util.readResponse(r)) {
                    launch_cache_poll(r.cache_key);
                }
            }
        }
    );
}

// Poll for the existence of cached clear-shelf data.
// Once found, kick off the print process.
function launch_cache_poll(cache_key) {

    var poll_timeout;
    var poll_interval = 10000; // poll every 10 seconds
    var poll_count = 0;

    function poll_cache() {

        if (poll_count++ > 180) return; // poll 30 minutes max

        console.log("Clear shelf polling cache with key " + cache_key);

        fieldmapper.standardRequest(
            [   "open-ils.circ",
                "open-ils.circ.hold.clear_shelf.get_cache.test"], {
                async: true,
                params: [authtoken, cache_key, cgi.param("chunk_size")],
                oncomplete: function(r) {
                    if (openils.Util.readResponse(r) == 1) {
                        // found cached data.
                        // kill the progress dialog and kick off
                        // the from-cache printer
                        console.log("Clear shelf poll found data");
                        progress_dialog.hide();

                        // wire up the re-print link
                        var launcher = dojo.byId("clear_holds_launcher");
                        launcher.innerHTML = "Re-fetch for Printing"; /* XXX i18n */
                        launcher.disabled = true;
                        launcher.onclick =
                            function() { do_clear_holds_from_cache(cache_key); };
                        dojo.byId("clear_holds_set_label").innerHTML = cache_key;

                        do_clear_holds_from_cache(cache_key);
                    } else {
                        // kick off another poll 'thread'
                        console.log("Clear shelf poll found no data");
                        setTimeout(poll_cache, poll_interval);
                    }
                }
            }
        );
    }

    // start the initial poll 'thread'
    // give it a shorter wait time in case the initial calls ends quickly
    setTimeout(poll_cache, poll_interval / 2);
}

function do_clear_holds_from_cache(cache_key) {
    progress_dialog.show(true);

    var any = 0;
    var target = dojo.byId("target");
    dojo.empty(target);
    var template = dojo.query("tr", dojo.byId("template"))[0];
    fieldmapper.standardRequest(
        ["open-ils.circ",
            "open-ils.circ.hold.clear_shelf.get_cache"], {
            "async": true,
            "params": [authtoken, cache_key, cgi.param("chunk_size")],
            "onresponse": function(r) {
                dojo.forEach(
                    openils.Util.readResponse(r),
                    function(resp) {
                        if (resp.maximum) {
                            progress_dialog.update(resp);
                            return;
                        }

                        var hold = hashify_fields(resp.hold_details);
                        hold.action = resp.action;

                        var bits = get_marc_bits(
                            hold.current_copy.call_number.record.marc);

                        hold.title = bits.title;
                        hold.author = bits.author;

                        if(resp.hold_details.hold_type) {
                            hold.hold_type = resp.hold_details.hold_type;
                        } else {
                            hold.hold_type = "";
                        }

                        var tr = dojo.clone(template);
                        any++;

                        dojo.query("td:not([type])", tr).forEach(
                            function(td) {
                                td.innerHTML =
                                    dojo.string.substitute(td.innerHTML, hold);
                            }
                        );

                        dojo.attr(tr, "sortkey", hold.usr.display_name);
                        place_by_sortkey(tr, target);
                    }
                );
                progress_dialog.update({"progress": any});
            },
            "oncomplete": function() {
                progress_dialog.hide();
                setTimeout(
                    function() {
                        if (any) window.print();
                        else alert(dojo.byId("no_results").innerHTML);
                    }, 2000  /* give the progress_dialog more time to go away */
                );
            }
        }
    );
}

