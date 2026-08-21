import {Injectable} from '@angular/core';

const KIOSK_STORE_KEY = 'kcls.kiosk';
const RETURN_STORE_KEY = 'kcls.kiosk.return';
const KIOSK_BODY_CLASS = 'kiosk-mode';

// Where sessions are sent when they end (e.g. idle timeout) absent a
// selected return destination.
const DEFAULT_RETURN_URL = 'https://kcls.org';

// Named return destinations, selected via the ?return-to=<name> entry
// param.  Only these names are honored -- the URL never carries a raw
// destination, so we can't be steered to an arbitrary site.
const RETURN_URLS: {[name: string]: string} = {
    'fullservice': 'https://w3.kcls.org/evergreen/fullservice.html',
};

/**
 * App-wide kiosk mode.
 *
 * Kiosk mode arrives as a ?kiosk=<truthy> query param on the entry URL and
 * sticks for the rest of the browser session (internal navigation drops the
 * param, and full page reloads must remain in kiosk mode).  Activating adds
 * a marker class to <body> so global styles can hide chrome that doesn't
 * belong on a kiosk -- notably the externally generated BiblioCommons
 * header/footer baked into the production index.html.
 *
 * Kiosk landing pages may also pass ?return-to=<name> (e.g.
 * return-to=fullservice) naming the page to send the patron back to when
 * their session ends; it sticks for the session like kiosk mode.
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

        const returnTo = params.get('return-to');
        if (returnTo && RETURN_URLS[returnTo]) {
            window.sessionStorage.setItem(RETURN_STORE_KEY, returnTo);
        }
    }

    activate() {
        this.active = true;
        window.sessionStorage.setItem(KIOSK_STORE_KEY, '1');
        document.body.classList.add(KIOSK_BODY_CLASS);
    }

    /** Where to send the patron when their session ends. */
    get returnUrl(): string {
        const name = window.sessionStorage.getItem(RETURN_STORE_KEY) || '';
        return RETURN_URLS[name] || DEFAULT_RETURN_URL;
    }
}
