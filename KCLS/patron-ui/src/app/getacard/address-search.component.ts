import {Component, EventEmitter, Input, OnInit, Output} from '@angular/core';
import {FormControl} from '@angular/forms';
import {of} from 'rxjs';
import {catchError, debounceTime, distinctUntilChanged, map,
    startWith, switchMap} from 'rxjs/operators';
import {AddressSuggestion, GetacardState} from './state.service';

/**
 * Reusable address search: a single input with a debounced suggestion
 * dropdown.  Emits the chosen suggestion; the host component owns what
 * "selected" means (confirmation card, verification, etc.) and typically
 * hides this component once a choice is made.
 */
@Component({
  selector: 'gac-address-search',
  templateUrl: './address-search.component.html',
  styleUrls: ['./address-search.component.scss']
})
export class AddressSearchComponent implements OnInit {

    @Input() label = $localize`Address`;
    @Input() placeholder = $localize`Start typing an address, e.g. 123 Main...`;

    // Residential searches exclude address types that can't be a residence.
    @Input() kind: 'residential' | 'mailing' = 'residential';

    @Output() picked = new EventEmitter<AddressSuggestion>();

    search = new FormControl('');
    suggestions: AddressSuggestion[] = [];
    loading = false;
    notFound = false;

    constructor(private state: GetacardState) {}

    ngOnInit() {
        this.search.valueChanges.pipe(
            startWith(''),
            debounceTime(300),
            map(() => this.term()),
            distinctUntilChanged(),
            switchMap(term => {
                this.suggestions = [];
                this.notFound = false;

                if (term.length < 5) {
                    this.loading = false;
                    return of([] as AddressSuggestion[]);
                }

                this.loading = true;
                return this.state.autocomplete(term, this.kind).pipe(
                    catchError(() => of([] as AddressSuggestion[]))
                );
            }),
        ).subscribe(list => {
            this.loading = false;
            this.suggestions = list;
            this.notFound = list.length === 0 && this.term().length >= 5;
        });
    }

    term(): string {
        return ('' + (this.search.value ?? '')).trim();
    }

    select(addr: AddressSuggestion) {
        this.suggestions = [];
        this.notFound = false;
        this.picked.emit(addr);
    }

    /** Preset the input (e.g. when re-opening the search from an Edit link). */
    seed(value: string) {
        this.search.setValue(value, {emitEvent: false});
        this.suggestions = [];
        this.notFound = false;
    }
}
