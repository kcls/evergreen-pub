import {Component} from '@angular/core';
import {Router} from '@angular/router';
import {AbstractControl} from '@angular/forms';
import {GetacardState} from './state.service';

/**
 * "Review & submit" — a per-step summary with Edit links, the stay-in-touch
 * opt-ins, and the terms of service.  The shell's footer performs the
 * actual submit (its Continue button becomes Submit on this step).
 */
@Component({
  selector: 'gac-review-step',
  templateUrl: './review-step.component.html',
  styleUrls: ['./review-step.component.scss']
})
export class ReviewStepComponent {

    constructor(private router: Router, public state: GetacardState) {}

    about(name: string): AbstractControl {
        return this.state.aboutForm.get(name)!;
    }

    contact(name: string): AbstractControl {
        return this.state.contactForm.get(name)!;
    }

    edit(slug: string) {
        this.router.navigate(['/getacard', slug]);
    }

    pickupLibName(): string {
        const id = this.contact('pickupLib').value;
        return this.state.pickupLibs.find(
            l => l['id'] === id)?.['name'] as string ?? '';
    }
}
