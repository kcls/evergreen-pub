import {Component, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {GAC_STEPS, GacStep, GetacardState} from './state.service';

/**
 * Wizard shell: slim progress bar + step title up top, one centered content
 * card, one Back/Continue footer.  Each step is its own component; this
 * component owns navigation only.
 */
@Component({
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss']
})
export class GetacardShellComponent implements OnInit {

    steps = GAC_STEPS;
    index = 0;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        public state: GetacardState,
    ) {}

    ngOnInit() {
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
        });
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
}
