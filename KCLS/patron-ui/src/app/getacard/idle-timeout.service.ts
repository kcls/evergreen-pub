import {Injectable, NgZone, OnDestroy} from '@angular/core';
import {GetacardState} from './state.service';
import {KioskService} from '../kiosk.service';

// Idle timeout durations (ms).  Local defaults for now; kiosks time out
// much sooner since walk-away sessions expose the previous patron's data.
export const IDLE_TIMEOUTS = {
    // The registration form steps.
    form: {
        kiosk: 120 * 1000,
        web: 300 * 1000,
    },
    // The post-submit confirmation page.
    complete: {
        kiosk: 30 * 1000,
        web: 30 * 1000,
    },
};

/**
 * Redirects to kcls.org after a period of user inactivity.
 *
 * Activity is any key press, pointer press, touch, or input anywhere on the
 * page (captured at the document level), so typing into form fields, picking
 * suggestions, toggling checkboxes, etc. all reset the clock.  Listeners and
 * the timer run outside the Angular zone so activity tracking doesn't
 * trigger change detection.
 */
@Injectable()
export class GacIdleTimeoutService implements OnDestroy {

    private durationMs = 0;
    private timeoutId: number | null = null;
    private listening = false;
    private expired = false;

    private readonly events = ['keydown', 'mousedown', 'touchstart', 'input'];
    private readonly onActivity = () => this.restart();

    // Pressing Back after the timeout redirect can restore this page from
    // the browser's back/forward cache with the JS heap -- including all
    // form state -- intact, bypassing the router.  When that happens after
    // an expiry, force a reload: the app boots fresh (state cleared) and
    // the shell's address guard lands the user on an empty first step.
    private readonly onPageShow = (event: PageTransitionEvent) => {
        if (event.persisted && this.expired) {
            window.location.reload();
        }
    };

    constructor(
        private zone: NgZone,
        private state: GetacardState,
        private kiosk: KioskService,
    ) {
        this.zone.runOutsideAngular(() =>
            window.addEventListener('pageshow', this.onPageShow));
    }

    /** Begin (or re-begin) watching with the provided idle duration. */
    watch(durationMs: number) {
        this.durationMs = durationMs;

        if (!this.listening) {
            this.listening = true;
            this.zone.runOutsideAngular(() => {
                this.events.forEach(name =>
                    document.addEventListener(name, this.onActivity, true));
            });
        }

        this.restart();
    }

    /** Stop watching; no redirect will occur until watch() is called again. */
    stop() {
        this.clearTimer();

        if (this.listening) {
            this.listening = false;
            this.events.forEach(name =>
                document.removeEventListener(name, this.onActivity, true));
        }
    }

    ngOnDestroy() {
        this.stop();
        window.removeEventListener('pageshow', this.onPageShow);
    }

    private restart() {
        this.clearTimer();
        this.zone.runOutsideAngular(() => {
            this.timeoutId = window.setTimeout(() => this.expire(), this.durationMs);
        });
    }

    private clearTimer() {
        if (this.timeoutId != null) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    private expire() {
        this.stop();
        this.expired = true;

        // Clear the abandoned session's data before leaving so nothing
        // lingers even if the reload-on-restore path doesn't run.
        this.state.resetForm();

        // kcls.org by default; kiosk landing pages may select a named
        // return destination via ?return-to.
        window.location.href = this.kiosk.returnUrl;
    }
}
