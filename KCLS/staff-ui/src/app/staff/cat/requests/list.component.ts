import {Component, OnInit, ViewChild} from '@angular/core';
import {Router} from '@angular/router';
import {Location} from '@angular/common';
import {from, EMPTY} from 'rxjs';
import {tap, map, concatMap} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {GridDataSource, GridColumn, GridCellTextGenerator,
    GridRowFlairEntry, GridColumnSort} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {PromptDialogComponent} from '@eg/share/dialog/prompt.component';
import {SelectDialogComponent} from '@eg/share/dialog/select.component';
import {ItemRequestDialogComponent} from './dialog.component';
import {ServerStoreService} from '@eg/core/server-store.service';
import {DateUtil} from '@eg/share/util/date';

const LIB_RESIDENCE_STAT_CAT = 12;

interface GridFilters {
    route_to_acq?: boolean,
    route_to_ill?: boolean,
    claimed_by_me?: boolean,
    include_rejected?: boolean,
    include_completed?: boolean,
}

interface NewGridFilters {
    isActive: boolean,
    claimState: number,
    routeToAcq: boolean,
}

@Component({
  templateUrl: 'list.component.html',
  styleUrls: ['list.component.css']
})
export class ItemRequestComponent implements OnInit {
    // hm, tried an enum, but it weird fast.
    CLAIM_STATE_UNCLAIMED = 1;
    CLAIM_STATE_CLAIMED = 2;
    CLAIM_STATE_MINE = 3;

    gridDataSource: GridDataSource = new GridDataSource();
    showRouteToNull = true;

    searchFamilyName: string | null = null;
    searchTitle: string | null = null;
    searchIllno: string | null = null;
    searchAuthor: string | null = null;
    searchIsbn: string | null = null;
    createDateFilter: string | null = null;

    formatFilter = ['_all'];
    audienceFilter = ['_all'];
    languageFilter = ['_all'];

    formats: IdlObject[] = [];
    audiences: IdlObject[] = [];
    languages: IdlObject[] = [];

    cellTextGenerator: GridCellTextGenerator;
    routeToOptions = [
        {label: $localize`ILL`, value: 'ill'},
        {label: $localize`Acquisitions`, value: 'acq'}
    ];

    gridFilters: GridFilters = {
        route_to_acq: true,
        route_to_ill: true,
    };

    // TODO persist
    newGridFilters: NewGridFilters = {
        isActive: true,
        routeToAcq: true,
        claimState: this.CLAIM_STATE_UNCLAIMED
    };

    illDenialOptions: IdlObject[] = [];

    @ViewChild('grid') private grid: GridComponent;
    @ViewChild('vendorPrompt') private vendorPrompt: PromptDialogComponent;
    @ViewChild('notePrompt') private notePrompt: PromptDialogComponent;
    @ViewChild('requestDialog') private requestDialog: ItemRequestDialogComponent;
    @ViewChild('routeToDialog') private routeToDialog: SelectDialogComponent;

    constructor(
        private router: Router,
        private ngLocation: Location,
        private idl: IdlService,
        private net: NetService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private serverStore: ServerStoreService,
    ) {}

    ngOnInit() {
        this.loadOptions();

        this.cellTextGenerator = {
            patron_barcode: r => r.usr().card() ? r.usr().card().barcode() : '',
            route_to: r => r.route_to(),
        };

        this.serverStore.getItem('eg.acq.request.list.filters')
        .then(filters => {
            if (filters) {
                this.gridFilters = filters;
            }
        });

        // Pre-cache these
        this.pcrud.retrieveAll('cirr', {order_by: {cirr: 'label'}}).subscribe(
            reason => this.illDenialOptions.push(reason));

        this.gridDataSource.getRows = (pager: Pager, sort: GridColumnSort[]) => {
            let orderBy: any = {auir: ['create_date']};

            if (sort.length) {
                let fieldName = sort[0].name;

                if (fieldName.match(/\.label/)) {
                    // Some fields are paths to a label, whose FK values
                    // also happen to be stored in sortable text codes
                    // (in English, anyway).
                    fieldName = fieldName.replace(/\.label/, '');
                }

                const field = this.idl.classes.auir.field_map[fieldName];

                orderBy.auir = {};
                orderBy.auir[fieldName] = {direction: sort[0].dir};

                // 'route_to' is a database enum type and cannot be sorted on lowercase()
                if (field && field.datatype === 'text' && fieldName !== 'route_to') {
                    // Lowercase sorted text fields
                    orderBy.auir[fieldName].transform = 'evergreen.lowercase';
                }
            }

            // Translate the create date filter into a full ISO date
            // so the API has a time zone to reference.
            let createDateYmd = this.createDateFilter;
            if (createDateYmd !== null) {
                let localDate = DateUtil.localDateFromYmd(createDateYmd);
                localDate.setSeconds(0);
                localDate.setMinutes(0);
                localDate.setHours(0);
                createDateYmd = localDate.toISOString();
            }

            let filters: any = {
                claimed_by_me: this.newGridFilters.claimState === this.CLAIM_STATE_MINE,
                is_claimed: this.newGridFilters.claimState === this.CLAIM_STATE_CLAIMED,
                is_unclaimed: this.newGridFilters.claimState === this.CLAIM_STATE_UNCLAIMED,
                is_staff_active: this.newGridFilters.isActive,
                is_staff_complete: !this.newGridFilters.isActive,
                route_to_acq: this.newGridFilters.routeToAcq,
                route_to_ill: !this.newGridFilters.routeToAcq, // binary
                patron_family_name: this.searchFamilyName,
                create_date: createDateYmd,
                title: this.searchTitle,
                illno: this.searchIllno,
                author: this.searchAuthor,
                isbn: this.searchIsbn,
            }

            // TODO supporting matching on a mix filter values with null
            // requires backend changes.

            if (!this.formatFilter.includes('_all')) {
                filters.format = this.formatFilter;
            }

            if (!this.audienceFilter.includes('_all')) {
                filters.audience = this.audienceFilter;
            }

            if (!this.languageFilter.includes('_all')) {
                filters.language = this.languageFilter;
            }

            let requests = {};

            return this.net.request(
                'open-ils.actor',
                'open-ils.actor.patron.patron-request.search',
                this.auth.token(), filters, orderBy, pager.limit, pager.offset
            ).pipe(map(reqData => {
                let req = reqData.request;
                req._status = reqData.status;

                req.usr()._residence =
                    req.usr().stat_cat_entries()
                    .filter(entry => Number(entry.stat_cat()) === LIB_RESIDENCE_STAT_CAT)
                    .map(entry => entry.stat_cat_entry())[0];

                requests[req.id()] = req;

                return req;
            }));
        };
    }

    // TODO this was copied from dialog.component :|
    // Move this to a shared service.
    loadOptions(): Promise<any> {
        if (this.formats.length > 0) {
            return Promise.resolve();
        }

        return this.pcrud.retrieveAll(
            'cuirf',
            {order_by: {cuirf: 'position'}},
            {atomic: true}
        ).toPromise()
        .then(formats => this.formats = formats)
        .then(_ => {
            return this.pcrud.retrieveAll(
                'cuira',
                {order_by: {cuirf: 'position'}},
                {atomic: true}
            ).toPromise()
            .then(audiences => this.audiences = audiences);
        })
        .then(_ => {
            return this.pcrud.retrieveAll(
                'cuirl',
                {order_by: {cuirf: 'position'}},
                {atomic: true}
            ).toPromise()
        })
        .then(langs => {
            // Move the default language to the front of the list
            const index = langs.findIndex(l => l.is_default() === 't');
            if (index > -1) {
                const lang = langs[index];
                langs.splice(index, 1);
                langs.unshift(lang);
            }
            this.languages = langs;
        });
    }

    resetFilters() {
        this.newGridFilters.claimState = this.CLAIM_STATE_UNCLAIMED;
        this.createDateFilter = null;
        this.searchFamilyName = null;
        this.searchTitle = null;
        this.searchIllno = null;
        this.searchAuthor = null;
        this.searchIsbn = null;

        this.formatFilter = ['_all'];
        this.audienceFilter = ['_all'];
        this.languageFilter = ['_all'];

        this.grid.reload();
    }

    applyDateFilter(ymd: string | null) {
        this.createDateFilter = ymd;
        this.grid.reload();
    }

    toggleIsActive() {
        this.newGridFilters.isActive = !this.newGridFilters.isActive;
        this.grid.reload();
    }

    setClaimStateFilter(claimState: number) {
        this.newGridFilters.claimState = claimState;
        this.grid.reload();
    }

    toggleRouteToFilter() {
        this.newGridFilters.routeToAcq = !this.newGridFilters.routeToAcq;
        this.grid.reload();
    }

    /*
    toggleRouteToIll() {
        this.gridFilters.route_to_ill = !this.gridFilters.route_to_ill;
        this.serverStore.setItem('eg.acq.request.list.filters', this.gridFilters);
        this.grid.reload();
    }

    toggleRouteToAcq() {
        this.gridFilters.route_to_acq = !this.gridFilters.route_to_acq;
        this.serverStore.setItem('eg.acq.request.list.filters', this.gridFilters);
        this.grid.reload();
    }

    toggleRouteToNull() {
        this.showRouteToNull = !this.showRouteToNull;
        this.grid.reload();
    }
    */

    claimItems(reqs: IdlObject[]) {
        reqs.forEach(r => {
            if (!r.claimed_by()) {
                r.claimed_by(this.auth.user().id());
                r.claim_date('now');
            }
        });

        this.updateReqs(reqs);
    }

    applyVendor(reqs: IdlObject[]) {
        this.vendorPrompt.open().subscribe(value => {
            if (!value) { return; }

            reqs.forEach(r => r.vendor(value));
            this.updateReqs(reqs);
        });
    }

    applyRouteTo(reqs: IdlObject[]) {
        this.routeToDialog.open().subscribe(value => {
            if (!value) { return; }

            reqs.forEach(r => r.route_to(value));
            this.updateReqs(reqs);
        });
    }

    addStaffNote(reqs: IdlObject[]) {
        this.notePrompt.promptValue = '';
        this.notePrompt.dialogTitle = $localize`Add Staff-Only Note`;

        this.notePrompt.open().toPromise().then(value => {
            if (!value) { return; }

            reqs.forEach(req => {
                let note = req.staff_notes();
                if (note) {
                    req.staff_notes(note + '\n' + value);
                } else {
                    req.staff_notes(value);
                }
            });

            this.updateReqs(reqs);

        });
    }

    addPatronVisibleNote(reqs: IdlObject[]) {
        this.notePrompt.promptValue = '';
        this.notePrompt.dialogTitle = $localize`Add Patron-Visible Note`;

        this.notePrompt.open().toPromise().then(value => {
            if (!value) { return; }

            reqs.forEach(req => {
                let note = req.patron_notes();
                if (note) {
                    req.patron_notes(note + '\n' + value);
                } else {
                    req.patron_notes(value);
                }
            });

            this.updateReqs(reqs);

        });
    }

    updateReqs(reqs: IdlObject[]) {
        from(reqs).pipe(concatMap(req => {
            return this.pcrud.update(req);
        })).subscribe(
            null,
            null,
            () => this.grid.reload()
        );
    }

    newRequest() {
        this.requestDialog.illDenialOptions = this.illDenialOptions;
        this.requestDialog.mode = 'create';
        this.requestDialog.open({size: 'xl'})
        .subscribe(changesMade => {
            if (changesMade) {
                this.grid.context.reloadSync();
            }
        });
    }

    showRequestDialog(req: IdlObject) {
        this.requestDialog.illDenialOptions = this.illDenialOptions;
        this.requestDialog.requestId = req.id();
        this.requestDialog.mode = 'edit';
        this.requestDialog.open({size: 'xl'})
        .subscribe(changesMade => {
            if (changesMade) {
                this.grid.context.reloadSync();
            }
        });
    }

    trimLangLabel(label: string): string {
        return label.replace(/^.*\//, '');
    }
}

