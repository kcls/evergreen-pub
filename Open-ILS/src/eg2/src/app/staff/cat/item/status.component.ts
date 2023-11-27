import {Component, ChangeDetectorRef, Input, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {NgZone} from '@angular/core';
import {Location} from '@angular/common';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {from, of, empty} from 'rxjs';
import {concatMap, tap} from 'rxjs/operators';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {OrgService} from '@eg/core/org.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {NetService} from '@eg/core/net.service';
import {PrintService} from '@eg/share/print/print.service';
import {StoreService} from '@eg/core/store.service';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {EventService} from '@eg/core/event.service';
import {BarcodeSelectComponent} from '@eg/staff/share/barcodes/barcode-select.component';
import {CatalogService} from '@eg/share/catalog/catalog.service';
import {CircService, ItemCircInfo} from '@eg/staff/share/circ/circ.service';
import {NgbNav, NgbNavChangeEvent} from '@ng-bootstrap/ng-bootstrap';
import {ProgressDialogComponent} from '@eg/share/dialog/progress.component';
import {WorkLogService, WorkLogEntry} from '@eg/staff/share/worklog/worklog.service';
import {CancelTransitDialogComponent
    } from '@eg/staff/share/circ/cancel-transit-dialog.component';
import {CopyAlertsDialogComponent
    } from '@eg/staff/share/holdings/copy-alerts-dialog.component';
import {ReplaceBarcodeDialogComponent
    } from '@eg/staff/share/holdings/replace-barcode-dialog.component';
import {DeleteHoldingDialogComponent
    } from '@eg/staff/share/holdings/delete-volcopy-dialog.component';
import {BucketDialogComponent
    } from '@eg/staff/share/buckets/bucket-dialog.component';
import {ConjoinedItemsDialogComponent
    } from '@eg/staff/share/holdings/conjoined-items-dialog.component';
import {MakeBookableDialogComponent
    } from '@eg/staff/share/booking/make-bookable-dialog.component';
import {TransferItemsComponent
    } from '@eg/staff/share/holdings/transfer-items.component';
import {TransferHoldingsComponent
    } from '@eg/staff/share/holdings/transfer-holdings.component';
import {AlertDialogComponent} from '@eg/share/dialog/alert.component';
import {MarkDamagedDialogComponent
    } from '@eg/staff/share/holdings/mark-damaged-dialog.component';
import {MarkMissingDialogComponent
    } from '@eg/staff/share/holdings/mark-missing-dialog.component';
import {AnonCacheService} from '@eg/share/util/anon-cache.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {StringService} from '@eg/share/string/string.service';
import {StringComponent} from '@eg/share/string/string.component';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';
import {MarkItemsDialogComponent
    } from '@eg/staff/share/holdings/mark-items-dialog.component';
import {GridDataSource, GridColumn, GridCellTextGenerator,
    GridRowFlairEntry} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {ItemStatusService} from './item.service';
import {BroadcastService} from '@eg/share/util/broadcast.service';
import {ArrayUtil} from '@eg/share/util/array';

@Component({
  templateUrl: 'status.component.html'
})

export class ItemStatusComponent implements OnInit, AfterViewInit {
    // Use for grid row indexes, since the grid may include multiple
    // copies of a given item.
    static rowIndex = 0;

    currentItemId: number;
    itemBarcode: string;
    noSuchItem: string = null;
    item: IdlObject;
    tab: string;
    preloadCopyIds: number[];

    // Open the detail page for the first item in the list when the
    // list view is selected with a set of preloaded copy IDs.
    routeToDetails = false;

    rowFlair: (row: IdlObject) => GridRowFlairEntry;
    cellTextGenerator: GridCellTextGenerator;
    dataSource: GridDataSource = new GridDataSource();
    @ViewChild('grid') private grid: GridComponent;

    @ViewChild('barcodeSelect') private barcodeSelect: BarcodeSelectComponent;

    @ViewChild('markDamagedDialog')
        private markDamagedDialog: MarkDamagedDialogComponent;
    @ViewChild('markMissingDialog')
        private markMissingDialog: MarkMissingDialogComponent;
    @ViewChild('copyAlertsDialog')
        private copyAlertsDialog: CopyAlertsDialogComponent;
    @ViewChild('replaceBarcode')
        private replaceBarcode: ReplaceBarcodeDialogComponent;
    @ViewChild('deleteHolding')
        private deleteHolding: DeleteHoldingDialogComponent;
    @ViewChild('bucketDialog')
        private bucketDialog: BucketDialogComponent;
    @ViewChild('conjoinedDialog')
        private conjoinedDialog: ConjoinedItemsDialogComponent;
    @ViewChild('makeBookableDialog')
        private makeBookableDialog: MakeBookableDialogComponent;
    @ViewChild('transferItems')
        private transferItems: TransferItemsComponent;
    @ViewChild('transferHoldings')
        private transferHoldings: TransferHoldingsComponent;
    @ViewChild('transferAlert')
        private transferAlert: AlertDialogComponent;
    @ViewChild('progressDialog')
        private progressDialog: ProgressDialogComponent;
    @ViewChild('cancelTransitDialog')
        private cancelTransitDialog: CancelTransitDialogComponent;
    @ViewChild('markItemsDialog')
        private markItemsDialog: MarkItemsDialogComponent;
    @ViewChild('itemModified')
        private itemModified: StringComponent;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private ngZone: NgZone,
        private ngLocation: Location,
        private changeDetector: ChangeDetectorRef,
        private net: NetService,
        private idl: IdlService,
        private printer: PrintService,
        private store: StoreService,
        private pcrud: PcrudService,
        private org: OrgService,
        private auth: AuthService,
        private circ: CircService,
        private evt: EventService,
        private cat: CatalogService,
        private worklog: WorkLogService,
        private holdings: HoldingsService,
        private toast: ToastService,
        private strings: StringService,
        private anonCache: AnonCacheService,
        private broadcaster: BroadcastService,
        private itemService: ItemStatusService
    ) {}

    ngOnInit() {

        this.currentItemId = +this.route.snapshot.paramMap.get('id');
        this.tab = this.route.snapshot.paramMap.get('tab');

        const copyIdList = this.route.snapshot.paramMap.get('copyIdList');

        this.route.queryParams.subscribe(params => {
            this.routeToDetails = params.routeToDetails;
        });

        if (copyIdList && !this.itemService.preloadItemsLoaded) {
            this.itemService.preloadItemsLoaded = true;
            this.preloadCopyIds =
                ArrayUtil.unique(copyIdList.split(',').map(id => Number(id)));
        }

        if (!this.tab) {
            if (this.currentItemId) {
                this.tab = 'summary';
            } else {
                this.tab = 'list';
            }
        }

        this.broadcaster.listen('eg.holdings.update').subscribe(data => {
            if (data && data.copies) {
                const copies = [];
                this.itemService.scannedItems.forEach(item => {
                    if (data.copies.includes(item.id())) {
                        item.ischanged(true); // for grid flair
                        copies.push(item);
                    }
                });

                if (copies.length > 0) {
                    this.refreshSelectCopies(copies);
                }
            }
        });

        this.rowFlair = (row: IdlObject) => {

            if (row.ischanged()) {
                return {icon: 'save', title: this.itemModified.text};
            }
        };

        this.dataSource.getRows = (pager: Pager, sort: any[]) => {
            return from(this.itemService.scannedItems);
        };

        this.cellTextGenerator = {

            title: row => {
                if (row.call_number().id() === -1) {
                    return row.dummy_title();
                } else {
                    return row.call_number().record().simple_record().title();
                }
            },
            call_number_label: row => {
                return  row.call_number().prefix().label() + ' ' +
                        row.call_number().label() + ' ' +
                        row.call_number().suffix().label();
            }
        };

        this.worklog.loadSettings()
        .then(_ => this.cat.fetchCcvms())
        .then(_ => this.cat.fetchCmfs())
        .then(_ => {

            if (this.currentItemId) {

                return this.getItemById(this.currentItemId)
                .then(item => this.item = item);

            } else if (this.preloadCopyIds) {

                return from(this.preloadCopyIds).pipe(concatMap(id => {
                    return of(this.getItemById(id));
                })).toPromise()
                .then(__ => this.preloadCopyIds = null)
                .then(__ => {
                    if (this.routeToDetails) {
                        this.routeToDetails = false;
                        this.showDetails();
                    }
                });
            }
        })
        .then(_ => {

            // Avoid watching for changes until after ngOnInit is complete
            // so we don't grab the same copy twice.
            this.route.paramMap.subscribe((params: ParamMap) => {
                this.tab = params.get('tab');
                const id = +params.get('id');

                if (id) {
                    if (!this.tab) { this.tab = 'summary'; }

                    if (id !== this.currentItemId) {
                        this.currentItemId = id;
                        this.getItemById(id);
                    }
                } else if (!this.tab) {
                    this.tab = 'list';
                }
            });
        });
    }

    // Refresh items that were acted on by a grid action and splice them.
    refreshSelectCopies(copies: IdlObject[]): Promise<any> {
        return from(copies).pipe(concatMap(copy => {
            const promise = this.getItemById(copy.id(), true)
            .then(updatedCopy => {
                if (this.item && updatedCopy.id() === this.item.id()) {
                    this.item = updatedCopy;
                }
                this.itemService.scannedItems.forEach((item, idx) => {
                    if (item.id() === updatedCopy.id()) {
                        // Retain the original grid index value so row
                        // selection can persist.
                        updatedCopy._index = item._index;
                        // Assume a reloaded copy was changed in some way.
                        updatedCopy.ischanged(true);
                        this.itemService.scannedItems.splice(idx, 1, updatedCopy);
                    }
                });
            });

            return from(promise);
        })).toPromise().then(_ => {
            if (this.grid) {
                this.ngZone.run(() => {
                    // Run here to force change detection
                    // Note that this.changeDetector.detectChanges, which
                    // also forces detection, breaks our grid context menus :\
                    this.grid.context.reloadSync();
                });
            }
        });
    }

    ngAfterViewInit() {
        this.selectInput();
    }

    tabChange(evt: NgbNavChangeEvent) {
        this.router.navigate([`/staff/cat/item/${this.currentItemId}/${evt.nextId}`]);
    }

    fileSelected($event) {
        const file: File = $event.target.files[0];
        const reader = new FileReader();

        reader.onload = e => {
            const list = e.target.result as string;
            if (!list) { return; }

            const barcodes = [];
            list.split(/\r?\n/).forEach(line => {
                line = line.replace(/[\s,]+/g, '');
                if (line) {
                    barcodes.push(line);
                }
            });

            if (barcodes.length > 0) {
                this.getItemsFromBarcodes(barcodes);
            }
        };

        reader.readAsText(file);
    }

    getItemFromBarcodeInput(): Promise<any> {
        this.currentItemId = null;
        this.item = null;

        if (!this.itemBarcode) { return Promise.resolve(); }

        // The barcode may be a comma-separated list of values.
        const barcodes = [];
        this.itemBarcode.split(/,/).forEach(bc => {
            bc = bc.replace(/[\s,]+/g, '');
            if (bc) { barcodes.push(bc); }
        });

        return this.getItemsFromBarcodes(barcodes)
        .then(_ => this.selectInput());
    }

    getItemsFromBarcodes(barcodes: string[]): Promise<any> {
        let index = 0;
        this.noSuchItem = null;

        return from(barcodes).pipe(concatMap(bc => {

            const promise = this.getOneItemFromBarcode(bc)
            .then(_ => {
                if (++index < barcodes.length) { return; }
                if (this.tab === 'list') { return; }

                // When entering multiple items via input or file
                // on a non-list page, show the detail view of the
                // last item loaded.
                if (this.itemService.scannedItems.length > 0) {
                    this.item = this.itemService.scannedItems[0];
                    const id = this.item.id();
                    this.router.navigate([`/staff/cat/item/${id}/${this.tab}`]);
                }
            });

            return from(promise);

        })).toPromise();
    }

    getOneItemFromBarcode(barcode: string): Promise<any> {
        return this.barcodeSelect.getBarcode('asset', barcode)
        .then(res => {
            if (!res) {
                // Dialog was canceled, nothing to do
            } else if (!res.id) {
                this.noSuchItem = barcode;
            } else {
                this.itemBarcode = null;
                if (this.tab === 'list') {
                    this.selectInput();
                }
                return this.getItemById(res.id, false, true);
            }
        });
    }

    selectInput() {
        setTimeout(() => {
            const node: HTMLInputElement =
                document.getElementById('item-barcode-input') as HTMLInputElement;
            if (node) { node.select(); }
        });
    }

    // In fetchOnly mode, item data is fetched but not added directly to
    // the grid.
    getItemById(id: number, fetchOnly?: boolean, fromUserAction?: boolean): Promise<any> {

        const flesh = {
            flesh : 4,
            flesh_fields : {
                acp : [
                    'call_number', 'location', 'status', 'floating', 'circ_modifier',
                    'age_protect', 'circ_lib', 'copy_alerts', 'creator',
                    'editor', 'circ_as_type', 'latest_inventory', 'floating'
                ],
                acn : ['record', 'prefix', 'suffix', 'label_class', 'owning_lib'],
                bre : ['simple_record', 'creator', 'editor'],
                alci : ['inventory_workstation']
            },
            select : {
                // avoid fleshing MARC on the bre
                // note: don't add simple_record.. not sure why
                bre : ['id', 'tcn_value', 'creator', 'editor', 'create_date', 'edit_date'],
            }
        };

        return this.pcrud.retrieve('acp', id, flesh)
        .toPromise().then(item => {
            this.mungeIsbns(item);
            this.selectInput();

            if (!fetchOnly) {
                item._index = ItemStatusComponent.rowIndex++;
                if (this.tab === 'list') {
                    this.itemService.scannedItems.unshift(item);
                } else {

                    // If a user scans a barcode that is already in
                    // the list, go ahead and append it.  Otherwise,
                    // avoid adding it to the list of scanned items.
                    // Otherwise, nav'ing from the list page back to
                    // the summary page will result in items getting
                    // duplicated in the scannedItems list.
                    if (fromUserAction) {
                        this.itemService.scannedItems.unshift(item);
                    } else {
                        const existing = this.itemService.scannedItems
                            .filter(c => c.id() === item.id())[0];
                        if (!existing) {
                            this.itemService.scannedItems.unshift(item);
                        }
                    }
                }
            }

            return this.getItemTransit(item)
            .then(_ => this.getItemCirc(item))
            .then(_ => {
                if (this.grid && !fetchOnly) {
                    this.grid.reload();
                }
                return item;
            });
        });
    }

    getItemTransit(item: IdlObject): Promise<any> {

        if (Number(item.status().id()) !== 6 /* in transit */) {
            return Promise.resolve();
        }

        return this.pcrud.search('atc',
            {target_copy: item.id()},
            {
                flesh: 1,
                flesh_fields: {atc: ['copy_status']},
                order_by: {atc: 'source_send_time DESC'},
                limit: 1
            }

        ).toPromise().then(transit => {
            if (transit) {
                item._transit_status = transit.copy_status();
                item._transit_source = this.org.get(transit.source());
                item._transit_dest = this.org.get(transit.dest());
            }
        });
    }

    getItemCirc(item: IdlObject): Promise<any> {
        return this.pcrud.search('circ',
            {target_copy: item.id()},
            {   flesh: 1,
                flesh_fields: {circ: ['workstation', 'checkin_workstation']},
                order_by: {circ: 'xact_start DESC'},
                limit: 1
            }
        ).toPromise().then(circ => {
            if (circ) {
                circ.circ_lib(this.org.get(circ.circ_lib()));
                item._circ = circ;
            }
        })
        .then(_ => this.circ.getItemCircInfo(item))
        .then(circInfo => {
            // Use the circ info circulation which may be a more
            // recent aged circulation.
            if (circInfo && circInfo.currentCirc) {
                item._circ = circInfo.currentCirc;

                // This version of the circ does not have a fleshed circ lib
                if (typeof item._circ.circ_lib() != 'object') {
                    item._circ.circ_lib(this.org.get(item._circ.circ_lib()));
                }
            }
        });
    }

    // A bit of cleanup to make the ISBN's look friendlier
    mungeIsbns(item: IdlObject) {
        const isbn = item.call_number().record().simple_record().isbn();
        if (isbn) {
            const matches = isbn.match(/"(.*?)"/g);
            item._isbns = matches ? matches.map(i => i.replace(/"/g, '')) : [];
        } else {
            item._isbns = [item.dummy_isbn()];
        }
    }

    openProgressDialog(copies: IdlObject[]): ProgressDialogComponent {
        this.progressDialog.update({value: 0, max: copies.length});
        this.progressDialog.open();
        return this.progressDialog;
    }

    addItemToBucket(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        this.bucketDialog.bucketClass = 'copy';
        this.bucketDialog.itemIds = ArrayUtil.unique(copies.map(c => c.id()));
        this.bucketDialog.open({size: 'lg'});
    }

    addRecordToBucket(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const recId = copies[0].call_number().record().id();
        this.bucketDialog.bucketClass = 'biblio';
        this.bucketDialog.itemIds = [recId];
        this.bucketDialog.open({size: 'lg'});
    }

    makeItemsBookable(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        this.makeBookableDialog.copyIds = ArrayUtil.unique(copies.map(c => c.id()));
        this.makeBookableDialog.open({});
    }

    bookItems(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const barcode = copies[0].barcode();
        this.router.navigate(
            ['/staff/booking/create_reservation/for_resource', barcode]);
    }

    manageReservations(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const barcode = copies[0].barcode();
        this.router.navigate(
            ['/staff/booking/manage_reservations/by_resource', barcode]);
    }

    requestItems(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        const params = {target: copies.map(c => c.id())};

        const url = this.ngLocation.prepareExternalUrl(
            this.router.serializeUrl(
                this.router.createUrlTree(
                    ['/staff/catalog/hold/C'], {queryParams: params}
                )
            )
        );

        window.open(url);
    }

    openConjoinedDialog(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        this.conjoinedDialog.copyIds = ArrayUtil.unique(copies.map(c => c.id()));
        this.conjoinedDialog.open({size: 'sm'});
    }

    deleteItems(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const callNumHash: any = {};

        // Collect the copies to be deleted, including their call numbers
        // since the API expects fleshed call number objects.
        copies.forEach(copy => {
            const callNum = copy.call_number();
            if (!callNumHash[callNum.id()]) {
                callNumHash[callNum.id()] = this.idl.clone(callNum);
                callNumHash[callNum.id()].copies([]);
            }
            const delCopy = this.idl.clone(copy);
            delCopy.isdeleted(true);
            callNumHash[callNum.id()].copies().push(delCopy);
        });

        if (Object.keys(callNumHash).length === 0) {
            // No data to process.
            return;
        }

        this.deleteHolding.callNums = Object.values(callNumHash);
        this.deleteHolding.open({size: 'sm'})
        .subscribe(modified => {
            if (modified) { this.refreshSelectCopies(copies); }
        });
    }

    checkinItems(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        const dialog = this.openProgressDialog(copies);

        let changesApplied = false;

        this.circ.checkinBatch(copies.map(c => c.id()))
        .subscribe(
            result => {
                if (result) { changesApplied = true; }
                dialog.increment();
            },
            err => {
                console.error('' + err);
                dialog.close();
            },
            () => {
                dialog.close();
                this.refreshSelectCopies(copies);
            }
        );
    }

    renewItems(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        const dialog = this.openProgressDialog(copies);

        let changesApplied = false;

        this.circ.renewBatch(copies.map(c => c.id()))
        .subscribe(
            result => {
                if (result) { changesApplied = true; }
                dialog.increment();
            },
            err => {
                console.error('' + err);
                dialog.close();
            },
            () => {
                dialog.close();
                this.refreshSelectCopies(copies);
            }
        );
    }

    cancelTransits(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        // Copies in transit are not always accompanied by their transit.
        const transitIds = [];
        let modified = false;

        from(copies).pipe(concatMap(c => {
            return from(
                this.circ.findCopyTransitById(c.id())
                .then(
                    transit => transitIds.push(transit.id()),
                    err => {}
                )
            );
        }))
        .toPromise()
        .then(_ => {

            if (transitIds.length === 0) { return; }

            this.cancelTransitDialog.transitIds = transitIds;
            this.cancelTransitDialog.open().subscribe(
                changes => {
                    if (changes) { modified = true; }
                },
                null,
                () => {
                    if (modified) { this.refreshSelectCopies(copies); }
                }
            );
        });
    }

    updateInventory(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        this.net.request(
            'open-ils.circ',
            'open-ils.circ.circulation.update_latest_inventory',
            this.auth.token(), {copy_list: copies.map(c => c.id())}
        ).toPromise().then(_ => this.refreshSelectCopies(copies));
    }

    printLabels(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        this.anonCache.setItem(null,
            'print-labels-these-copies', {copies: copies.map(c => c.id())})
        .then(key => window.open(`/eg/staff/cat/printlabels/${key}`));
    }

    printIllReturnReceipt(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        this.printer.print({
            printContext: 'receipt',
            templateName: 'ill_return_receipt',
            contextData: {copy: copies[0]}
        });
    }

    viewWorksheet(copies?: IdlObject[]) {

        if (!copies) { // Launched from keyboard shortcut

            if (this.item) { // Detail page
                copies = [this.item];

            } else { // List page; use first selected.

                this.itemService.scannedItems.some(item => {
                    if (this.grid.context.rowIsSelected(item)) {
                        copies = [item];
                        return true;
                    }
                });
            }
        }

        if (copies.length === 0) { return; }

        this.net.request('open-ils.acq',
            'open-ils.acq.lineitem.retrieve.by_copy_id',
            this.auth.token(), copies[0].id()
        ).subscribe(li => {

            if (this.evt.parse(li)) {
                return this.strings.interpolate('staff.cat.item.no-acq')
                .then(str => this.toast.info(str));
            }

            const url = this.ngLocation.prepareExternalUrl(
                `/staff/acq/po/${li.purchase_order()}/lineitem/${li.id()}/worksheet`);

            window.open(url);
        });
    }


    showAcq(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        this.net.request('open-ils.acq',
            'open-ils.acq.lineitem.retrieve.by_copy_id',
            this.auth.token(), copies[0].id()
        ).subscribe(li => {

            if (this.evt.parse(li)) {
                return this.strings.interpolate('staff.cat.item.no-acq')
                .then(str => this.toast.info(str));
            }

            const url = this.ngLocation.prepareExternalUrl(
                `/staff/acq/po/${li.purchase_order()}#${li.id()}`);

            window.open(url);
        });
    }

    showCircHistory(copies: IdlObject[]) {
        const copyIds = ArrayUtil.unique(copies.map(c => c.id()));
        if (copyIds[0]) {
            this.router.navigate([`/staff/cat/item/${copyIds[0]}/circ-history`]);
        }
    }

    showLastPatron(copies: IdlObject[]) {
        let opened = 0;

        copies.forEach(copy => {
            if (copy._circ && copy._circ.usr() && opened < 35) {
                opened++;

                let uId = copy._circ.usr(); // Maybe fleshed
                if (typeof uId === 'object') { uId = uId.id(); }

                const url = this.ngLocation.prepareExternalUrl(
                    `/staff/circ/patron/${uId}/`);

                window.open(url);
            }
        });
    }

    markDamaged(copies: IdlObject[]) {
         let copyIds = copies
            .filter(c => c.status() !== 14 /* Damaged */).map(c => c.id());

        copyIds = ArrayUtil.unique(copyIds);

        if (copyIds.length === 0) { return; }

        let modified = false;

        from(copyIds).pipe(concatMap(copyId => {

            this.markDamagedDialog.copyId = copyId;
            return this.markDamagedDialog.open({size: 'lg'})
            .pipe(tap(ok => { if (ok) { modified = true; } }));

        })).toPromise().then(_ => this.refreshSelectCopies(copies));
    }


    discardWeed(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        let modified = false;

        this.markItemsDialog.markAs = 'discard';
        this.markItemsDialog.copies = copies;
        this.markItemsDialog.open()
        .subscribe(
            copyId => modified = true,
            null,
            () => {
                if (modified) {
                    this.refreshSelectCopies(copies);
                }
            }
        );
    }

    markMissing(copies: IdlObject[]) {
        copies = copies.filter(c => c.status() !== 4 /* Missing */);
        if (copies.length === 0) { return; }

        let modified = false;

        this.markMissingDialog.copies = copies;
        this.markMissingDialog.open()
        .subscribe(
            copyId => modified = true,
            null,
            () => {
                if (modified) {
                    this.refreshSelectCopies(copies);
                }
            }
        );
    }

    addItems(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const callNumIds = ArrayUtil.unique(copies.map(c => c.call_number().id()));
        this.holdings.spawnAddHoldingsUi(null, callNumIds);
    }

    editItems(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const copyIds = ArrayUtil.unique(copies.map(c => c.id()));
        this.holdings.spawnAddHoldingsUi(null, null, null, copyIds, false, true);
    }

    editVols(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const callNumIds = ArrayUtil.unique(copies.map(c => c.call_number().id()));
        this.holdings.spawnAddHoldingsUi(null, callNumIds, null, null, true);
    }

    editVolsAndItems(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const callNumIds = ArrayUtil.unique(copies.map(c => c.call_number().id()));
        const copyIds = ArrayUtil.unique(copies.map(c => c.id()));
        this.holdings.spawnAddHoldingsUi(null, callNumIds, null, copyIds);
    }

    showInCatalog(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        // Cap it at 50 for now -- need to standardize
        copies = copies.slice(0, 50);

        copies.forEach(copy => {

            const recId = copy.call_number().record().id();
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/catalog/record/${recId}`);

            window.open(url);
        });
    }

    showRecordHolds(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        const recId = copies[0].call_number().record().id();
        const url = this.ngLocation.prepareExternalUrl(
            `/staff/catalog/record/${recId}/holds`);

        window.open(url);
    }

    // Only the first item is used as the basis for new
    // call numbers.
    addVols(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        const copy = copies[0];
        const cnData = [{owner: copy.call_number().owning_lib()}];
        this.holdings.spawnAddHoldingsUi(
            copy.call_number().record().id(), null, cnData);
    }

    itemAlerts(copies: IdlObject[], mode: 'create' | 'manage') {
        if (copies.length === 0) { return; }

        this.copyAlertsDialog.copyIds = ArrayUtil.unique(copies.map(c => c.id()));
        this.copyAlertsDialog.mode = mode;
        this.copyAlertsDialog.open({size: 'lg'}).subscribe(
            modified => {
                if (modified) {
                    this.refreshSelectCopies(copies);
                }
            }
        );
    }

    replaceBarcodes(copies: IdlObject[]) {
        if (copies.length === 0) { return; }
        this.replaceBarcode.copyIds = ArrayUtil.unique(copies.map(c => c.id()));
        this.replaceBarcode.open({}).subscribe(
            modified => {
                if (modified) {
                    this.refreshSelectCopies(copies);
                }
            }
        );
    }

    transferItemsToLib(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        const orgId = this.store.getLocalItem('eg.cat.transfer_target_lib');

        const recId =
            this.store.getLocalItem('eg.cat.transfer_target_record')
            || copies[0].call_number().record().id();

        if (!orgId) {
            return this.transferAlert.open().toPromise();
        }

        copies = this.idl.clone(copies); // avoid tweaking active data
        this.transferItems.autoTransferItems(copies, recId, orgId)
        .then(success => success ?  this.refreshSelectCopies(copies) : null);
    }


    transferItemsToCn(copies: IdlObject[]) {
        if (copies.length === 0) { return; }

        const cnId =
            this.store.getLocalItem('eg.cat.transfer_target_vol');

        if (!cnId) {
            return this.transferAlert.open().toPromise();
        }

        this.transferItems.transferItems(copies.map(c => c.id()), cnId)
        .then(success => success ?  this.refreshSelectCopies(copies) : null);
    }

    showDetails(copy?: IdlObject) {
        let copyId;

        if (copy) {
            // Row doubleclick
            copyId = copy.id();

        } else if (this.itemService.scannedItems.length > 0) {
            // Row select + clicking the Show Details button

            // Grid row selector does not maintain order, so use the first
            // grid row that is selected.
            this.itemService.scannedItems.some(item => {
                if (this.grid.context.rowIsSelected(item)) {
                    copyId = item.id();
                    return true;
                }
            });

            // No rows selected, use the first copy row.
            if (!copyId) {
                copyId = this.itemService.scannedItems[0].id();
            }
        }

        if (copyId) {
            this.router.navigate([`/staff/cat/item/${copyId}/summary`]);
        }
    }

    showList() {
        this.currentItemId = null;
        this.router.navigate(['/staff/cat/item/list']);
    }

    clearList() {
        // Force a full reload to reset everything.
        const url = this.ngLocation.prepareExternalUrl(`/staff/cat/item/list`);
        location.href = url;
    }

    printList() {

        // Beware adhoc properties (e.g. item._circ) added to IDL objects
        // are stripped from the object when parsed on the server.
        const data = this.itemService.scannedItems.map(item => {
            return {
                title: item.call_number().id() === -1 ? item.dummy_title() :
                    item.call_number().record().simple_record().title(),
                call_number: item.call_number().label(),
                barcode: item.barcode(),
                due_date: item._circ ? item._circ.due_date() : null
            };
        });

        this.printer.print({
            printContext: 'receipt',
            templateName: 'item_status',
            contextData: {copies: data}
        });
    }
}



