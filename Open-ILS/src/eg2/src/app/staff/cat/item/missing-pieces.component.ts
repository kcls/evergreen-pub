import {Component, Input, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {NetService} from '@eg/core/net.service';
import {PrintService} from '@eg/share/print/print.service';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {EventService} from '@eg/core/event.service';
import {PatronPenaltyDialogComponent} from '@eg/staff/share/patron/penalty-dialog.component';
import {PauseRefundDialogComponent} from '@eg/staff/share/holdings/pause-refund-dialog.component';
import {ServerStoreService} from '@eg/core/server-store.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {StringService} from '@eg/share/string/string.service';
import {RepairCostDialogComponent} from './repair-cost-dialog.component';

@Component({
  templateUrl: 'missing-pieces.component.html'
})
export class MarkItemMissingPiecesComponent implements AfterViewInit, OnInit {

    itemId: number;
    itemBarcode: string;
    item: IdlObject;
    //letter: string;
    circNotFound = false;
    processing = false;
    noSuchItem = false;
    itemProcessed = false;
    itemIsLost = false;
    itemAlert = '';
    updatingItemAlert = false;
    circ: IdlObject;
    staffInitials = '';
    printPreviewHtml = '';

    autoRefundsActive = false;
    alertMsgUpdated = false;

    @ViewChild('penaltyDialog')
    private penaltyDialog: PatronPenaltyDialogComponent;

    @ViewChild('pauseRefundDialog')
    private pauseRefundDialog: PauseRefundDialogComponent;

    @ViewChild('costDialog')
    private costDialog: RepairCostDialogComponent;

    constructor(
        private route: ActivatedRoute,
        private net: NetService,
        private printer: PrintService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private evt: EventService,
        private toast: ToastService,
        private strings: StringService,
        private store: ServerStoreService,
        private holdings: HoldingsService
    ) {
        this.itemId = +this.route.snapshot.paramMap.get('id');
    }

    ngOnInit() {
        this.store.getItem('eg.circ.lostpaid.auto_refund')
        .then(value => this.autoRefundsActive = value);
    }

    ngAfterViewInit() {
        if (this.itemId) { this.getItemById(); }
        this.selectInput();
    }

    getItemByBarcode(): Promise<any> {
        this.itemId = null;
        this.item = null;
        this.itemAlert = '';
        this.itemIsLost = false;

        if (!this.itemBarcode) { return Promise.resolve(); }

        this.itemBarcode = this.itemBarcode.trim();

        // Submitting a new barcode resets the form.
        const bc = this.itemBarcode;
        this.reset();
        this.itemBarcode = bc;

        return this.holdings.getItemIdFromBarcode(this.itemBarcode)
        .then(id => {
            this.noSuchItem = (id === null);
            this.itemId = id;
            return this.getItemById();
        });
    }

    selectInput() {
        setTimeout(() => {
            const node: HTMLInputElement =
                document.getElementById('item-barcode-input') as HTMLInputElement;
            if (node) { node.select(); }
        });
    }

    getItemById(): Promise<any> {
        this.circNotFound = false;

        if (!this.itemId) {
            this.selectInput();
            return Promise.resolve();
        }

        const flesh = {
            flesh: 3,
            flesh_fields: {
                acp: ['call_number'],
                acn: ['record'],
                bre: ['flat_display_entries']
            }
        };

        return this.pcrud.retrieve('acp', this.itemId, flesh, {authoritative: true})
        .toPromise().then(item => {
            this.item = item;
            this.itemId = item.id();
            this.itemBarcode = item.barcode();
            this.itemAlert = item.alert_message() || '';
            this.selectInput();

            if (item.status() === 3 /* Lost */) {
                this.itemIsLost = true;
            }
        });
    }

    display(field: string): string {
        if (!this.item) { return ''; }

        const entry = this.item.call_number().record()
            .flat_display_entries()
            .filter(fde => fde.name() === field)[0];

        return entry ? entry.value() : '';
    }

    reset() {
        this.item = null;
        this.itemId = null;
        this.circ = null;
        this.itemBarcode = null;
        this.circNotFound = false;
        this.processing = false;
        this.itemProcessed = false;
        this.alertMsgUpdated = false;
        this.printPreviewHtml = '';

        const node = document.getElementById('print-preview-pane');
        if (node) { node.innerHTML = ''; }
    }

    processItem(args: any = {}) {
        this.circNotFound = false;
        this.itemProcessed = false;

        if (!this.item) { return; }

        this.processing = true;
        this.circ = null;
        this.alertMsgUpdated = false;

        this.net.request(
            'open-ils.circ',
            'open-ils.circ.mark_item_missing_pieces',
            this.auth.token(), this.itemId, args
        ).subscribe(resp => {
            const evt = this.evt.parse(resp); // always returns event
            this.processing = false;
            this.itemProcessed = true;

            if (evt.textcode === 'ACTION_CIRCULATION_NOT_FOUND') {
                this.circNotFound = true;
                this.selectInput();
                return;
            }

            if (evt.textcode === 'REFUNDABLE_TRANSACTION_PENDING') {
                if (this.autoRefundsActive) {
                    this.pauseRefundDialog.refundableXact = evt.payload.mrx;
                    this.pauseRefundDialog.open()
                    .subscribe(resp2 => this.processItem(resp2));
                } else {
                    this.processItem({no_pause_refund: true});
                }
                return;
            }

            const payload = evt.payload;

            if (payload.slip) {
                this.printer.print({
                    printContext: 'receipt',
                    contentType: 'text/html',
                    text: payload.slip.template_output().data()
                });
            }

            if (payload.circ) {
                this.circ = payload.circ;
                this.penaltyDialog.defaultType = this.penaltyDialog.ALERT_NOTE;
                this.penaltyDialog.patronId = payload.circ.usr();
                this.penaltyDialog.open({size: 'lg'}).toPromise()
                .then(penId => {
                    // Pull initials from the penalty dialog so they
                    // don't have to be entered again.
                    this.staffInitials = this.penaltyDialog.initials;
                })
                .finally(() => this.prepareLetter());
            } else {
                this.selectInput();
            }
        });
    }

    prepareLetter() {

        this.printPreviewHtml = '';
        this.costDialog.repairCost = Number(this.item.price()) || 0;
        this.costDialog.staffInitials = this.staffInitials;
        this.costDialog.missingPiecesNote = '';

        this.costDialog.open().subscribe(ok => {

            let cost = this.costDialog.repairCost;
            let dibs = this.costDialog.staffInitials;
            let note = this.costDialog.missingPiecesNote;

            if (!ok || (!cost && cost !== 0) || !dibs || !note) { return; }

            this.pcrud.retrieve( 'au', this.circ.usr(), {flesh: 1,
                flesh_fields: {au: ['card', 'mailing_address', 'billing_address']}})

            .toPromise().then(patron => {
                return this.printer.compileRemoteTemplate({
                    printContext: 'default',
                    templateName: 'missing_pieces',
                    contentType: 'text/html',
                    contextData: {
                        circulation: this.circ,
                        copy: this.item,
                        dibs: dibs,
                        patron: patron,
                        missing_pieces: note,
                        cost: cost.toFixed(2),
                        title: this.display('title_proper')
                    }
                });
            })
            .then(response => {
                this.printPreviewHtml = response.content;
                document.getElementById('print-preview-pane').innerHTML = response.content;
            });
        });
    }

    printLetter() {
        this.printer.print({
            printContext: 'default',
            templateName: 'missing_pieces',
            contentType: 'text/html',
            text: this.printPreviewHtml
        });
    }

    updateAlertMessage() {
        if (!this.itemAlert) { return; }

        this.updatingItemAlert = true;

        const msg = this.itemAlert; // clobbered in getItemById

        this.getItemById().then(_ => {

            this.item.alert_message(this.itemAlert = msg);

            if (!msg || msg.match(/^\s*$/)) {
                this.item.alert_message(null);
            }

            return this.pcrud.update(this.item).toPromise()
            .then(
                ok => {
                    this.alertMsgUpdated = true;
                    this.strings.interpolate(
                        'cat.item.missing_pieces.update_alert.success')
                    .then(str => this.toast.success(str));
                },
                err => {
                    this.strings.interpolate(
                        'cat.item.missing_pieces.update_alert.failure')
                    .then(str => this.toast.danger(str));
                }
            );
        })
        .finally(() => this.updatingItemAlert = false);
    }
}



