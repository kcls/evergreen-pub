import {Component, ElementRef, ViewChild} from '@angular/core';
import {AbstractControl} from '@angular/forms';
import {AddressSearchComponent} from './address-search.component';
import {AddressSuggestion, GetacardState} from './state.service';

/**
 * "Stay in touch" — email/phone/SMS, notice preferences, the hold pickup
 * library, and the mailing address (when it differs from residential,
 * using the same search + confirmed-card treatment).  The form and the
 * requiredness rules (e.g. e-cards require an email) live in GetacardState.
 */
@Component({
  selector: 'gac-contact-step',
  templateUrl: './contact-step.component.html',
  styleUrls: ['./contact-step.component.scss']
})
export class ContactStepComponent {

    @ViewChild('mailSearch') mailSearch?: AddressSearchComponent;
    @ViewChild('mailUnitInput') mailUnitInput?: ElementRef<HTMLInputElement>;

    constructor(public state: GetacardState) {}

    ctrl(name: string): AbstractControl {
        return this.state.contactForm.get(name)!;
    }

    pickMailing(addr: AddressSuggestion) {
        this.state.selectMailing(addr).then(normalized => {
            if (normalized) {
                this.ctrl('mailingStreet2').setValue(normalized, {emitEvent: false});
            }
        });

        // A required unit needs entry; focus the field once it renders.
        if (this.state.mailingUnitRequired) {
            setTimeout(() => this.mailUnitInput?.nativeElement.focus());
        }
    }

    showMailingUnitField(): boolean {
        return this.state.mailingUnitRequired || !!this.ctrl('mailingStreet2').value;
    }

    // Drop the mailing selection and return to search mode, seeded with the
    // previously chosen street line.
    editMailing() {
        const line = this.state.mailingAddress?.street_line || '';
        this.state.clearMailing();
        setTimeout(() => this.mailSearch?.seed(line));
    }
}
