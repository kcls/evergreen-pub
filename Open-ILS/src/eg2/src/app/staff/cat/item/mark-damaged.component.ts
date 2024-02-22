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

@Component({
  templateUrl: 'mark-damaged.component.html'
})
export class MarkDamagedComponent implements OnInit, AfterViewInit {

    copyId: number;
    copy: IdlObject;
    bibSummary: BibRecordSummary;
    printPreviewHtml = '';
    printDetails: any = null;
    noSuchItem = false;
    itemBarcode = '';

    billingTypes: ComboboxEntry[];

    // Overide the API suggested charge amount
    amountChangeRequested = true; // KCLS JBAS-3129
    newCharge: number;
    newNote: string;
    newBtype: number;
    pauseArgs: any = {};
    dibs = '';
    alreadyDamaged = false;

    // If the item is checked out, ask the API to check it in first.
    @Input() handleCheckin = false;

    // Charge data returned from the server requesting additional charge info.
    chargeResponse: any;

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
        private holdings: HoldingsService
    ) {}

    ngOnInit() {
        this.copyId = +this.route.snapshot.paramMap.get('id');
    }

    ngAfterViewInit() {
        if (this.copyId) {
            this.getCopyData().then(_ => this.getBillingTypes());
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

    setPrintDetails(details: any) {
        if (details && details.circ) {
            this.printDetails = {
                printContext: 'default',
                templateName: 'damaged_item_letter',
                contextData: {
                    circulation: details.circ,
                    copy: this.copy,
                    patron: details.circ.usr(),
                    note: details.note,
                    cost: parseFloat(details.bill_amount).toFixed(2),
                    title: this.bibSummary.display.title,
                    dibs: details.dibs
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

    getCopyData(): Promise<any> {
        this.alreadyDamaged = false;
        return this.pcrud.retrieve('acp', this.copyId,
            {flesh: 1, flesh_fields: {acp: ['call_number']}}).toPromise()
        .then(copy => {
            this.copy = copy;
            this.itemBarcode = copy.barcode();

            this.alreadyDamaged = Number(copy.status()) === 14; /* Damged */

            return this.bib.getBibSummary(
                copy.call_number().record()).toPromise();
        }).then(summary => {
            this.bibSummary = summary;
        });
    }

    markDamaged(args: any) {
        this.chargeResponse = null;

        if (!args) { args = {}; }

        // Refund pausing now occurs at a different point in the work flow.
        // Skip that bit of logic here.
        args.no_pause_refund = true;

        if (args.apply_fines === 'apply') {
            args.override_amount = this.newCharge;
            args.override_btype = this.newBtype;
            args.override_note = this.newNote;
        }


        if (this.pauseArgs) {
            Object.assign(args, this.pauseArgs);
        }

        if (this.handleCheckin) {
            args.handle_checkin = true;
        }

        this.net.request(
            'open-ils.circ', 'open-ils.circ.mark_item_damaged.details',
            this.auth.token(), this.copyId, args
        ).subscribe(
            result => {
                console.debug('Mark damaged returned', result);
                const evt = this.evt.parse(result);

                if (result && (!evt || evt.textcode === 'REFUNDABLE_TRANSACTION_PENDING')) {
                    // Result is a hash of detail info.
                    this.toast.success($localize`Successfully Marked Item Damaged`);
                    this.setPrintDetails(result);
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
}

