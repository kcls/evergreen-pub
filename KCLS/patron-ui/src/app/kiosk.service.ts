import {Injectable} from '@angular/core';

const KIOSK_STORE_KEY = 'kcls.kiosk';
const KIOSK_BODY_CLASS = 'kiosk-mode';

/**
 * App-wide kiosk mode.
 *
 * Kiosk mode arrives as a ?kiosk=<truthy> query param on the entry URL and
 * sticks for the rest of the browser session (internal navigation drops the
 * param, and full page reloads must remain in kiosk mode).  Activating adds
 * a marker class to <body> so global styles can hide chrome that doesn't
 * belong on a kiosk -- notably the externally generated BiblioCommons
 * header/footer baked into the production index.html.
 */
@Injectable({providedIn: 'root'})
export class KioskService {

    active = false;

    constructor() {
        const params = new URLSearchParams(window.location.search);

        if (params.get('kiosk')
            || window.sessionStorage.getItem(KIOSK_STORE_KEY)) {
            this.activate();
        }
    }

    activate() {
        this.active = true;
        window.sessionStorage.setItem(KIOSK_STORE_KEY, '1');
        document.body.classList.add(KIOSK_BODY_CLASS);
    }
}
