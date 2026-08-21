import {Component, OnDestroy, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {Title} from '@angular/platform-browser';
import {GetacardState} from './state.service';
import {GacIdleTimeoutService, IDLE_TIMEOUTS} from './idle-timeout.service';
import {KioskService} from '../kiosk.service';

/** Post-submit confirmation (or failure) page. */
@Component({
  templateUrl: './complete.component.html',
  styleUrls: ['./complete.component.scss']
})
export class GetacardCompleteComponent implements OnInit, OnDestroy {

    constructor(
        private router: Router,
        private title: Title,
        private idle: GacIdleTimeoutService,
        private kiosk: KioskService,
        public state: GetacardState,
    ) {}

    // Return to the session's starting point (a kiosk landing page's named
    // return destination, or kcls.org) -- the same place the idle timeout
    // would eventually redirect to.
    done() {
        window.location.href = this.kiosk.returnUrl;
    }

    ngOnInit() {
        this.title.setTitle($localize`Registration Complete`);

        if (!this.state.registerResult.complete) {
            this.router.navigate(['/getacard']);
        }

        // A successful registration is finished: clear the flow so browser
        // Back lands on a pristine first step rather than the submitted
        // values.  Failures keep their values so the patron can retry.
        if (this.state.registerResult.success) {
            this.state.resetForm();
        }

        // The confirmation page gets its own (shorter) idle window before
        // redirecting away.
        this.idle.watch(this.state.inKioskMode
            ? IDLE_TIMEOUTS.complete.kiosk : IDLE_TIMEOUTS.complete.web);
    }

    ngOnDestroy() {
        this.idle.stop();
    }
}
