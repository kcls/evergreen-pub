import {AfterViewInit, Component, ElementRef, ViewChild} from '@angular/core';
import {AbstractControl} from '@angular/forms';
import {GetacardState} from './state.service';

/**
 * "Stay in touch" — email/phone/SMS, notice preferences, and the hold
 * pickup library.  The form and the requiredness rules (e.g. e-cards
 * require an email) live in GetacardState.  The mailing address is
 * collected alongside the residential address on the first step.
 */
@Component({
  selector: 'gac-contact-step',
  templateUrl: './contact-step.component.html',
  styleUrls: ['./contact-step.component.scss']
})
export class ContactStepComponent implements AfterViewInit {

    @ViewChild('emailInput') emailInput?: ElementRef<HTMLInputElement>;

    constructor(public state: GetacardState) {}

    ngAfterViewInit() {
        setTimeout(() => this.emailInput?.nativeElement.focus());
    }

    ctrl(name: string): AbstractControl {
        return this.state.contactForm.get(name)!;
    }

    // Flip a notice opt-in tile; setValue fires the form's valueChanges
    // subscriptions (contact requiredness rules) as a checkbox would.
    toggleNotice(name: string) {
        const c = this.ctrl(name);
        c.setValue(!c.value);
    }
}
