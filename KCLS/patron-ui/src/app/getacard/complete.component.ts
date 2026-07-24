import {Component, OnDestroy, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {Title} from '@angular/platform-browser';
import {GetacardState} from './state.service';
import {GacIdleTimeoutService, IDLE_TIMEOUTS} from './idle-timeout.service';

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
        public state: GetacardState,
    ) {}

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
