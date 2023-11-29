import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {Title}  from '@angular/platform-browser';
import {FormControl, Validators} from '@angular/forms';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {RequestsService} from './requests.service';
import {MatCheckboxChange} from '@angular/material/checkbox';
import {debounceTime} from 'rxjs/operators';

const BC_URL = 'https://kcls.bibliocommons.com/item/show/';
const BC_CODE = '082';
const MIN_ID_LENGTH = 6;
// Book requests older than this many ears are routed to ILL
const ILL_ROUTE_AGE = 2;
// These always go to ILL.
const ILL_FORMATS = ['journal', 'microfilm', 'article'];

interface SuggestedRecord {
    id: number,
    source: string,
    display: Hash,
    attributes: Record<string, Hash>,
}

@Component({
  selector: 'app-patron-request-create',
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss']
})
export class CreateRequestComponent implements OnInit {
    patronBarcode = '';
    requestSubmitted = false;
    requestSubmitError = false;
    suggestedRecords: SuggestedRecord[] = [];
    selectedRecord: SuggestedRecord | null = null;
    searchingRecords = false;
    previousSearch = '';
    holdRequestUrl = '';

    controls: {[field: string]: FormControl} = {
        title: new FormControl({value: '', disabled: true}, [Validators.required]),
        author: new FormControl({value: '', disabled: true}),
        identifier: new FormControl(''),
        pubdate: new FormControl({value: '', disabled: true}, [Validators.pattern(/^\d{4}$/)]),
        publisher: new FormControl({value: '', disabled: true}),
        language: new FormControl({value: '', disabled: true}),
        notes: new FormControl({value: '', disabled: true}),
    }

    constructor(
        private router: Router,
        private title: Title,
        private snackBar: MatSnackBar,
        private gateway: Gateway,
        public app: AppService,
        public requests: RequestsService
    ) { }

    ngOnInit() {
        this.title.setTitle($localize`Request an Item`);
        this.requests.patronChecked.subscribe(() => this.activateForm());

        // patronChecked is only called if a session retrieval is made,
        // which won't happen when navigating between tabs.
        this.activateForm();

        this.controls.identifier.valueChanges.pipe(debounceTime(500))
        .subscribe(ident => this.identLookup(ident));
    }

    identLookup(ident: string): Promise<void> {
        if (!ident
            || ident.length < MIN_ID_LENGTH
            || ident === this.previousSearch
            || this.requests.selectedFormat === 'journal') {
            return Promise.resolve();
        }

        this.previousSearch = ident;
        this.searchingRecords = true;
        this.suggestedRecords = [];

        return this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron-request.record.search',
            this.app.getAuthtoken(), {identifier: ident}

        ).then((results: unknown) => {
            console.debug('Suggested records', results);
            const res = results as SuggestedRecord[];
            this.searchingRecords = false;
            this.suggestedRecords = res;
        });
    }

    selectedRecordChanged(selection: MatCheckboxChange, record: SuggestedRecord) {
        this.holdRequestUrl = '';

        const isMe = (this.selectedRecord && this.selectedRecord.id === record.id);

        if (selection.checked && !isMe) {
            this.selectedRecord = record;
        }

        if (!selection.checked && isMe) {
            // Handle case where no other option is checked.
            this.selectedRecord = null;
            this.resetForm(true);
            this.activateForm();
            return;
        }

        this.controls.title.setValue(record.display.title);
        this.controls.author.setValue(record.display.author);
        this.controls.pubdate.setValue(record.display.pubdate);
        this.controls.publisher.setValue(record.display.publisher);

        // If the patron selected a record we already have,
        // direct them place a hold
        if (record.source === 'local') {
            const egBibId =  Number(record.id);
            this.disableForm();
            this.holdRequestUrl = `${BC_URL}${egBibId}${BC_CODE}`;
        }
    }

    activateForm() {
        if (this.app.getAuthSession() && this.requests.requestsAllowed) {
            for (const field in this.controls) {
                this.controls[field].enable();
            }
        } else {
            this.disableForm();
        }
    }

    disableForm() {
        for (const field in this.controls) {
            this.controls[field].disable();
        }
    }

    canSubmit(): boolean {
        if (!this.requests.requestsAllowed) {
            return false;
        }
        if (!this.app.getAuthSession()) {
            return false;
        }
        for (const field in this.controls) {
            if (this.controls[field].errors) {
                return false;
            }
        }
        if (this.holdRequestUrl) {
            return false;
        }
        return true;
    }

    setRouteTo(values: Hash) {
        values.route_to = 'purchasing';
        const fmt = this.requests.selectedFormat || '';

        if (fmt === 'book') {
            if (values.pubdate) {
                const thisYear = new Date().getFullYear();
                if ((thisYear - ILL_ROUTE_AGE) > Number(values.pubdate)) {
                    values.route_to = 'ill';
                }
            }
        } else if (ILL_FORMATS.includes(fmt)) {
            values.route_to = 'ill';
        }
    }

    submitRequest(): boolean {
        if (!this.canSubmit()) { return false; }

        const values: Hash = {};
        for (const field in this.controls) {
            values[field] = this.controls[field].value;
        }

        values.format = this.requests.selectedFormat;

        this.requestSubmitted = false;
        this.requestSubmitError = false;
        this.setRouteTo(values);

        console.debug('Submitting request', values);

        this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron-request.create',
            this.app.getAuthtoken(), values
        ).then((resp: unknown) => {
            console.debug('Create request returned', resp);

            if (resp && (resp as Hash).request_id) {
                this.requestSubmitted = true;
                this.resetForm();

                const ref = this.snackBar.open(
                    $localize`Request Submitted`,
                    $localize`View My Requests`
                );

                const sub = ref.onAction().subscribe(() => {
                    sub.unsubscribe();
                    this.router.navigate(['/requests/list'])
                });

            } else {
                this.requestSubmitError = true;
            }
        });

        return false;
    }

    resetForm(keepIdent?: boolean) {
        setTimeout(() => {
            for (const field in this.controls) {
                if (keepIdent && field === 'identifier') {
                    continue;
                }
                this.controls[field].reset();
                this.controls[field].markAsPristine();
                this.controls[field].markAsUntouched();
            }
        });
    }
}
