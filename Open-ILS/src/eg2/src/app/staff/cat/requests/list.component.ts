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

const LIB_RESIDENCE_STAT_CAT = 12;

@Component({
  templateUrl: 'list.component.html'
})
export class ItemRequestComponent implements OnInit {
    gridDataSource: GridDataSource = new GridDataSource();
    showRouteToIll = true;
    showRouteToAcq = true;
    showRouteToNull = true;
    showRejected = false;
    showCompleted = false;
    showClaimedByMe = false;
    cellTextGenerator: GridCellTextGenerator;
    routeToOptions = [
        {label: $localize`ILL`, value: 'ill'},
        {label: $localize`Acquisitions`, value: 'acq'}
    ];

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
    ) {}

    ngOnInit() {
        this.cellTextGenerator = {
            patron_barcode: r => r.usr().card() ? r.usr().card().barcode() : '',
            route_to: r => r.route_to(),
        };

        // Pre-cache these
        this.pcrud.retrieveAll('cirr', {order_by: {cirr: 'label'}}).subscribe(
            reason => this.illDenialOptions.push(reason));

        this.gridDataSource.getRows = (pager: Pager, sort: GridColumnSort[]) => {
            let orderBy: any = {ausp: 'create_date'};

            if (sort.length) {
                const field = this.idl.classes.auir.field_map[sort[0].name];
                if (field && field.datatype === 'text') {
                    // When sorting on TEXT fields pass the value through the
                    // lowercase transform.
                    orderBy = [{
                        class: "auir",
                        field: field.name,
                        transform: "evergreen.lowercase",
                        direction: sort[0].dir
                    }];
                } else {
                    orderBy.auir = sort[0].name + ' ' + sort[0].dir
                }
            }

            // base query to grab everything
            let base: any = {
                complete_date: null,
                cancel_date: null,
                '-or': []
            };

            if (!this.showRejected) {
                base.reject_date = null;
            }
            if (!this.showCompleted) {
                base.complete_date = null;
            }
            if (this.showClaimedByMe) {
                base.claimed_by = this.auth.user().id();
            }
            if (this.showRouteToIll) {
                base['-or'].push({route_to: 'ill'});
            }
            if (this.showRouteToAcq) {
                base['-or'].push({route_to: 'acq'});
            }
            if (this.showRouteToNull) {
                base['-or'].push({route_to: null});
            }
            if (base['-or'].length === 0) {
                delete base['-or'];
            }

            const query: any = new Array();
            query.push(base);

            // and add any filters
            const filters = this.gridDataSource.filters;
            Object.keys(filters).forEach(key => {
                Object.keys(filters[key]).forEach(key2 => {
                    query.push(filters[key][key2]);
                });
            });

            const flesh = {
                flesh: 2,
                flesh_fields: {
                    auir: ['usr', 'claimed_by'],
                    au: ['card', 'profile', 'stat_cat_entries']
                },
                order_by: orderBy
            };

            return this.pcrud.search('auir', query, flesh)
            .pipe(tap(req => {
                req.usr()._residence =
                    req.usr().stat_cat_entries()
                    .filter(entry => Number(entry.stat_cat()) === LIB_RESIDENCE_STAT_CAT)
                    .map(entry => entry.stat_cat_entry())[0];
            }))
            .pipe(concatMap(req => {
                return this.net.request(
                    'open-ils.actor',
                    'open-ils.actor.patron-request.status',
                    this.auth.token(), req.id())
                .pipe(tap(stat => req._status = stat.status))
                .pipe(map(_ => req));
            }));
        };
    }

    toggleClaimedByMe() {
        this.showClaimedByMe = !this.showClaimedByMe;
        this.grid.reload();
    }

    toggleShowRejected() {
        this.showRejected = !this.showRejected;
        this.grid.reload();
    }

    toggleShowCompleted() {
        this.showCompleted = !this.showCompleted;
        this.grid.reload();
    }

    toggleRouteToIll() {
        this.showRouteToIll = !this.showRouteToIll;
        this.grid.reload();
    }

    toggleRouteToAcq() {
        this.showRouteToAcq = !this.showRouteToAcq;
        this.grid.reload();
    }

    toggleRouteToNull() {
        this.showRouteToNull = !this.showRouteToNull;
        this.grid.reload();
    }

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

    // may not need this.
    showRequestDialog(req: IdlObject) {
        this.requestDialog.illDenialOptions = this.illDenialOptions;
        this.requestDialog.requestId = req.id();
        this.requestDialog.open({size: 'xl'})
        .subscribe(changesMade => {
            if (changesMade) {
                this.grid.context.reloadSync();
            }
        });
    }
}

