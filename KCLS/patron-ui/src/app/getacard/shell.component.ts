import {Component, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {GacStep, GetacardState} from './state.service';
import {GacIdleTimeoutService, IDLE_TIMEOUTS} from './idle-timeout.service';
import {KioskService} from '../kiosk.service';

/**
 * Wizard shell: slim progress bar + step title up top, one centered content
 * card, one Back/Continue footer.  Each step is its own component; this
 * component owns navigation only.
 */
@Component({
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss']
})
export class GetacardShellComponent implements OnInit, OnDestroy {

    index = 0;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private idle: GacIdleTimeoutService,
        private kiosk: KioskService,
        public state: GetacardState,
    ) {}

    // The step list is dynamic: e-card holders skip the physical-card step.
    get steps(): GacStep[] {
        return this.state.steps;
    }

    ngOnInit() {
        // Kiosk mode (?kiosk=1) times out much sooner than the open web.
        // Abandoned sessions redirect away so the next patron doesn't see
        // (or extend) the previous one's data.
        this.route.queryParams.subscribe(params => {
            if (params['kiosk']) { this.kiosk.activate(); }
            this.idle.watch(this.state.inKioskMode
                ? IDLE_TIMEOUTS.form.kiosk : IDLE_TIMEOUTS.form.web);
        });

        // URL -> step, so deep links and browser back/forward work.
        this.route.paramMap.subscribe(params => {
            const slug = params.get('step') || 'address';
            const index = this.steps.findIndex(s => s.slug === slug);

            if (index < 0) {
                this.router.navigate(['/getacard', 'address'], {replaceUrl: true});
                return;
            }

            // Everything downstream depends on a resolved address.
            if (index > 0 && !this.state.addressComplete) {
                this.router.navigate(['/getacard', 'address'], {replaceUrl: true});
                return;
            }

            this.index = index;

            // Arriving from a vertically tall step can leave the viewport
            // scrolled well past the new step's content; snap back to the top.
            window.scrollTo(0, 0);
        });
    }

    ngOnDestroy() {
        // The completion page starts its own watch with its own duration.
        this.idle.stop();
    }

    get current(): GacStep {
        return this.steps[this.index];
    }

    get isLast(): boolean {
        return this.index === this.steps.length - 1;
    }

    get progressPct(): number {
        return ((this.index + 1) / this.steps.length) * 100;
    }

    canContinue(): boolean {
        return this.state.stepComplete(this.current.slug);
    }

    back() {
        if (this.index > 0) {
            this.router.navigate(['/getacard', this.steps[this.index - 1].slug]);
        }
    }

    next() {
        if (!this.isLast && this.canContinue()) {
            this.router.navigate(['/getacard', this.steps[this.index + 1].slug]);
        }
    }

    // Post the registration and land on the confirmation page (which also
    // reports failure).
    submit() {
        if (!this.canContinue()) { return; }
        this.state.submit().then(() =>
            this.router.navigate(['/getacard', 'complete']));
    }
}
