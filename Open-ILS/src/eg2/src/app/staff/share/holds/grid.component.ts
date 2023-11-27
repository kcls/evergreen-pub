import {Component, OnInit, Input, Output, EventEmitter, ViewChild} from '@angular/core';
import {Location} from '@angular/common';
import {Observable, Observer, empty, of, from} from 'rxjs';
import {concatMap, tap, last} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';
import {EventService} from '@eg/core/event.service';
import {Pager} from '@eg/share/util/pager';
import {ServerStoreService} from '@eg/core/server-store.service';
import {GridDataSource, GridColumn, GridCellTextGenerator} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {ProgressDialogComponent} from '@eg/share/dialog/progress.component';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';
import {AlertDialogComponent} from '@eg/share/dialog/alert.component';
import {MarkDamagedDialogComponent
    } from '@eg/staff/share/holdings/mark-damaged-dialog.component';
import {MarkMissingDialogComponent
    } from '@eg/staff/share/holdings/mark-missing-dialog.component';
import {MarkDiscardDialogComponent
    } from '@eg/staff/share/holdings/mark-discard-dialog.component';
import {HoldRetargetDialogComponent
    } from '@eg/staff/share/holds/retarget-dialog.component';
import {HoldTransferDialogComponent} from './transfer-dialog.component';
import {HoldCancelDialogComponent} from './cancel-dialog.component';
import {HoldManageDialogComponent} from './manage-dialog.component';
import {PrintService, HATCH_BROWSER_PRINTING_PRINTER} from '@eg/share/print/print.service';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {HoldsService} from './holds.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {StringComponent} from '@eg/share/string/string.component';
import {ToastService} from '@eg/share/toast/toast.service';

/** Holds grid with access to detail page and other actions */

@Component({
  selector: 'eg-holds-grid',
  templateUrl: 'grid.component.html'
})
export class HoldsGridComponent implements OnInit {

    // Hide the "Holds Count" header
    @Input() hideHoldsCount = false;

    @Input() hidePrintOption = false;

    @Input() disablePaging = false;

    // If either are set/true, the pickup lib selector will display
    @Input() initialPickupLib: number | IdlObject;
    @Input() hidePickupLibFilter: boolean;

    // Optionally override the default grid page size
    @Input() pageSize: number = null;

    // If true, only retrieve holds with a Hopeless Date
    // and enable related Actions
    @Input() hopeless: boolean;

    // Setting a value here puts us into "pull list" mode.
    @Input() pullListOrg: number;

    // Setting a value here puts us into "holds shelf" mode.
    @Input() shelfOrg: number;

    // Limit to clearable holds for hold shelf clearing
    @Input() showClearable = false;

    // Grid persist key
    @Input() persistKey: string;

    @Input() preFetchSetting: string;

    @Input() printTemplate: string;

    // Adds a Place Hold grid toolbar button that emits
    // placeHoldRequested on click.
    @Input() showPlaceHoldButton = false;

    // If set, all holds are fetched on grid load and sorting/paging all
    // happens in the client.  If false, sorting and paging occur on
    // the server.
    @Input() enablePreFetch: boolean;

    // How to sort when no sort parameters have been applied
    // via grid controls.  This uses the eg-grid sort format:
    // [{name: fname, dir: 'asc'}, {name: fname2, dir: 'desc'}]
    @Input() defaultSort: any[];

    // To pass through to the underlying eg-grid
    @Input() showFields: string;

    // If true, avoid popping up the progress dialog.  Note the grid
    // has it's own generic embedded 'loading' progress indicator.
    @Input() noLoadProgress = false;

    // Some default columns and actions do or don't make sense when
    // displaying holds for a specific patron vs. e.g. a specific title.
    @Input() patronFocused = false;

    // Display bib record summary along the top of the detail page.
    @Input() showRecordSummary = false;

    mode: 'list' | 'detail' | 'manage' = 'list';
    initDone = false;
    holdsCount: number;
    pickupLib: IdlObject;
    orgSelectLoaded = false;
    gridDataSource: GridDataSource;
    detailHold: any;
    editHolds: number[];
    transferTarget: number;
    uncancelHoldCount: number;
    clearHoldsActions: {[id: number]: string} = {};
    clearHoldsExecuted = false;
    disablePrint = false;

    @ViewChild('holdsGrid', { static: false }) private holdsGrid: GridComponent;
    @ViewChild('progressDialog', { static: true })
        private progressDialog: ProgressDialogComponent;
    @ViewChild('transferDialog', { static: true })
        private transferDialog: HoldTransferDialogComponent;
    @ViewChild('markDamagedDialog', { static: true })
        private markDamagedDialog: MarkDamagedDialogComponent;
    @ViewChild('markMissingDialog', { static: true })
        private markMissingDialog: MarkMissingDialogComponent;
    @ViewChild('markDiscardDialog')
        private markDiscardDialog: MarkDiscardDialogComponent;
    @ViewChild('retargetDialog', { static: true })
        private retargetDialog: HoldRetargetDialogComponent;
    @ViewChild('cancelDialog', { static: true })
        private cancelDialog: HoldCancelDialogComponent;
    @ViewChild('manageDialog', { static: true })
        private manageDialog: HoldManageDialogComponent;
    @ViewChild('uncancelDialog') private uncancelDialog: ConfirmDialogComponent;

    @ViewChild('postClearShelf') postClearShelf: StringComponent;
    @ViewChild('postClearHold') postClearHold: StringComponent;
    @ViewChild('postClearTransit') postClearTransit: StringComponent;
    @ViewChild('postClearPlChanged') postClearPlChanged: StringComponent;
    @ViewChild('uncancelFail') uncancelFail: AlertDialogComponent;
    @ViewChild('uncancelSuccess') uncancelSuccess: StringComponent;

    // Bib record ID.
    _recordId: number;
    @Input() set recordId(id: number) {
        this._recordId = id;
        if (this.initDone) { // reload on update
            this.holdsGrid.reload();
        }
    }

    get recordId(): number {
        return this._recordId;
    }

    _patronId: number;
    @Input() set patronId(id: number) {
        this._patronId = id;
        if (this.initDone) {
            this.holdsGrid.reload();
        }
    }
    get patronId(): number {
        return this._patronId;
    }

    // If true, show recently canceled holds only.
    @Input() showRecentlyCanceled = false;

    // Include holds fulfilled on or after hte provided date.
    // If no value is passed, fulfilled holds are not displayed.
    _showFulfilledSince: Date;
    @Input() set showFulfilledSince(show: Date) {
        this._showFulfilledSince = show;
        if (this.initDone) { // reload on update
            this.holdsGrid.reload();
        }
    }
    get showFulfilledSince(): Date {
        return this._showFulfilledSince;
    }


    cellTextGenerator: GridCellTextGenerator;

    // Include holds marked Hopeless on or after this date.
    _showHopelessAfter: Date;
    @Input() set showHopelessAfter(show: Date) {
        this._showHopelessAfter = show;
        if (this.initDone) { // reload on update
            this.holdsGrid.reload();
        }
    }

    // Include holds marked Hopeless on or before this date.
    _showHopelessBefore: Date;
    @Input() set showHopelessBefore(show: Date) {
        this._showHopelessBefore = show;
        if (this.initDone) { // reload on update
            this.holdsGrid.reload();
        }
    }

    // Notify the caller the place hold button was clicked.
    @Output() placeHoldRequested: EventEmitter<void> = new EventEmitter<void>();

    constructor(
        private ngLocation: Location,
        private net: NetService,
        private org: OrgService,
        private pcrud: PcrudService,
        private store: ServerStoreService,
        private auth: AuthService,
        private evt: EventService,
        private printer: PrintService,
        private toast: ToastService,
        private holds: HoldsService,
        private holdings: HoldingsService
    ) {
        this.gridDataSource = new GridDataSource();
        this.enablePreFetch = null;
    }

    ngOnInit() {
        this.initDone = true;
        this.pickupLib = this.org.get(this.initialPickupLib);

        if (this.preFetchSetting) {
            this.store.getItem(this.preFetchSetting).then(
                applied => this.enablePreFetch = Boolean(applied)
            );
        } else {
            this.enablePreFetch = false;
        }

        if (this.showClearable) {
            this.disablePrint = true;
        }

        if (!this.defaultSort) {
            if (this.pullListOrg) {

                this.defaultSort = [
                    {name: 'copy_location_order_position', dir: 'asc'},
                    {name: 'acpl_name', dir: 'asc'},
                    {name: 'ancp_label', dir: 'asc'}, // NOTE: API typo "ancp"
                    {name: 'cn_label_sortkey', dir: 'asc'},
                    {name: 'ancs_label', dir: 'asc'} // NOTE: API typo "ancs"
                ];

            } else if (this.shelfOrg) {
                this.defaultSort = [
                    {name: 'shelf_expire_time', dir: 'asc', nulls: 'last'}
                ];

            } else {
                this.defaultSort = [{name: 'request_time', dir: 'asc'}];
            }
        }

        this.gridDataSource.getRows = (pager: Pager, sort: any[]) => {

            if (!this.orgSelectLoaded && (
                !this.hidePickupLibFilter || this.shelfOrg || this.pullListOrg)) {
                // When an org select is active, avoid any
                // data fetches until it has settled on a default value.
                // Once the final value is applied, its onchange will
                // fire and we'll be back here with orgSelectLoaded=true.
                return of([]);
            }

            sort = sort.length > 0 ? sort : this.defaultSort;
            return this.fetchHolds(pager, sort);
        };

        // Text-ify function for cells that use display templates.
        this.cellTextGenerator = {
            title: row => row.title,
            cp_barcode: row => (row.cp_barcode == null) ? '' : row.cp_barcode,
            ucard_barcode: row => row.ucard_barcode,
            hold_status: row => row.hold_status // TODO labels
        };
    }

    // Returns true after all data/settings/etc required to render the
    // grid have been fetched.
    initComplete(): boolean {
        return this.enablePreFetch !== null;
    }

    pickupLibChanged(org: IdlObject) {
        this.pickupLib = org;
        this.holdsGrid.reload();
    }

    pullListOrgChanged(org: IdlObject) {
        this.pullListOrg = org.id();
        this.holdsGrid.reload();
    }

    shelfOrgChanged(org: IdlObject) {
        this.shelfOrg = org.id();
        this.holdsGrid.reload();
    }

    setClearableFilter(clearable: boolean) {
        this.showClearable = clearable;
        this.holdsGrid.reload();

        // When showing all holds, clear info for the previous clear
        // holds shelf run.
        if (!clearable) {
            this.clearHoldsExecuted = false;
            this.clearHoldsActions = {};
        }
    }

    preFetchHolds(apply: boolean) {
        this.enablePreFetch = apply;

        if (apply) {
            setTimeout(() => this.holdsGrid.reload());
        }

        if (this.preFetchSetting) {
            // fire and forget
            this.store.setItem(this.preFetchSetting, apply);
        }
    }

    applyFilters(): any {

        const filters: any = {};

        if (this.pullListOrg) {
            filters.cancel_time = null;
            filters.capture_time = null;
            filters.frozen = 'f';

            // There are aliases for these (cp_status, cp_circ_lib),
            // but the API complains when I use them.
            filters['cp.status'] = [0, 7];
            filters['cp.circ_lib'] = this.pullListOrg;

            return filters;
        }

        if (this.shelfOrg) {

            if (this.clearHoldsExecuted) {
                // We just completed a Clear Holds Shelf.
                // Display the just-cleared holds.
                filters['h.id'] = Object.keys(this.clearHoldsActions);
                return filters;
            }

            filters.is_staff_request = 'true';
            filters.last_captured_hold = 'true';
            filters.capture_time = {not: null};
            filters.cs_id = 8; // On Holds Shelf
            filters.cp_deleted = 'f';
            filters.fulfillment_time = null;
            filters.current_shelf_lib = this.shelfOrg;

            filters['cp.status'] = 8; // ON HOLDS SHELF

            if (this.showClearable) {
                filters.clear_me = 't';
            }

            return filters;
        }

        if (this.showFulfilledSince) {
            filters.fulfillment_time = this.showFulfilledSince.toISOString();
        } else {
            filters.fulfillment_time = null;
        }

        if (this.hopeless) {
          filters['hopeless_holds'] = {
            'start_date' : this._showHopelessAfter
              ? (
                  // FIXME -- consistency desired, string or object
                  typeof this._showHopelessAfter === 'object'
                  ? this._showHopelessAfter.toISOString()
                  : this._showHopelessAfter
                )
              : '1970-01-01T00:00:00.000Z',
            'end_date' : this._showHopelessBefore
              ? (
                  // FIXME -- consistency desired, string or object
                  typeof this._showHopelessBefore === 'object'
                  ? this._showHopelessBefore.toISOString()
                  : this._showHopelessBefore
                )
              : (new Date()).toISOString()
          };
        }

        if (this.pickupLib) {
            filters.pickup_lib =
                this.org.descendants(this.pickupLib, true);
        }

        if (this.recordId) {
            filters.record_id = this.recordId;
        }

        if (this.patronId) {
            filters.usr_id = this.patronId;
        }

        return filters;
    }

    fetchHolds(pager: Pager, sort: any[]): Observable<any> {

        // We need at least one filter.
        if (!this.recordId && !this.pickupLib && !this.patronId &&
            !this.pullListOrg && !this.shelfOrg) {
            return empty();
        }

        const filters = this.applyFilters();
        const orderBy: any = [];

        if (this.clearHoldsExecuted &&
            filters['h.id'] && filters['h.id'].length === 0) {
            return empty();
        }

        if (sort.length > 0) {
            sort.forEach(obj => {
                const subObj: any = {};
                let fieldName = obj.name;

                if (fieldName === 'status_string') {
                    // status_string is a locally derived value which
                    // cannot be server-sorted.  Instead, sort by the
                    // status number for consistent sort behavior and to
                    // avoid API explosions
                    fieldName = 'hold_status';
                }

                subObj[fieldName] = {dir: obj.dir, nulls: 'last'};
                orderBy.push(subObj);
            });

        } else if (this.pullListOrg) {
            // TODO: can remove this?  should be covered by this.defaultSort
            orderBy.push(
                {copy_location_order_position: {dir: 'asc', nulls: 'last'}},
                {acpl_name: {dir: 'asc', nulls: 'last'}},
                {cn_label_sortkey: {dir: 'asc'}}
            );
        }

        const limit = this.enablePreFetch ? null : pager.limit;
        const offset = this.enablePreFetch ? 0 : pager.offset;
        const options: any = {};
        if (this.showRecentlyCanceled) {
            options.recently_canceled = true;

        } else if (!this.shelfOrg) {
            // A holds shelf may contain canceled holds.
            filters.cancel_time = null;
        }

        let observer: Observer<any>;
        const observable = new Observable(obs => observer = obs);

        if (!this.noLoadProgress) {
            // Note remaining dialog actions have no impact
            this.progressDialog.reset();
            this.progressDialog.open();
        }

        this.progressDialog.update({value: 0, max: 1});

        let first = true;
        let loadCount = 0;
        this.net.request(
            'open-ils.circ',
            'open-ils.circ.hold.wide_hash.stream',
            this.auth.token(), filters, orderBy, limit, offset, options
        ).subscribe(
            holdData => {

                if (first) { // First response is the hold count.
                    this.holdsCount = Number(holdData);
                    first = false;

                } else { // Subsequent responses are hold data blobs

                    if (holdData.tr_source) {
                        holdData.tr_source = this.org.get(holdData.tr_source).shortname();
                    }

                    if (holdData.tr_source) {
                        holdData.tr_dest = this.org.get(holdData.tr_dest).shortname();
                    }

                    this.progressDialog.update(
                        {value: ++loadCount, max: this.holdsCount});

                    observer.next(holdData);
                }
            },
            err => {
                this.progressDialog.close();
                observer.error(err);
            },
            ()  => {
                this.progressDialog.close();
                observer.complete();
            }
        );

        return observable;
    }

    metaRecordHoldsSelected(rows: IdlObject[]) {
        let found = false;
        rows.forEach( row => {
           if (row.hold_type === 'M') {
             found = true;
           }
        });
        return found;
    }

    nonTitleHoldsSelected(rows: IdlObject[]) {
        let found = false;
        rows.forEach( row => {
           if (row.hold_type !== 'T') {
             found = true;
           }
        });
        return found;
    }

    showDetails(rows: any[]) {
        if (!rows || rows.length == 0) {
            rows = this.holdsGrid.context.getSelectedRows();
        }
        this.showDetail(rows[0]);
    }

    showHoldsForTitle(rows: any[]) {
        if (rows.length === 0) { return; }

        const url = this.ngLocation.prepareExternalUrl(
            `/staff/catalog/record/${rows[0].record_id}/holds`);

        window.open(url, '_blank');
    }

    showDetail(row: any) {
        if (row) {
            this.mode = 'detail';
            this.detailHold = row;
        }
    }

    showManager(rows: any[]) {
        if (rows.length) {
            this.mode = 'manage';
            this.editHolds = rows.map(r => r.id);
        }
    }

    handleModify(rowsModified: boolean) {
        this.mode = 'list';

        if (rowsModified) {
            // give the grid a chance to render then ask it to reload
            setTimeout(() => this.holdsGrid.reload());
        }
    }

    showRecentCircs(rows: any[]) {
        const copyIds = rows.filter(r => Boolean(r.cp_id)).map(r => r.cp_id);
        if (copyIds.length > 0) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/cat/item/${copyIds[0]}/circ-history`);
            window.open(url);
        }
    }

    openItemStatusList(rows: any[]) {
        const ids = rows.filter(r => r.cp_id).map(r => r.cp_id);
        if (ids.length > 0) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/cat/item/list/${ids.join(',')}`);
            window.open(url);
        }
    }

    openItemStatus(rows: any[]) {
        const ids = rows.filter(r => r.cp_id).map(r => r.cp_id);
        if (ids.length > 0) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/cat/item/list/${ids.join(',')}?routeToDetails=1`);
            window.open(url);
        }
    }


    showPatron(rows: any[]) {

        const usrIds = Array.from(new Set( rows.map(r => r.usr_id).filter( usr_id => Boolean(usr_id)) ));
        // Browser only allows one window.open() per click

        if (usrIds.length > 0) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/circ/patron/${usrIds[0]}/checkout`);
            window.open(url);
        }
    }

    showOrder(rows: any[]) {
        // Doesn't work in Typescript currently without compiler option:
        //   const bibIds = [...new Set( rows.map(r => r.record_id) )];
        const bibIds = Array.from(
          new Set( rows.filter(r => r.hold_type !== 'M').map(r => r.record_id) ));
        bibIds.forEach( bibId => {
          const url =
              '/eg/staff/acq/legacy/lineitem/related/' + bibId + '?target=bib';
          window.open(url, '_blank');
        });
    }

    addVolume(rows: any[]) {
        const bibIds = Array.from(
          new Set( rows.filter(r => r.hold_type !== 'M').map(r => r.record_id) ));
        bibIds.forEach( bibId => {
          this.holdings.spawnAddHoldingsUi(bibId);
        });
    }

    showTitle(rows: any[]) {
        const bibIds = Array.from(new Set( rows.map(r => r.record_id) ));
        bibIds.forEach( bibId => {
          // const url = '/eg/staff/cat/catalog/record/' + bibId;
          const url = '/eg2/staff/catalog/record/' + bibId;
          window.open(url, '_blank');
        });
    }

    showManageDialog(rows: any[]) {
        const holdIds = rows.map(r => r.id).filter(id => Boolean(id));
        if (holdIds.length > 0) {

            if (holdIds.length === 1) {
                this.manageDialog.title = rows[0].title;
            } else {
                this.manageDialog.title = null;
            }

            this.manageDialog.holdIds = holdIds;
            this.manageDialog.open({size: 'lg'}).subscribe(
                rowsModified => {
                    if (rowsModified) {
                        this.holdsGrid.reload();
                    }
                }
            );
        }
    }

    showTransferDialog(rows: any[]) {
        const holdIds = rows
            .filter(r => r.hold_type === 'T')
            .filter(r => !Boolean(r.cancel_time))
            .filter(r => !Boolean(r.fulfillment_time))
            .filter(r => !Boolean(r.capture_time))
            .filter(r => !Boolean(r.current_copy)) // Targeted
            .filter(r => Boolean(r.id))
            .map(r => r.id);

        if (holdIds.length > 0) {
            this.transferDialog.holdIds = holdIds;
            this.transferDialog.open({}).subscribe(
                rowsModified => {
                    if (rowsModified) {
                        this.holdsGrid.reload();
                    }
                }
            );
        }
    }

    async showMarkDamagedDialog(rows: any[]) {
        const copyIds = rows.map(r => r.cp_id).filter(id => Boolean(id));
        if (copyIds.length === 0) { return; }

        let rowsModified = false;

        const markNext = async(ids: number[]) => {
            if (ids.length === 0) {
                return Promise.resolve();
            }

            this.markDamagedDialog.copyId = ids.pop();
            return this.markDamagedDialog.open({size: 'lg'}).subscribe(
                ok => {
                    if (ok) { rowsModified = true; }
                    return markNext(ids);
                },
                dismiss => markNext(ids)
            );
        };

        await markNext(copyIds);
        if (rowsModified) {
            this.holdsGrid.reload();
        }
    }

    showMarkMissingDialog(rows: any[]) {
        const copyIds = rows.map(r => r.cp_id).filter(id => Boolean(id));
        if (copyIds.length > 0) {
            this.markMissingDialog.copyIds = copyIds;
            this.markMissingDialog.open({}).subscribe(
                rowsModified => {
                    if (rowsModified) {
                        this.holdsGrid.reload();
                    }
                }
            );
        }
    }

    showMarkDiscardDialog(rows: any[]) {
        const copyIds = rows.map(r => r.cp_id).filter(id => Boolean(id));
        if (copyIds.length > 0) {
            this.markDiscardDialog.copyIds = copyIds;
            this.markDiscardDialog.open({}).subscribe(
                rowsModified => {
                    if (rowsModified) {
                        this.holdsGrid.reload();
                    }
                }
            );
        }
    }


    showRetargetDialog(rows: any[]) {
        const holdIds = rows.map(r => r.id).filter(id => Boolean(id));
        if (holdIds.length > 0) {
            this.retargetDialog.holdIds = holdIds;
            this.retargetDialog.open({}).subscribe(
                rowsModified => {
                    if (rowsModified) {
                        this.holdsGrid.reload();
                    }
                }
            );
        }
    }

    setTopOfQueue(rows: any[], undo?: boolean) {
        const holdIds = rows.map(r => r.id).filter(id => Boolean(id));
        if (holdIds.length === 0) { return; }

        const holds = [];
        this.pcrud.search('ahr', {id: holdIds})
        .pipe(tap(hold => {
            hold.cut_in_line(undo ? 'f' : 't');
            holds.push(hold);
        })).toPromise()
        .then(_ => this.holds.updateHolds(holds).toPromise())
        .then(_ => this.holdsGrid.reload());
    }

    activateHolds(rows: any[]) {
        const holdIds = rows.map(r => r.id).filter(id => Boolean(id));
        if (holdIds.length === 0) { return; }

        const holds = [];
        this.pcrud.search('ahr', {id: holdIds})
        .pipe(tap(hold => {
            hold.frozen('f');
            hold.thaw_date(null);
            holds.push(hold);
        })).toPromise()
        .then(_ => this.holds.updateHolds(holds).toPromise())
        .then(_ => this.holdsGrid.reload());
    }

    showCancelDialog(rows: any[]) {
        const holdIds = rows.map(r => r.id).filter(id => Boolean(id));
        if (holdIds.length > 0) {
            this.cancelDialog.holdIds = holdIds;
            this.cancelDialog.open({}).subscribe(
                rowsModified => {
                    if (rowsModified) {
                        this.holdsGrid.reload();
                    }
                }
            );
        }
    }

    showUncancelDialog(rows: any[]) {
        const holdIds = rows.map(r => r.id).filter(id => Boolean(id));
        if (holdIds.length === 0) { return; }
        this.uncancelHoldCount = holdIds.length;

        this.uncancelDialog.open().subscribe(confirmed => {
            if (!confirmed) { return; }
            this.progressDialog.reset();
            this.progressDialog.open();

            from(holdIds).pipe(concatMap(holdId => {

                let notified = false;
                return this.net.request(
                    'open-ils.circ',
                    'open-ils.circ.hold.uncancel',
                    this.auth.token(), holdId
                ).pipe(tap(resp => {
                    console.debug("Hold un-cancel returned: ", JSON.stringify(resp));

                    // Sometimes an error event will be returned from the
                    // API before the trailing "1" is returned.
                    if (notified) { return; }
                    notified = true;

                    if (Number(resp) === 1 || !resp?.result?.last_event) {
                        this.toast.success(this.uncancelSuccess.text);
                        return;
                    }

                    console.error('Failed uncanceling hold', resp);
                    const evt = this.evt.parse(resp?.result?.last_event);
                    const str = evt ? evt.toString() : 'Unknown Error';

                    this.uncancelFail.dialogBody = str;
                    this.progressDialog.close();

                    setTimeout(() => this.uncancelFail.open());

                }));
            }))
            .toPromise().then(_ => {
                this.progressDialog.close();
                this.holdsGrid.reload();
            });
        });
    }

    printHolds() {
        // Request a page with no limit to get all of the wide holds for
        // printing.  Call requestPage() directly instead of grid.reload()
        // since we may already have the data.

        const pager = new Pager();
        pager.offset = 0;
        pager.limit = null;

        if (this.gridDataSource.sort.length === 0) {
            this.gridDataSource.sort = this.defaultSort;
        }

        // If paging is disabled, we already have all the data.
        const promise = this.disablePaging ? Promise.resolve() :
            this.gridDataSource.requestPage(pager);

        promise.then(_ => {

            // Propagate the post-clear action into the print data
            this.gridDataSource.data.forEach(hold => {
                hold.post_clear = this.getPostClearLabel(
                    this.clearHoldsActions[Number(hold.id)]);
            });

            if (this.gridDataSource.data.length === 0) { return; }

            if (this.shelfOrg) {
                // After initiating a print, disable the print button
                // for a few seconds until something meaningful can happen
                // on the print side.  We can't say for sure when printing
                // is done.
                this.disablePrint = true;
                setTimeout(() => this.disablePrint = false, 10_000);
            }

            this.printer.print({
                templateName: this.printTemplate || 'holds_for_bib',
                contextData: this.gridDataSource.data,
                printContext: 'default',
                // KCLS always uses browser printing when processing
                // huge lists of holds.
                printerName: this.shelfOrg ? HATCH_BROWSER_PRINTING_PRINTER : null
            });

        });
    }

    isCopyHold(holdData: any): boolean {
        if (holdData && holdData.hold_type) {
            return holdData.hold_type.match(/C|R|F/) !== null;
        } else {
            return false;
        }
    }

    clearHolds() {
        setTimeout(() => {
            this.progressDialog.reset();
            this.progressDialog.open();
        });

        this.clearHoldsExecuted = true;
        this.clearHoldsActions = {};

        let cacheKey;

        this.net.request(
            'open-ils.circ',
            'open-ils.circ.hold.clear_shelf.process',
            this.auth.token(), this.shelfOrg, null, 1
        ).subscribe(
            resp => {

                cacheKey = resp.cache_key;

                const progress: any = {};
                if (resp.maximum) { progress.max = resp.maximum; }
                if (resp.progress) { progress.value = resp.progress; }

                console.debug('Updating progress with', resp);

                if (progress.max || progress.value) {
                    this.progressDialog.update(progress);
                }
            },
            err => {
                console.error(err);
                this.progressDialog.close();
            },
            () => {
                this.getClearHoldsCache(cacheKey);
            }
        );
    }

    getClearHoldsCache(cacheKey: string) {

        const handleOneResponse = (resp: any) => {

            [].concat(resp).forEach(info => {

                console.debug('Updating progress with', info);

                if (info.action) { // some updates are just progress info

                    const holdId = Number(info.hold_details.id);
                    this.clearHoldsActions[holdId] = info.action;

                    const hold = this.gridDataSource.data
                        .filter(h => Number(h.id) === holdId)[0];

                    hold.cs_name = info.hold_details.cs_name;
                    hold.hold_status = info.hold_details.hold_status;
                }

                const progress: any = {};
                if (info.maximum) { progress.max = info.maximum; }
                if (info.progress) { progress.value = info.progress; }

                if (progress.max || progress.value) {
                    this.progressDialog.update(progress);
                }
            });
        };

        this.net.request(
            'open-ils.circ',
            'open-ils.circ.hold.clear_shelf.get_cache',
            this.auth.token(), cacheKey, 1
        ).subscribe(
            resp => handleOneResponse(resp),
            err => {
                console.error(err);
                this.progressDialog.close();
            },
            () => {
                this.printHolds();
                this.progressDialog.close();
                this.disablePrint = false;
            }
        );
    }

    getPostClearLabel(action: string): string {
        switch (action) {
            case 'shelf': return this.postClearShelf.text;
            case 'hold': return this.postClearHold.text;
            case 'transit': return this.postClearTransit.text;
            case 'pl_changed': return this.postClearPlChanged.text;
        }
        return '';
    }
}




