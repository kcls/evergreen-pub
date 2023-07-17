import {Component, Input, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {NetService} from '@eg/core/net.service';
import {PrintService} from '@eg/share/print/print.service';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {EventService} from '@eg/core/event.service';
import {BibRecordService, BibRecordSummary} from '@eg/share/catalog/bib-record.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {BillingService} from '@eg/staff/share/billing/billing.service';
import {PatronPenaltyDialogComponent} from '@eg/staff/share/patron/penalty-dialog.component';
import {BroadcastService} from '@eg/share/util/broadcast.service';

@Component({
  templateUrl: 'mark-damaged.component.html'
})
export class MarkDamagedComponent implements OnInit, AfterViewInit {

    itemId: number;
    item: IdlObject = null;
    circ: IdlObject = null;
    dibs = '';
    bibSummary: BibRecordSummary;
    printPreviewHtml = '';
    printDetails: any = null;
    noSuchItem = false;
    itemBarcode = '';
    updatingItemAlert = false;
    alertMsgUpdated = false;
    itemAlert = '';
    billAmount: number = null;

    billingTypes: ComboboxEntry[];

    // Overide the API suggested charge amount
    amountChangeRequested = true; // KCLS JBAS-3129
    newCharge: number;
    damageNote: string;
    newBtype: number;
    pauseArgs: any = {};
    alreadyDamaged = false;
    noPatronToNotify = false;

    // If the item is checked out, ask the API to check it in first.
    handleCheckin = true;

    // Charge data returned from the server requesting additional charge info.
    chargeResponse: any;

    @ViewChild('penaltyDialog')
    private penaltyDialog: PatronPenaltyDialogComponent;

    constructor(
        private route: ActivatedRoute,
        private net: NetService,
        private printer: PrintService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private evt: EventService,
        private toast: ToastService,
        private store: ServerStoreService,
        private bib: BibRecordService,
        private billing: BillingService,
        private broadcaster: BroadcastService,
        private holdings: HoldingsService
    ) {}

    ngOnInit() {
        this.itemId = +this.route.snapshot.paramMap.get('id');
    }

    ngAfterViewInit() {
        if (this.itemId) {
            this.getItemData().then(_ => this.getBillingTypes());
            //this.selectInput();
        }
    }

    // Fetch-cache billing types
    getBillingTypes(): Promise<any> {
        return this.billing.getUserBillingTypes().then(types => {
            this.billingTypes =
                types.map(bt => ({id: bt.id(), label: bt.name()}));
            this.newBtype = this.billingTypes[0].id;
        });
    }

    refreshPrintDetails() {
        if (this.circ) {
            this.printDetails = {
                printContext: 'default',
                templateName: 'damaged_item_letter',
                contextData: {
                    circulation: this.circ,
                    copy: this.item,
                    patron: this.circ.usr(),
                    note: this.damageNote,
                    cost: this.billAmount.toFixed(2),
                    title: this.bibSummary.display.title,
                    dibs: this.dibs
                }
            };

            // generate the preview.
            this.printLetter(true);
        } else {
            this.printDetails = null;
        }
    }

    cancel() {
        window.close();
    }

    /*
    selectInput() {
        setTimeout(() => {
            const node: HTMLInputElement =
                document.getElementById('item-barcode-input') as HTMLInputElement;
            if (node) { node.select(); }
        });
    }
    */

    getItemData(): Promise<any> {
        this.alreadyDamaged = false;
        return this.pcrud.retrieve('acp', this.itemId,
            {flesh: 1, flesh_fields: {acp: ['call_number']}}).toPromise()
        .then(copy => {
            this.item = copy;
            this.itemBarcode = copy.barcode();
            this.itemAlert = copy.alert_message();

            this.alreadyDamaged = Number(copy.status()) === 14; /* Damged */

            return this.bib.getBibSummary(
                copy.call_number().record()).toPromise();
        }).then(summary => {
            this.bibSummary = summary;
        });
    }

    markDamaged(args: any) {
        this.chargeResponse = null;
        this.billAmount = null;
        this.circ = null;
        this.noPatronToNotify = false;

        if (!args) { args = {}; }

        // Refund pausing now occurs at a different point in the work flow.
        // Skip that bit of logic here.
        args.no_pause_refund = true;

        if (args.apply_fines === 'apply') {
            args.override_amount = this.newCharge;
            args.override_btype = this.newBtype;
            args.override_note = this.damageNote;
        }


        if (this.pauseArgs) {
            Object.assign(args, this.pauseArgs);
        }

        if (this.handleCheckin) {
            args.handle_checkin = true;
        }

        this.net.request(
            'open-ils.circ', 'open-ils.circ.mark_item_damaged.details',
            this.auth.token(), this.itemId, args
        ).subscribe(
            result => {
                console.debug('Mark damaged returned', result);
                const evt = this.evt.parse(result);

                if (result && (!evt || evt.textcode === 'REFUNDABLE_TRANSACTION_PENDING')) {
                    // Result is a hash of detail info.
                    this.toast.success($localize`Successfully Marked Item Damaged`);

                    // Tell it on the mountain we modified some copy data.
                    this.broadcaster.broadcast('eg.holdings.update', {
                        copies: [this.item.id()],
                        records: [this.item.call_number().record()]
                    });

                    if (!result.circ) {
                        // No related circulation.  Nothing left to do.
                        this.noPatronToNotify = true;
                        return;
                    }

                    this.circ = result.circ;
                    this.billAmount = parseFloat(result.bill_amount);
                    this.penaltyDialog.defaultType = this.penaltyDialog.ALERT_NOTE;
                    this.penaltyDialog.patronId = this.circ.usr().id();
                    this.penaltyDialog.startPatronMessage = 53;
                    this.penaltyDialog.startInitials = this.dibs;

                    this.penaltyDialog.appendToPatronMessage =
                        this.damageNote + '\n' +
                        this.itemBarcode + '\n' +
                        this.bibSummary.display.title;

                    this.penaltyDialog.open({size: 'lg'}).toPromise()
                    .finally(() => this.refreshPrintDetails());

                    return;
                }

                if (evt.textcode === 'DAMAGE_CHARGE') {
                    // More info needed from staff on how to handle charges.
                    this.chargeResponse = evt.payload;
                    this.newCharge = this.chargeResponse.charge;
                } else {
                    console.error(evt);
                    alert(evt);
                }
            },
            err => {
                this.toast.danger($localize`Failed To Mark Item Damaged`);
                console.error(err);
            }
        );
    }

    disableOk(): boolean {
        if (!this.dibs) { return true; }
        return this.amountChangeRequested && (!this.newBtype || !this.newCharge);
    }

    printLetter(previewOnly?: boolean) {
        if (previewOnly) {
            this.printer.compileRemoteTemplate(this.printDetails)
            .then(response => {
                this.printPreviewHtml = response.content;
                document.getElementById('print-preview-pane').innerHTML = response.content;
            });
        } else {
            this.printer.print(this.printDetails);
        }
    }

    updateAlertMessage() {
        if (!this.itemAlert) { return; }

        this.updatingItemAlert = true;

        const msg = this.itemAlert; // clobbered in getItemById

        this.getItemData().then(_ => {

            this.item.alert_message(this.itemAlert = msg);

            if (!msg || msg.match(/^\s*$/)) {
                this.item.alert_message(null);
            }

            return this.pcrud.update(this.item).toPromise()
            .then(
                ok => {
                    this.alertMsgUpdated = true;
                    this.toast.success($localize`Alert Message Updated`);
                    this.refreshPrintDetails();
                },
                err => {
                    this.toast.danger($localize`Alert Message Update Failed`);
                }
            );
        })
        .finally(() => this.updatingItemAlert = false);
    }

}

