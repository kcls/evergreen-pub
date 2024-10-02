import {Component, OnInit} from '@angular/core';
import {Observable} from 'rxjs';
import {map, startWith} from 'rxjs/operators';
import {Router} from '@angular/router';
import {MatSnackBar} from '@angular/material/snack-bar';
import {Title}  from '@angular/platform-browser';
import {FormControl, Validators} from '@angular/forms';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {RequestsService} from './requests.service';
import {MatCheckboxChange} from '@angular/material/checkbox';
import {debounceTime} from 'rxjs/operators';
import {Settings} from '../settings.service';

const BC_URL = 'https://kcls.bibliocommons.com/item/show/';
const BC_CODE = '082';
const MIN_ID_LENGTH = 6;
const MAX_TEXT_LENGTH = 256;

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
    maxTextLength = MAX_TEXT_LENGTH;
    dupeTitleFound = false;
    dupeIdentFound = false;
    checkingDupes = false;
    pickupLibs: Hash[] = [];

    languages = [
        $localize`English`,
        $localize`አማርኛ / Amharic`,
        $localize`عربي / Arabic`,
        $localize`中文 / Chinese`,
        $localize`Deutsch / German`,
        $localize`ગુજરાતી / Gujarati`,
        $localize`עִברִית / Hebrew`,
        $localize`हिंदी  / indi`,
        $localize`italiano / Italian`,
        $localize`日本語 / Japanese`,
        $localize`한국어 / Korean`,
        $localize`मराठी  / Marathi`,
        $localize`Kajin M̧ajeļ / Marshallese`,
        $localize`ਪੰਜਾਬੀ  / Punjabi/Panjabi`,
        $localize`فارسی / Persian`,
        $localize`Português / Portuguese`,
        $localize`Pусский / Russian`,
        $localize`Soomaali / Somali`,
        $localize`Español / Spanish`,
        $localize`Tagalog`,
        $localize`தமிழ்  / Tamil`,
        $localize`తెలుగు  / Telugu`,
        $localize`Українська / Ukrainian`,
        $localize`Tiếng Việt / Vietnamese`,
    ];

    controls: {[field: string]: FormControl} = {
        title: new FormControl({value: '', disabled: true}, [Validators.required]),
        author: new FormControl({value: '', disabled: true}),
        identifier: new FormControl(''),
        pubdate: new FormControl({value: '', disabled: true}, [Validators.pattern(/^\d{4}$/)]),
        publisher: new FormControl({value: '', disabled: true}),
        language: new FormControl({value: '', disabled: true}),
        notes: new FormControl({value: '', disabled: true}),
        pickupLib: new FormControl(0),
    }

    constructor(
        private router: Router,
        private title: Title,
        private snackBar: MatSnackBar,
        private gateway: Gateway,
        public app: AppService,
        private settings: Settings,
        public requests: RequestsService
    ) { }

    ngOnInit() {
        this.title.setTitle($localize`Request an Item`);
        this.requests.patronChecked.subscribe(() => this.activateForm());

        // patronChecked is only called if a session retrieval is made,
        // which won't happen when navigating between tabs.
        this.activateForm();

        this.controls.identifier.valueChanges.pipe(debounceTime(500))
        .subscribe(ident => {
            this.identLookup(ident);
            this.dupesLookup();
        });

        this.controls.title.valueChanges.pipe(debounceTime(500))
        .subscribe(title => this.dupesLookup());

        this.requests.formatChanged.subscribe(_ => this.dupesLookup());

        this.app.authSessionLoad.subscribe(() => this.getPatronPickupLib());

        // Latch on to the in-progress session fetcher promise in
        // case we already have a token, in wich case the above
        // won't fire.
        this.app.fetchAuthSession().then(_ => {
            if (this.app.getAuthtoken()) {
                this.getPatronPickupLib();
            }
        });

        this.requests.loadPickupLibs().then(libs => this.pickupLibs = libs);
    }

    updatePickupLib(pl: number) {
        if (Number(pl)) {
            console.debug('Updating pickup lib to ', pl);

            this.gateway.requestOne(
                'open-ils.actor',
                'open-ils.actor.patron.settings.update',
                this.app.getAuthtoken(), null, {'opac.default_pickup_location': pl}
            );
        }
    }

    getPatronPickupLib() {
        let ses = this.app.getAuthSession();
        if (!ses) { return; } // make TS happy

        this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron.settings.retrieve',
            this.app.getAuthtoken(), null, 'opac.default_pickup_location')
        .then(lib => {
            lib = Number(lib) || 0;
            if (lib === 0) {
                lib = Number(ses.home_ou);
            }
            this.controls.pickupLib.setValue(lib);

            // Watch for changes after we apply the initial value
            this.controls.pickupLib.valueChanges.subscribe(pl => this.updatePickupLib(pl));
        });
    }

    dupesLookup() {
        let title = this.controls.title.value;
        let ident = this.controls.identifier.value;
        let format = this.requests.selectedFormat;

        this.dupeTitleFound = false;
        this.dupeIdentFound = false;

        if (!format || !(title || ident)) {
            return;
        }

        this.checkingDupes = true;

        this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron-request.dupes.search',
            this.app.getAuthtoken(), null, format, title, ident)
        .then((found: unknown) => {
            if (Boolean(Number(found))) {
                if (ident) {
                    this.dupeIdentFound = true;
                } else {
                    this.dupeTitleFound = true;
                }
            }

            this.checkingDupes = false;
        });
    }

    filterLangs(value: string): string[] {
        const val = value.toLowerCase();
        return this.languages.filter(lang => lang.toLowerCase().includes(val));
    }

    identLookup(ident: string): Promise<void> {
        if (!ident
            || ident.length < MIN_ID_LENGTH
            || ident === this.previousSearch
            || this.requests.selectedFormat === 'article') {
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
        if (this.checkingDupes || this.dupeTitleFound || this.dupeIdentFound) {
            return false;
        }
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

    submitRequest(): boolean {
        if (!this.canSubmit()) { return false; }

        const values: Hash = {};
        for (const field in this.controls) {
            values[field] = this.controls[field].value;
        }

        values.format = this.requests.selectedFormat;
        values.ill_opt_out = this.requests.illOptOut;
        values.id_matched = this.suggestedRecords.length > 0;

        this.requestSubmitted = false;
        this.requestSubmitError = false;

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

    // keepIdent is used when toggling between records matched via
    // ISBN, etc. search.  In those cases, we want to clear most
    // of the form, but not the identifier or the format/ill-opt-out.
    resetForm(keepIdent?: boolean) {
        setTimeout(() => {
            for (const field in this.controls) {
                if (keepIdent && field === 'identifier') {
                    continue;
                }
                this.controls[field].reset();
                this.controls[field].markAsPristine();
                this.controls[field].markAsUntouched();
                if (!keepIdent) {
                    this.requests.formResetRequested.emit();
                }
            }
        });
    }
}
