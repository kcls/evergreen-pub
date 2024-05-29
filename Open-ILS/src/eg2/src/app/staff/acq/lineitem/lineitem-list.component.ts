import {Component, OnInit, Input, Output, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {Observable, from} from 'rxjs';
import {Location} from '@angular/common';
import {tap, concatMap} from 'rxjs/operators';
import {Pager} from '@eg/share/util/pager';
import {EgEvent, EventService} from '@eg/core/event.service';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {StoreService} from '@eg/core/store.service';
import {LineitemService} from './lineitem.service';
import {PoService} from '../po/po.service';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {CancelDialogComponent} from './cancel-dialog.component';
import {PicklistDialogComponent} from './pl-dialog.component';
import {PcrudService} from '@eg/core/pcrud.service';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';
import {BatchUpdateCopiesDialogComponent} from './batch-update-copies-dialog.component';
import {ProgressInlineComponent} from '@eg/share/dialog/progress-inline.component';

const DELETABLE_STATES = [
    'new', 'selector-ready', 'order-ready', 'approved', 'pending-order'
];

const BATCH_FIELDS = [
    'location', 'owning_lib', 'fund', 'circ_modifier', 'cn_label'
];

@Component({
  templateUrl: 'lineitem-list.component.html',
  selector: 'eg-lineitem-list',
  styleUrls: ['lineitem-list.component.css']
})
export class LineitemListComponent implements OnInit {

    picklistId: number = null;
    poId: number = null;
    recordId: number = null; // lineitems related to a bib.
    lineitemId: number = null;
    onOrderCallNumbers = [];

    loading = false;
    pager: Pager = new Pager();
    pageOfLineitems: IdlObject[] = [];
    lineitemIds: number[] = [];

    batchCopyTemplate: IdlObject;

    saving = false;
    progressMax = 0;
    progressValue = 0;
	poWasActivated = false;

    disableBatchBar = false;
    batchSaving = false;
    batchAlertEntry: ComboboxEntry;

    // Selected lineitems
    selected: {[id: number]: boolean} = {};

    // Order identifier type per lineitem
    orderIdentTypes: {[id: number]: 'isbn' | 'issn' | 'upc'} = {};

    // Copy counts per lineitem
    existingCopyCounts: {[id: number]: number} = {};

    // Squash these down to an easily traversable data set to avoid
    // a lot of repetitive looping.
    liMarcAttrs: {[id: number]: {[name: string]: IdlObject[]}} = {};

    batchNote: string;
    noteIsPublic = false;
    batchSelectPage = false;
    batchSelectAll = false;
    showNotesFor: number;
    showExpandFor: number; // 'Expand'
    expandAll = false;
    action = '';
    batchFailure: EgEvent;
    focusLi: number;

    curTransferTarget: number;
    curTransferLiId: number;
    curTransferTitle: string;

    @ViewChild('cancelDialog') cancelDialog: CancelDialogComponent;
    @ViewChild('plDialog') plDialog: PicklistDialogComponent;
    @ViewChild('transferConfirm') transferConfirm: ConfirmDialogComponent;
    @ViewChild('batchUpdateCopiesDialog') batchUpdateCopiesDialog: BatchUpdateCopiesDialogComponent;
    @ViewChild('batchProgress') batchProgress: ProgressInlineComponent;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private ngLocation: Location,
        private evt: EventService,
        private net: NetService,
        private auth: AuthService,
        private store: StoreService,
        private pcrud: PcrudService,
        private serverStore: ServerStoreService,
        private holdings: HoldingsService,
        private liService: LineitemService,
        private poService: PoService
    ) {}

    ngOnInit() {

        this.route.queryParamMap.subscribe((params: ParamMap) => {
            this.pager.offset = +params.get('offset');
            this.pager.limit = +params.get('limit');
            this.load();
        });

        this.route.fragment.subscribe((fragment: string) => {
            const id = Number(fragment);
            if (id > 0) { this.focusLineitem(id); }
        });

        this.route.parent.paramMap.subscribe((params: ParamMap) => {
            this.picklistId = +params.get('picklistId');
            this.poId = +params.get('poId');
            this.recordId = +params.get('recordId');
            this.lineitemId = +params.get('lineitemId');
            this.load();
        });

        this.serverStore.getItem('acq.lineitem.page_size').then(count => {
            this.pager.setLimit(count || 20);
            this.load();
        });
    }

   // order was activated as some point in past
    isActivatedPo(): boolean {
        if (this.picklistId) {
            return false; // not an order
        } else {
            if (this.po()) {
                this.poWasActivated = this.po().order_date() ? true : false;
            }
            return this.poWasActivated;
        }
    }

    bibTransferTarget(): number {
        return this.store.getLocalItem('eg.cat.marked_lineitem_transfer_record');
    }

    transferToBib(li: IdlObject) {

        this.curTransferTarget = this.bibTransferTarget();
        this.curTransferLiId = li.id();
        this.curTransferTitle = '';

        this.pcrud.retrieve('rmsr', this.curTransferTarget).toPromise()
        .then(bib => {
            this.curTransferTitle = bib.title();
            return this.transferConfirm.open().toPromise();
        })
        .then(confirmed => {
            if (!confirmed) { return; }

            return this.net.request(
                'open-ils.acq',
                'open-ils.acq.lineitem.transfer_to_bib',
                this.auth.token(), li.id(), this.curTransferTarget)
            .toPromise();
        })
        .then(res => {
            const remove = [];
            if (this.recordId && this.recordId !== this.curTransferTarget) {
                // When displaying lineitems related to a specific bib
                // record and a LI has its bib target modified via trasfer,
                // remove it from the displayed list.
                remove.push(li.id());
            }
            this.postBatchAction(res, [li.id()], remove);
        });
    }

    po(): IdlObject {
        return this.poService.currentPo;
    }

    pageSizeChange(count: number) {
        this.serverStore.setItem('acq.lineitem.page_size', count).then(_ => {
            this.pager.setLimit(count);
            this.pager.toFirst();
            this.goToPage();
        });
    }

    // Focus the selected lineitem, which may not yet exist in the
    // DOM for focusing.
    focusLineitem(id?: number) {
        if (id !== undefined) { this.focusLi = id; }
        if (this.focusLi) {
            const node = document.getElementById('' + this.focusLi);
            if (node) { node.scrollIntoView(true); }
        }
    }

    load(): Promise<any> {
        this.pageOfLineitems = [];

        if (!this.loading && this.pager.limit &&
            (this.poId || this.picklistId || this.recordId || this.lineitemId)) {

            this.loading = true;

            return this.loadIds()
                .then(_ => this.loadPage())
                .then(_ => this.loading = false)
                //.catch(_ => {}); // re-route while page is loading
        }

        // We have not collected enough data to proceed.
        return Promise.resolve();

    }

    loadIds(): Promise<any> {

        this.lineitemIds = [];

        if (this.lineitemId) {
            this.lineitemIds = [this.lineitemId];
            return Promise.resolve();
        }

        let id = this.poId;
        let options: any = {flesh_lineitem_ids: true, li_limit: 10000};
        let method = 'open-ils.acq.purchase_order.retrieve';
        let handler = (po) => po.lineitems();
        let sort = true;

        if (this.picklistId) {

            id = this.picklistId;
            options = {idlist: true, limit: 1000};
            method = 'open-ils.acq.lineitem.picklist.retrieve.atomic';
            handler = (ids) => ids;

        } else if (this.recordId) {

            id = this.recordId;
            method = 'open-ils.acq.lineitems_for_bib.by_bib_id.atomic';
            options = {idlist: true, limit: 1000};
            handler = (ids) => ids;
            // The API sorts the newest to oldest, which is what
            // we want here.
            sort = false;
        }

        return this.net.request(
            'open-ils.acq', method, this.auth.token(), id, options
        ).toPromise().then(resp => {
            const ids = handler(resp);

            // When loading IDs from a PO, disable the batch edit
            // bar if the PO in question is already active.
            this.disableBatchBar = (this.poId && resp.order_date());

            if (sort) {
                this.lineitemIds = ids
                    .map(i => Number(i))
                    .sort((id1, id2) => id1 < id2 ? 1 : -1);
            } else {
                this.lineitemIds = ids.map(i => Number(i));
            }

            this.pager.resultCount = ids.length;
        }).then(_ => {
            if (!this.disableBatchBar) {
                return this.serverStore.getItem('acq.on_order.call_numbers')
                .then(val => this.onOrderCallNumbers = val ? val.sort() : []);
            }
        });
    }

    goToPage() {
        this.focusLi = null;
        this.router.navigate([], {
            relativeTo: this.route,
            queryParamsHandling: 'merge',
            fragment: null,
            queryParams: {
                offset: this.pager.offset,
                limit: this.pager.limit
            }
        });
    }

    loadPage(): Promise<any> {
        return this.jumpToLiPage()
            .then(_ => this.loadPageOfLis())
            .then(_ => this.setBatchSelect())
            .then(_ => setTimeout(() => this.focusLineitem()));
    }

    jumpToLiPage(): Promise<boolean> {
        if (!this.focusLi) { return Promise.resolve(true); }

        const idx = this.lineitemIds.indexOf(this.focusLi);
        if (idx === -1) { return Promise.resolve(true); }

        const offset = Math.floor(idx / this.pager.limit) * this.pager.limit;

        return this.router.navigate(['./'], {
            relativeTo: this.route,
            queryParams: {offset: offset, limit: this.pager.limit},
            fragment: '' + this.focusLi
        });
    }

    loadPageOfLis(): Promise<any> {
        this.pageOfLineitems = [];

        const ids = this.lineitemIds.slice(
            this.pager.offset, this.pager.offset + this.pager.limit)
            .filter(id => id !== undefined);

        if (ids.length === 0) { return Promise.resolve(); }

        if (this.pageOfLineitems.length === ids.length) {
            // All entries found in the cache
            return Promise.resolve();
        }

        this.pageOfLineitems = []; // reset

        return this.liService.getFleshedLineitems(
            ids, {fromCache: true, toCache: true})
        .pipe(tap(struct => {
            this.ingestOneLi(struct.lineitem);
            this.existingCopyCounts[struct.id] = struct.existing_copies;
        })).toPromise().then(_ => {}, _ => Promise.resolve());
    }

    ingestOneLi(li: IdlObject, replace?: boolean) {
        this.liMarcAttrs[li.id()] = {};

        li.attributes().forEach(attr => {
            const name = attr.attr_name();
            this.liMarcAttrs[li.id()][name] =
                this.liService.getAttributes(
                    li, name, 'lineitem_marc_attr_definition');
        });

        const ident = this.liService.getOrderIdent(li);
        this.orderIdentTypes[li.id()] = ident ? ident.attr_name() : 'isbn';

        // newest to oldest
        li.lineitem_notes(li.lineitem_notes().sort(
            (n1, n2) => n1.create_time() < n2.create_time() ? 1 : -1));

        if (replace) {
            for (let idx = 0; idx < this.pageOfLineitems.length; idx++) {
                if (this.pageOfLineitems[idx].id() === li.id()) {
                    this.pageOfLineitems[idx] = li;
                    break;
                }
            }
        } else {
            this.pageOfLineitems.push(li);
        }

        // Remove any 'new' lineitem details which may have been added
        // and left unsaved on the copies page
        li.lineitem_details(li.lineitem_details().filter(d => !d.isnew()));
    }

    // First matching attr
    displayAttr(li: IdlObject, name: string): string {
        return (
            this.liMarcAttrs[li.id()][name] &&
            this.liMarcAttrs[li.id()][name][0]
        ) ? this.liMarcAttrs[li.id()][name][0].attr_value() : '';
    }

    // All matching attrs
    attrs(li: IdlObject, name: string, attrType?: string): IdlObject[] {
        return this.liService.getAttributes(li, name, attrType);
    }

    jacketIdent(li: IdlObject): string {
        return this.displayAttr(li, 'isbn') || this.displayAttr(li, 'upc');
    }

    // Order ident options are pulled from the MARC, but the ident
    // value proper is stored as a local attr def.
    identOptions(li: IdlObject): ComboboxEntry[] {
        const otype = this.orderIdentTypes[li.id()];

        if (this.liMarcAttrs[li.id()][otype]) {
            return this.liMarcAttrs[li.id()][otype].map(
                attr => ({id: attr.id(), label: attr.attr_value()}));
        }

        return [];
    }

    // Returns the MARC attr with the same type and value as the applied
    // order identifier (which is a local attr)
    selectedIdent(li: IdlObject): number {
        const ident = this.liService.getOrderIdent(li);
        if (!ident) { return null; }

        const attr = this.identOptions(li).filter(
            (entry: ComboboxEntry) => entry.label === ident.attr_value())[0];
        return attr ? attr.id : null;
    }

    currentIdent(li: IdlObject): IdlObject {
        return this.liService.getOrderIdent(li);
    }

    orderIdentChanged(li: IdlObject, entry: ComboboxEntry) {
        if (entry === null) { return; }

        this.liService.changeOrderIdent(
            li, entry.id, this.orderIdentTypes[li.id()], entry.label
        ).subscribe(freshLi => this.ingestOneLi(freshLi, true));
    }

    canEditIdent(li: IdlObject): boolean {
        return DELETABLE_STATES.includes(li.state());
    }

    addBriefRecord() {
    }

    selectedIds(): number[] {
        return Object.keys(this.selected)
            .filter(id => this.selected[id] === true)
            .map(id => Number(id));
    }


    // After a page of LI's are loaded, see if the batch-select checkbox
    // needs to be on or off.
    setBatchSelect() {
        let on = true;
        const ids = this.selectedIds();
        this.pageOfLineitems.forEach(li => {
            if (!ids.includes(li.id())) { on = false; }
        });

        this.batchSelectPage = on;

        on = true;

        this.lineitemIds.forEach(id => {
            if (!this.selected[id]) { on = false; }
        });

        this.batchSelectAll = on;
    }

    toggleSelectAll(allItems: boolean) {

        if (allItems) {
            this.lineitemIds.forEach(
                id => this.selected[id] = this.batchSelectAll);

            this.batchSelectPage = this.batchSelectAll;

        } else {

            this.pageOfLineitems.forEach(
                li => this.selected[li.id()] = this.batchSelectPage);

            if (!this.batchSelectPage) {
                // When deselecting items in the page, we're no longer
                // selecting all items.
                this.batchSelectAll = false;
            }
        }
    }

    applyBatchNote(toAll?: boolean) {
        const ids = toAll ? this.lineitemIds : this.selectedIds();

        if (ids.length === 0 || !this.batchNote) { return; }

        let alertEntry = null;
        if (this.batchAlertEntry && Number(this.batchAlertEntry.id) !== -1) {
            alertEntry = this.batchAlertEntry.id;
        }

        this.liService.applyBatchNote(ids,
            this.batchNote, this.noteIsPublic, alertEntry)
        .then(_ => {
            this.batchNote = '';
            this.noteIsPublic = false;
        });
    }

    liPriceIsValid(li: IdlObject): boolean {
        const price = li.estimated_unit_price();
        if (price === null || price === undefined || price === '') {
            return true;
        }
        return !Number.isNaN(Number(price)) && Number(price) >= 0;
    }

    liPriceChange(li: IdlObject) {
        const price = li.estimated_unit_price();
        if (this.liPriceIsValid(li)) {
            li.estimated_unit_price(Number(price).toFixed(2));

            this.net.request(
                'open-ils.acq',
                'open-ils.acq.lineitem.update',
                this.auth.token(), li
            ).subscribe(resp =>
                this.liService.activateStateChange.emit(li.id()));
        }
    }

    toggleShowNotes(liId: number) {
        this.showExpandFor = null;
        this.showNotesFor = this.showNotesFor === liId ? null : liId;
    }

    toggleShowExpand(liId: number) {
        this.showNotesFor = null;
        this.showExpandFor = this.showExpandFor === liId ? null : liId;
    }

    toggleExpandAll() {
        this.showNotesFor = null;
        this.showExpandFor = null;
        this.expandAll = !this.expandAll;
    }

    liHasAlerts(li: IdlObject): boolean {
        return li.lineitem_notes().filter(n => n.alert_text()).length > 0;
    }

    deleteLineitems() {
        const ids = Object.keys(this.selected).filter(id => this.selected[id]);

        const method = this.poId ?
            'open-ils.acq.purchase_order.lineitem.delete' :
            'open-ils.acq.picklist.lineitem.delete';

        from(ids)
        .pipe(concatMap(id =>
            this.net.request('open-ils.acq', method, this.auth.token(), id)
        ))
        .pipe(concatMap(_ => from(this.load())))
        .subscribe();
    }

    liHasRealCopies(li: IdlObject): boolean {
        for (let idx = 0; idx < li.lineitem_details().length; idx++) {
            if (li.lineitem_details()[idx].eg_copy_id()) {
                return true;
            }
        }
        return false;
    }

    editHoldings(li: IdlObject) {

        const copies = li.lineitem_details()
            .filter(lid => lid.eg_copy_id()).map(lid => lid.eg_copy_id());

        if (copies.length === 0) { return; }

        this.holdings.spawnAddHoldingsUi(
            li.eg_bib_id(),
            copies.map(c => c.call_number()),
            null,
            copies.map(c => c.id())
        );
    }

    receiveSelected() {
        this.markReceived(this.selectedIds());
    }

    unReceiveSelected() {
        this.markUnReceived(this.selectedIds());
    }

    cancelSelected() {
        const liIds = this.selectedIds();
        if (liIds.length === 0) { return; }

        this.cancelDialog.open().subscribe(reason => {
            if (!reason) { return; }

            this.net.request('open-ils.acq',
                'open-ils.acq.lineitem.cancel.batch',
                this.auth.token(), liIds, reason
            ).toPromise().then(resp => this.postBatchAction(resp, liIds));
        });
    }

    markReceived(liIds: number[]) {
        if (liIds.length === 0) { return; }

        this.net.request(
            'open-ils.acq',
            'open-ils.acq.lineitem.receive.batch',
            this.auth.token(), liIds
        ).toPromise().then(resp => this.postBatchAction(resp, liIds));
    }

    markUnReceived(liIds: number[]) {
        if (liIds.length === 0) { return; }

        this.net.request(
            'open-ils.acq',
            'open-ils.acq.lineitem.receive.rollback.batch',
            this.auth.token(), liIds
        ).toPromise().then(resp => this.postBatchAction(resp, liIds));
    }

    postBatchAction(response: any, liIds: number[], removeLiIds: number[] = []) {
        const evt = this.evt.parse(response);

        if (evt) {
            console.warn('Batch operation failed', evt);
            this.batchFailure = evt;
            return;
        }

        this.batchFailure = null;

        // Remove the modified LI's from the cache so we are
        // forced to re-fetch them.
        liIds.forEach(id => delete this.liService.liCache[id]);

        // Remove from cache and list of lineitem IDs
        removeLiIds.forEach(id => {
            delete this.liService.liCache[id];
            this.lineitemIds = this.lineitemIds.filter(liId => liId !== id);
        });

        this.loadPageOfLis();
    }

    createPo(fromAll?: boolean) {
        this.router.navigate(['/staff/acq/po/create'], {
            queryParams: {li: fromAll ? this.lineitemIds : this.selectedIds()}
        });
    }

    // For PO's, lineitems can only be deleted if they are pending order.
    canDeleteLis(): boolean {
        const li = this.pageOfLineitems[0];
        return Boolean(this.picklistId) || (
            Boolean(li) &&
            DELETABLE_STATES.includes(li.state()) &&
            Boolean(this.poId)
        );
    }

    moveToPl() {
        this.plDialog.lineitemIds = this.selectedIds();
        this.plDialog.open().subscribe(plId => {
            if (plId) {
                this.router.navigate([`/staff/acq/picklist/${plId}`]);
            }
        });
    }

    batchUpdateCopiesOnLineitemsInline(copy: IdlObject) {
        const ids = Object.keys(this.selected).filter(id => this.selected[id]);
        if (ids.length === 0) { return; }

        this.batchSaving = true;

        let changes: any = {};
        BATCH_FIELDS.forEach(field => {
            let val = copy[field]();
            if (val) { changes[field] = val; }
        });

        if (Object.keys(changes).length === 0) {
            this.batchSaving = false;
            return;
        }

        this.net.request(
            'open-ils.acq',
            'open-ils.acq.lineitem.batch_update',
            this.auth.token(), { lineitems: ids },
            changes
        ).subscribe(
            response => {
                const evt = this.evt.parse(response);
                if (!evt) {
                    delete this.liService.liCache[response];
                    this.batchProgress.value++;
                }
            },
            err => {},
            () => {
                this.batchSaving = false;
                this.loadPageOfLis();
                this.liService.activateStateChange.emit(Number(ids[0]));
            }
        );

        setTimeout(() => {
            // give batchSaving=true a chance to propagate to the template
            this.batchProgress.value = 0;
            this.batchProgress.max = ids.length;
        });
    }


    batchUpdateCopiesOnLineitems() {
        const ids = Object.keys(this.selected).filter(id => this.selected[id]);

        this.batchUpdateCopiesDialog.ids = ids.map(i => Number(i));
        this.batchUpdateCopiesDialog.open({size: 'xl'}).subscribe(changes => {
            if (!changes) { return; }

            this.saving = true;
            this.progressMax = ids.length;
            this.progressValue = 0;

            this.net.request(
                'open-ils.acq',
                'open-ils.acq.lineitem.batch_update',
                this.auth.token(), { lineitems: ids },
                changes, changes._dist_formula
            ).subscribe(
                response => {
                    const evt = this.evt.parse(response);
                    if (!evt) {
                        delete this.liService.liCache[response];
                        this.progressValue++;
                    }
                },
                err => {},
                () => {
                    this.saving = false;
                    this.loadPageOfLis();
                    this.liService.activateStateChange.emit(Number(ids[0]));
                }
            );
        });
    }

    printSelectedWorksheets() {
        let ids = Object.keys(this.selected)
            .filter(id => this.selected[id]).map(i => Number(i));

        if (ids.length > 50) {
            const msg = $localize`Are you sure you wish to print ${ids.length} worksheets?`;
            if (!confirm(msg)) { return; }
        }

        // Print worksheets in the same order we display line items.
        let sorted = [];
        this.lineitemIds.forEach(id => {
            if (ids.includes(id)) {
                sorted.push(id);
            }
        });

        this.printNextWorksheet(sorted);
    }

    // Print one worksheet then set a timeout to print the next one.
    //
    // The timeout here gives the browser a slice of breathing room
    // between opening the new table, queueing up the data, and printing
    // each workstation.
    printNextWorksheet(ids: number[]) {
        let id = ids.shift();
        if (!id) { return; }

        const url = this.ngLocation.prepareExternalUrl(
            `/staff/acq/po/${this.poId}/lineitem/${id}/worksheet/print/close`);

        window.open(url);

        setTimeout(() => this.printNextWorksheet(ids), 500);
    }
}

