import {Injectable, NgZone, OnDestroy} from '@angular/core';

// Where inactive sessions are sent.
const REDIRECT_URL = 'https://kcls.org';

// Idle timeout durations (ms).  Local defaults for now; kiosks time out
// much sooner since walk-away sessions expose the previous patron's data.
export const IDLE_TIMEOUTS = {
    // The registration form steps.
    form: {
        kiosk: 3 * 60 * 1000,
        web: 20 * 60 * 1000,
    },
    // The post-submit confirmation page.
    complete: {
        kiosk: 60 * 1000,
        web: 10 * 60 * 1000,
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

    private readonly events = ['keydown', 'mousedown', 'touchstart', 'input'];
    private readonly onActivity = () => this.restart();

    constructor(private zone: NgZone) {}

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
        window.location.href = REDIRECT_URL;
    }
}
