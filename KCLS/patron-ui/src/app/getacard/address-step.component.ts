import {Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {AbstractControl, FormControl} from '@angular/forms';
import {debounceTime, distinctUntilChanged} from 'rxjs/operators';
import {AddressSearchComponent} from './address-search.component';
import {AddressSuggestion, GetacardState} from './state.service';

/**
 * "Where do you live?" — the residential address search / confirm
 * experience.  Search mode uses the shared gac-address-search; selecting a
 * suggestion collapses to a confirmed address card (with an Edit link)
 * and, for multi-unit buildings, a required unit field that re-verifies on
 * entry.  The selection and everything resolved from it (home library,
 * district, eligibility) lives in GetacardState.
 */
@Component({
  selector: 'gac-address-step',
  templateUrl: './address-step.component.html',
  styleUrls: ['./address-step.component.scss']
})
export class AddressStepComponent implements OnInit {

    @ViewChild('search') searchComp?: AddressSearchComponent;
    @ViewChild('unitInput') unitInput?: ElementRef<HTMLInputElement>;

    @ViewChild('mailSearch') mailSearch?: AddressSearchComponent;
    @ViewChild('mailUnitInput') mailUnitInput?: ElementRef<HTMLInputElement>;

    street2 = new FormControl('');

    constructor(public state: GetacardState) {}

    ngOnInit() {
        // Returning to this step with an address already chosen: restore the
        // unit control from the shared state.
        if (this.state.addressSelected) {
            this.street2.setValue(this.state.street2, {emitEvent: false});
        }

        // Entering / editing the unit re-verifies the address.  Programmatic
        // writes use emitEvent:false so they don't re-trigger this.
        this.street2.valueChanges.pipe(
            debounceTime(400),
            distinctUntilChanged(),
        ).subscribe(() => {
            if (!this.state.addressSelected) { return; }
            const unit = ('' + (this.street2.value ?? '')).trim();
            this.state.confirmUnit(unit).then(normalized => {
                if (normalized) {
                    this.street2.setValue(normalized, {emitEvent: false});
                }
            });
        });
    }

    select(addr: AddressSuggestion) {
        this.state.selectAddress(addr).then(normalized => {
            if (normalized) {
                this.street2.setValue(normalized, {emitEvent: false});
            }
        });

        this.street2.setValue(this.state.street2, {emitEvent: false});

        // A required unit needs entry; focus the field once it renders.
        if (this.state.unitRequired) {
            setTimeout(() => this.unitInput?.nativeElement.focus());
        }
    }

    // Drop the selection and return to search mode, seeded with the
    // previously chosen street line.
    edit() {
        const line = this.state.address?.street_line || '';
        this.state.clearSelection();
        this.street2.setValue('', {emitEvent: false});
        // The search component renders on the next change-detection pass.
        setTimeout(() => this.searchComp?.seed(line));
    }

    showUnitField(): boolean {
        return this.state.unitRequired || !!this.street2.value;
    }

    // --- mailing address (shown once the residential address resolves) ------

    mailCtrl(name: string): AbstractControl {
        return this.state.contactForm.get(name)!;
    }

    pickMailing(addr: AddressSuggestion) {
        this.state.selectMailing(addr).then(normalized => {
            if (normalized) {
                this.mailCtrl('mailingStreet2').setValue(normalized, {emitEvent: false});
            }
        });

        // A required unit needs entry; focus the field once it renders.
        if (this.state.mailingUnitRequired) {
            setTimeout(() => this.mailUnitInput?.nativeElement.focus());
        }
    }

    // Drop the mailing selection and return to search mode, seeded with the
    // previously chosen street line.
    editMailing() {
        const line = this.state.mailingAddress?.street_line || '';
        this.state.clearMailing();
        setTimeout(() => this.mailSearch?.seed(line));
    }

    showMailingUnitField(): boolean {
        return this.state.mailingUnitRequired
            || !!this.mailCtrl('mailingStreet2').value;
    }
}
