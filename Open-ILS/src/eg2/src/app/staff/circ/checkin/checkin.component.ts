import {Component, ViewChild, OnInit, AfterViewInit, HostListener} from '@angular/core';
import {Location} from '@angular/common';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {empty, from} from 'rxjs';
import {concatMap, tap} from 'rxjs/operators';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {PatronService} from '@eg/staff/share/patron/patron.service';
import {GridDataSource, GridColumn, GridCellTextGenerator} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {CircService, CircDisplayInfo, CheckinParams, CheckinResult
    } from '@eg/staff/share/circ/circ.service';
import {BarcodeSelectComponent
    } from '@eg/staff/share/barcodes/barcode-select.component';
import {PrintService} from '@eg/share/print/print.service';
import {CopyAlertsDialogComponent
    } from '@eg/staff/share/holdings/copy-alerts-dialog.component';
import {BucketDialogComponent
    } from '@eg/staff/share/buckets/bucket-dialog.component';
import {ToastService} from '@eg/share/toast/toast.service';
import {StringComponent} from '@eg/share/string/string.component';
import {BackdateDialogComponent} from '@eg/staff/share/circ/backdate-dialog.component';
import {CancelTransitDialogComponent
    } from '@eg/staff/share/circ/cancel-transit-dialog.component';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {AnonCacheService} from '@eg/share/util/anon-cache.service';
import {DateSelectNativeComponent
    } from '@eg/share/date-select-native/date-select-native.component';


interface CheckinGridEntry extends CheckinResult {
    // May need to extend...
    foo?: number; // Empty interfaces are not allowed.
}

const TRIM_LIST_TO = 20;

const CHECKIN_MODIFIERS = [
    'void_overdues',
    'clear_expired',
    'hold_as_transit',
    'manual_float',
    'no_precat_alert',
    'retarget_holds',
    'retarget_holds_all',
    'noop',
    'auto_print_holds_transits',
    'auto_print_ill_receipt',
    'auto_print_transits',
    'do_inventory_update'
];

const SETTINGS = [
    'circ.checkin.strict_barcode'
];

@Component({
  templateUrl: 'checkin.component.html',
  styleUrls: ['checkin.component.css']
})
export class CheckinComponent implements OnInit, AfterViewInit {
    checkins: CheckinGridEntry[] = [];
    autoIndex = 0;

    barcode: string;
    backdate: string;
    backdateDate: any;
    backdateUntilLogout = false;
    fineTally = 0;
    isHoldCapture = false;
    strictBarcode = false;
    trimList = false;
    itemNeverCirced: string;
    persistKey: string;

    gridDataSource: GridDataSource = new GridDataSource();
    cellTextGenerator: GridCellTextGenerator;

    modifiers: {[key: string]: boolean} = {};

    private copiesInFlight: {[barcode: string]: boolean} = {};

    @ViewChild('grid') private grid: GridComponent;
    @ViewChild('barcodeSelect') private barcodeSelect: BarcodeSelectComponent;
    @ViewChild('copyAlertsDialog') private copyAlertsDialog: CopyAlertsDialogComponent;
    @ViewChild('bucketDialog') private bucketDialog: BucketDialogComponent;
    @ViewChild('itemNeverCircedStr') private itemNeverCircedStr: StringComponent;
    @ViewChild('backdateDialog') private backdateDialog: BackdateDialogComponent;
    @ViewChild('cancelTransitDialog') private cancelTransitDialog: CancelTransitDialogComponent;
    @ViewChild('backdateSelect') private backdateSelect: DateSelectNativeComponent;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private ngLocation: Location,
        private net: NetService,
        private org: OrgService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private store: ServerStoreService,
        private circ: CircService,
        private toast: ToastService,
        private printer: PrintService,
        private holdings: HoldingsService,
        private anonCache: AnonCacheService,
        public patronService: PatronService
    ) {}

    ngOnInit() {

        this.route.data.subscribe(data => {
            if (data && data.capture) {
                this.isHoldCapture = true;
                this.persistKey = 'circ.checkin.capture';
            } else {
                this.isHoldCapture = false;
                this.persistKey = 'circ.checkin.checkin';
            }
        });

        this.gridDataSource.getRows = (pager: Pager, sort: any[]) => {
            return from(this.checkins);
        };

        const setNames =
            CHECKIN_MODIFIERS.map(mod => `eg.circ.checkin.${mod}`)
            .concat(SETTINGS);

        this.store.getItemBatch(setNames).then(sets => {
            CHECKIN_MODIFIERS.forEach(mod =>
                this.modifiers[mod] = sets[`eg.circ.checkin.${mod}`]);

            this.strictBarcode = sets['circ.checkin.strict_barcode'];

            if (this.isHoldCapture) {
                // In hold capture mode, some modifiers are forced
                // regardless of preferences.
                this.modifiers.noop = false;
                this.modifiers.auto_print_holds_transits = true;
            }
        }).then(_ => this.circ.applySettings());
    }

    ngAfterViewInit() {
        this.focusInput();
    }

    focusInput() {
        const input = document.getElementById('barcode-input');
        if (input) { input.focus(); }
    }

    checkin(params?: CheckinParams, override?: boolean): Promise<CheckinResult> {
        if (!this.barcode) { return Promise.resolve(null); }
        if (this.backdateSelect.invalid()) { return Promise.resolve(null); }

        const promise = params ? Promise.resolve(params) : this.collectParams();

        return promise.then((collectedParams: CheckinParams) => {
            if (!collectedParams) { return null; }

            if (this.copiesInFlight[this.barcode]) {
                console.debug('Item ' + this.barcode + ' is already mid-checkin');
                return null;
            }

            this.copiesInFlight[this.barcode] = true;
            return this.circ.checkin(collectedParams);
        })

        .then((result: CheckinResult) => {
            if (result && result.success) {
                this.gridifyResult(result);
            }
            delete this.copiesInFlight[this.barcode];
            this.resetForm();
            return result;
        })

        .finally(() => delete this.copiesInFlight[this.barcode]);
    }

    collectParams(): Promise<CheckinParams> {

        const params: CheckinParams = {
            copy_barcode: this.barcode,
            backdate: this.backdate,
            _checkbarcode: this.strictBarcode
        };

        Object.keys(this.modifiers).forEach(mod => {
            if (this.modifiers[mod]) {
                if (mod === 'retarget_holds') {
                    params.retarget_mode = 'retarget';
                } else if (mod === 'retarget_holds_all') {
                    params.retarget_mode = 'retarget.all';
                } else {
                    params[mod] = true;
                }
            }
        });

        return this.barcodeSelect.getBarcode('asset', this.barcode)
        .then(selection => {
            if (selection) {
                params.copy_id = selection.id;
                params.copy_barcode = selection.barcode;
                return params;
            } else {
                // User canceled the multi-match selection dialog.
                return null;
            }
        });
    }

    resetForm() {
        this.barcode = '';
        this.focusInput();
    }

    gridifyResult(result: CheckinResult) {
        const entry: CheckinGridEntry = result;
        entry.index = this.autoIndex++;

        if (result.copy) {
            result.copy.circ_lib(this.org.get(result.copy.circ_lib()));
        }

        if (result.mbts) {
            this.fineTally =
                ((this.fineTally * 100) + (result.mbts.balance_owed() * 100)) / 100;
        }

        this.checkins.unshift(entry);

        if (this.trimList && this.checkins.length >= TRIM_LIST_TO) {
            this.checkins.length = TRIM_LIST_TO;
        }

        this.grid.context.reload();
    }

    toggleMod(mod: string) {
        if (this.modifiers[mod]) {
            this.modifiers[mod] = false;
            this.store.removeItem('eg.circ.checkin.' + mod);
        } else {
            this.modifiers[mod] = true;
            this.store.setItem('eg.circ.checkin.' + mod, true);
        }
    }

    toggleStrictBarcode(active: boolean) {
        if (active) {
            this.store.setItem('circ.checkin.strict_barcode', true);
        } else {
            this.store.removeItem('circ.checkin.strict_barcode');
        }
    }

    printReceipt(selected?: boolean) {
        if (selected && this.grid.context.getSelectedRows().length == 0) {
            this.toast.warning($localize`Please select rows to print`);
            return;
        }

        let checkins = selected ? this.grid.context.getSelectedRows() : this.checkins;

        this.printer.print({
            printContext: 'default',
            templateName: 'checkin',
            contextData: {checkins: checkins}
        });
    }

    hasAlerts(): boolean {
        return (
            Boolean(this.backdate) ||
            Object.keys(this.modifiers).filter(mod => this.modifiers[mod]).length > 0
        );
    }

    getCopyIds(rows: CheckinGridEntry[], skipStatus?: number): number[] {
        return this.getCopies(rows, skipStatus).map(c => Number(c.id()));
    }

    getCopies(rows: CheckinGridEntry[], skipStatus?: number): IdlObject[] {
        let copies = rows.filter(r => r.copy).map(r => r.copy);
        if (skipStatus) {
            copies = copies.filter(
                c => Number(c.status().id()) !== Number(skipStatus));
        }
        return copies;
    }


    markDamaged(rows: CheckinGridEntry[]) {
        const copyId = this.getCopyIds(rows)[0];
        if (!copyId) { return; }

        const url = this.ngLocation.prepareExternalUrl(
            `/staff/cat/item/damaged/${copyId}/`);

        window.open(url);
    }

    addItemAlerts(rows: CheckinGridEntry[]) {
        const copyIds = this.getCopyIds(rows);
        if (copyIds.length === 0) { return; }

        this.copyAlertsDialog.copyIds = copyIds;
        this.copyAlertsDialog.mode = 'create';
        this.copyAlertsDialog.open({size: 'lg'}).subscribe();
    }

    manageItemAlerts(rows: CheckinGridEntry[]) {
        const copyIds = this.getCopyIds(rows);
        if (copyIds.length === 0) { return; }

        this.copyAlertsDialog.copyIds = copyIds;
        this.copyAlertsDialog.mode = 'manage';
        this.copyAlertsDialog.open({size: 'lg'}).subscribe();
    }

    openBucketDialog(rows: CheckinGridEntry[]) {
        const copyIds = this.getCopyIds(rows);
        if (copyIds.length > 0) {
            this.bucketDialog.bucketClass = 'copy';
            this.bucketDialog.itemIds = copyIds;
            this.bucketDialog.open({size: 'lg'});
        }
    }

    retrieveLastPatron(rows: CheckinGridEntry[]) {
        const copy = this.getCopies(rows).pop();
        if (!copy) { return; }

        this.circ.lastCopyCirc(copy.id()).then(circ => {
            if (circ) {

                const url = this.ngLocation.prepareExternalUrl(
                    `/staff/circ/patron/${circ.usr()}/checkout`);

                window.open(url);

            } else {
                this.itemNeverCirced = copy.barcode();
                setTimeout(() => this.toast.danger(this.itemNeverCircedStr.text));
            }
        });
    }

    backdatePostCheckin(rows: CheckinGridEntry[]) {
        const circs = rows.map(r => r.circ).filter(circ => Boolean(circ));
        if (circs.length === 0) { return; }

        this.backdateDialog.circIds = circs.map(c => c.id());
        this.backdateDialog.open().subscribe(backdate => {
            if (backdate) {
                circs.forEach(circ => circ.checkin_time(backdate));
            }
        });
    }

    markMissingPieces(rows: CheckinGridEntry[]) {
        const copyId = this.getCopyIds(rows)[0];
        if (copyId) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/cat/item/missing_pieces/${copyId}`);
            window.open(url);
        }
    }

    updateCopyStatus(rows: CheckinGridEntry[]): Promise<any> {
        const copies = rows.filter(r => Boolean(r.copy)).map(r => r.copy);

        if (copies.length === 0) { return Promise.resolve(); }

        return from(copies).pipe(concatMap(copy => {
            return this.pcrud.retrieve('acp',
                copy.id(), {flesh: 1, flesh_fields: {acp: ['status']}})
            .pipe(tap(c => copy.status(c.status())))
        })).toPromise();
    }

    cancelTransits(rows: CheckinGridEntry[]) {

        rows = rows.filter(row => row.copy && row.copy.status().id() === 6);

        // Copies in transit are not always accompanied by their transit.
        from(rows).pipe(concatMap(row => {
            return from(
                this.circ.findCopyTransit(row)
                .then(transit => row.transit = transit)
            );
        }))
        .toPromise().then(_ => {

            const ids = rows
                .filter(row => Boolean(row.transit))
                .map(row => row.transit.id());

            if (ids.length > 0) {
                this.cancelTransitDialog.transitIds = ids;
                return this.cancelTransitDialog.open().toPromise();
            }
        })
        .then(changesMade => {
            if (changesMade) {
                return this.updateCopyStatus(rows);
            }
        });
    }

    showRecordHolds(rows: CheckinGridEntry[]) {

        const row = rows[0];
        if (row.record) {
            const id = row.record.doc_id();

            const url = this.ngLocation.prepareExternalUrl(
                `/staff/catalog/record/${id}/holds`);

            window.open(url);
        }
    }

    showRecentCircs(rows: CheckinGridEntry[]) {
        const copyId = this.getCopyIds(rows)[0];
        if (copyId) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/cat/item/${copyId}/circs`);
            window.open(url);
        }
    }

    showItemDetails(rows: CheckinGridEntry[]) {
        const copyId = this.getCopyIds(rows)[0];
        if (copyId) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/cat/item/${copyId}/summary`);
            window.open(url);
        }
    }

    editHoldings(rows: CheckinGridEntry[]) {
        const ids = this.getCopyIds(rows);
        if (ids.length === 0) { return; }

        this.holdings.spawnAddHoldingsUi(null, null, null, ids);
    }

    editItems(rows: CheckinGridEntry[]) {
        const ids = this.getCopyIds(rows);
        if (ids.length === 0) { return; }

        this.holdings.spawnAddHoldingsUi(null, null, null, ids, false, true);
    }


    openItemPrintLabels(rows: CheckinGridEntry[]) {
        const ids = this.getCopyIds(rows);
        if (ids.length === 0) { return; }

        this.anonCache.setItem(null, 'print-labels-these-copies', {copies: ids})
        .then(key => {
            const url = `/eg/staff/cat/printlabels/${key}`;
            window.open(url);
        });
    }
}

