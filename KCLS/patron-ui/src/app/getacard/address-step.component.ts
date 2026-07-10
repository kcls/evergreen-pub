import {Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {FormControl} from '@angular/forms';
import {of} from 'rxjs';
import {catchError, debounceTime, distinctUntilChanged, map,
    startWith, switchMap} from 'rxjs/operators';
import {AddressSuggestion, GetacardState} from './state.service';

/**
 * "Where do you live?" — the address search / confirm experience.
 *
 * Search mode shows a single input with a suggestion dropdown; selecting a
 * suggestion collapses to a confirmed address card (with an Edit link) and,
 * for multi-unit buildings, a required unit field that re-verifies on entry.
 * Transient search state lives here; the selection and everything resolved
 * from it (home library, district, eligibility) lives in GetacardState.
 */
@Component({
  selector: 'gac-address-step',
  templateUrl: './address-step.component.html',
  styleUrls: ['./address-step.component.scss']
})
export class AddressStepComponent implements OnInit {

    @ViewChild('unitInput') unitInput?: ElementRef<HTMLInputElement>;

    street1 = new FormControl('');
    street2 = new FormControl('');

    suggestions: AddressSuggestion[] = [];
    loading = false;
    notFound = false;

    constructor(public state: GetacardState) {}

    ngOnInit() {
        // Returning to this step with an address already chosen: restore the
        // unit control from the shared state.
        if (this.state.addressSelected) {
            this.street2.setValue(this.state.street2, {emitEvent: false});
        }

        // Debounced address search while in search mode.
        this.street1.valueChanges.pipe(
            startWith(''),
            debounceTime(300),
            map(() => this.searchTerm()),
            distinctUntilChanged(),
            switchMap(term => {
                this.suggestions = [];
                this.notFound = false;

                if (this.state.addressSelected || term.length < 5) {
                    this.loading = false;
                    return of([] as AddressSuggestion[]);
                }

                this.loading = true;
                return this.state.autocomplete(term).pipe(
                    catchError(() => of([] as AddressSuggestion[]))
                );
            }),
        ).subscribe(list => {
            this.loading = false;
            this.suggestions = list;
            this.notFound = !this.state.addressSelected
                && list.length === 0
                && this.searchTerm().length >= 5;
        });

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

    searchTerm(): string {
        return ('' + (this.street1.value ?? '')).trim();
    }

    select(addr: AddressSuggestion) {
        this.suggestions = [];
        this.notFound = false;

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
        this.street1.setValue(line, {emitEvent: false});
        this.street2.setValue('', {emitEvent: false});
        this.suggestions = [];
        this.notFound = false;
    }

    showUnitField(): boolean {
        return this.state.unitRequired || !!this.street2.value;
    }
}
