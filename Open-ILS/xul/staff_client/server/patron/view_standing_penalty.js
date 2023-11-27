var data; var error; 

function default_focus() { document.getElementById('note_tb').focus(); } // parent interfaces often call this

function view_penalty_init() {
    try {

        commonStrings = document.getElementById('commonStrings');
        patronStrings = document.getElementById('patronStrings');

        if (typeof JSAN == 'undefined') {
            throw(
                commonStrings.getString('common.jsan.missing')
            );
        }

        JSAN.errorLevel = "die"; // none, warn, or die
        JSAN.addRepository('..');

        JSAN.use('OpenILS.data'); data = new OpenILS.data(); data.stash_retrieve();

        JSAN.use('util.error'); error = new util.error();
        JSAN.use('util.widgets');

        /* set widget values */
        document.getElementById('note_tb').value = xul_param('note');

        /* set widget behavior */
        window.view_standing_penalty_event_listeners = new EventListenerList();


        window.view_standing_penalty_event_listeners.add(document.getElementById('close_btn'), 
            'command', function() { window.close(); }, false
        );
        
    } catch(E) {
        var err_prefix = 'standing_penalties.js -> penalty_init() : ';
        if (error) error.standard_unexpected_error_alert(err_prefix,E); else alert(err_prefix + E);
    }

}

function view_penalty_cleanup() {
    try {
        window.view_standing_penalty_event_listeners.removeAll();
    } catch(E) {
        var err_prefix = 'standing_penalties.js -> penalty_cleanup() : ';
        if (error) error.standard_unexpected_error_alert(err_prefix,E); else alert(err_prefix + E);
    }

}