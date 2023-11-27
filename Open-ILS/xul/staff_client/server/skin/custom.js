_dump_level = 4;
//urls['opac'] = '/eg/opac/advanced';
//urls['opac_rdetail'] = '/eg/opac/record/';
//urls['opac_rresult'] = '/eg/opac/results';
//urls['opac_rresult_metarecord'] = '/eg/opac/results?metarecord=';
//urls['browser'] = urls.opac;
urls['AUDIO_special_checkin.error'] = '/xul/server/skin/media/audio/custom/error.wav';
urls['AUDIO_special_checkin.hold_shelf'] = '/xul/server/skin/media/audio/custom/hold.wav';
urls['AUDIO_special_checkin.no_change'] = '/xul/server/skin/media/audio/custom/note1.wav';
urls['AUDIO_special_checkin.success'] = '/xul/server/skin/media/audio/custom/note2.wav';
urls['AUDIO_special_checkin.transit'] = '/xul/server/skin/media/audio/custom/transit.wav';
urls['AUDIO_special_checkin.transit_for_hold'] = '/xul/server/skin/media/audio/custom/hold_transit.wav';
urls['AUDIO_event_ASSET_COPY_NOT_FOUND'] = '/xul/server/skin/media/audio/custom/error.wav';
urls['AUDIO_horrible'] = '/xul/server/skin/media/audio/custom/error.wav';
urls['AUDIO_event_ACTOR_USER_NOT_FOUND'] = '/xul/server/skin/media/audio/custom/error.wav';
if (location.href.match('checkin')){
urls['AUDIO_circ_good'] = '';
} else {
urls['AUDIO_circ_good'] = '/xul/server/skin/media/audio/custom/note2.wav';
}
if (location.href.match('checkin')){
urls['AUDIO_circ_bad'] = '';
} else {
urls['AUDIO_circ_bad'] = '/xul/server/skin/media/audio/question.wav';
} 




//urls['opac'] = '/opac/' + LOCALE + '/skin/kcls/xml/advanced.xml?nps=1';
//urls['opac_rdetail'] = '/opac/' + LOCALE + '/skin/kcls/xml/rdetail.xml?r=';
//urls['opac_rresult'] = '/opac/' + LOCALE + '/skin/kcls/xml/rresult.xml';
//urls['opac_rresult_metarecord'] = '/opac/' + LOCALE + '/skin/kcls/xml/rresult.xml?m=';
//urls['browser'] = '/opac/' + LOCALE + '/skin/kcls/xml/advanced.xml?nps=1';

//////////////////////////////////////////////////////////////////////////
// Overriding default receipt templates

try {
    // In practice, this should be true in menu.js/opac.js, but not util_overlay.xul
    if (typeof JSAN != 'undefined' && typeof JSON2js != 'undefined' && typeof xulG != 'undefined') {
        var r = new XMLHttpRequest();
        r.open("GET", xulG.url_prefix('/xul/server/skin/print_list_templates'), false);
        r.send(null);
        if (r.status == 200) {
            JSAN.use('OpenILS.data');
            var custom_data = new OpenILS.data(); custom_data.stash_retrieve();
            var custom_templates = JSON2js( r.responseText );
            for (var i in custom_templates) {
                custom_data.print_list_templates[i] = custom_templates[i];
            }
            custom_data.stash('print_list_templates');
            dump('Overriding receipt templates via custom.js\n');
        }
    }
} catch(E) {
    dump('Error overriding receipt templates in custom.js: ' + E + '\n');
}
