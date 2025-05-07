import {Component, Input, ViewChild} from '@angular/core';
import {Observable, throwError, from} from 'rxjs';
import {switchMap} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {IdlObject} from '@eg/core/idl.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {OrgService} from '@eg/core/org.service';
import {StringComponent} from '@eg/share/string/string.component';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {BibRecordService, BibRecordSummary} from '@eg/share/catalog/bib-record.service';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {PauseRefundDialogComponent} from '@eg/staff/share/holdings/pause-refund-dialog.component';
import {ServerStoreService} from '@eg/core/server-store.service';
import {BillingService} from '@eg/staff/share/billing/billing.service';
import {PrintService} from '@eg/share/print/print.service';

/**
 * Dialog for marking items damaged and asessing related bills.
 */

@Component({
  selector: 'eg-mark-damaged-dialog',
  templateUrl: 'mark-damaged-dialog.component.html'
})

export class MarkDamagedDialogComponent
    extends DialogComponent {

    @Input() copyId: number;

    // If the item is checked out, ask the API to check it in first.
    @Input() handleCheckin = false;

    copy: IdlObject;
    bibSummary: BibRecordSummary;
    billingTypes: ComboboxEntry[];

    // Overide the API suggested charge amount
    amountChangeRequested = true; // KCLS JBAS-3129
    newCharge: number;
    newNote: string;
    newBtype: number;
    pauseArgs: any = {};
    dibs = '';

    @ViewChild('successMsg', {static: false}) private successMsg: StringComponent;
    @ViewChild('errorMsg', {static: false}) private errorMsg: StringComponent;
    @ViewChild('pauseRefundDialog', {static: false})
        pauseRefundDialog: PauseRefundDialogComponent;

    // Charge data returned from the server requesting additional charge info.
    chargeResponse: any;

    autoRefundsActive = false;

    constructor(
        private modal: NgbModal, // required for passing to parent
        private toast: ToastService,
        private net: NetService,
        private evt: EventService,
        private pcrud: PcrudService,
        private org: OrgService,
        private billing: BillingService,
        private bib: BibRecordService,
        private store: ServerStoreService,
        private printer: PrintService,
        private auth: AuthService) {
        super(modal); // required for subclassing
    }

    ngOnInit() {
        this.store.getItem('eg.circ.lostpaid.auto_refund')
        .then(value => this.autoRefundsActive = value);
    }


    /**
     * Fetch the item/record, then open the dialog.
     * Dialog promise resolves with true/false indicating whether
     * the mark-damanged action occured or was dismissed.
     */
    open(args: NgbModalOptions): Observable<boolean> {
        this.reset();

        if (!this.copyId) {
            return throwError('copy ID required');
        }

        // Map data-loading promises to an observable
        const obs = from(
            this.getBillingTypes().then(_ => this.getData()));

        // Fire data loading observable and replace results with
        // dialog opener observable.
        return obs.pipe(switchMap(_ => super.open(args)));
    }

    // Fetch-cache billing types
    getBillingTypes(): Promise<any> {
        return this.billing.getUserBillingTypes().then(types => {
            this.billingTypes =
                types.map(bt => ({id: bt.id(), label: bt.name()}));
            this.newBtype = this.billingTypes[0].id;
        });
    }

    getData(): Promise<any> {
        return this.pcrud.retrieve('acp', this.copyId,
            {flesh: 1, flesh_fields: {acp: ['call_number']}}).toPromise()
        .then(copy => {
            this.copy = copy;
            return this.bib.getBibSummary(
                copy.call_number().record()).toPromise();
        }).then(summary => {
                this.bibSummary = summary;
        });
    }

    reset() {
        this.copy = null;
        this.bibSummary = null;
        this.chargeResponse = null;
        this.newCharge = null;
        this.newNote = null;
        //this.amountChangeRequested = false; // KCLS JBAS-3129
        this.pauseArgs = {};
    }

    bTypeChange(entry: ComboboxEntry) {
        this.newBtype = entry.id;
    }

    markDamaged(args: any) {
        this.chargeResponse = null;

        if (!args) { args = {}; }

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

                if (result && !evt) {
                    // Result is a hash of detail info.
                    this.successMsg.current().then(msg => this.toast.success(msg));
                    this.close(true);
                    this.printLetter(result);
                    return;
                }


                if (evt.textcode === 'REFUNDABLE_TRANSACTION_PENDING') {
                    if (this.autoRefundsActive) {
                        this.pauseRefundDialog.refundableXact = evt.payload.mrx;
                        this.pauseRefundDialog.open().subscribe(resp => {
                            this.pauseArgs = resp;
                            this.markDamaged(args);
                        });
                    } else {
                        this.pauseArgs = {no_pause_refund: true};
                        this.markDamaged(args);
                    }
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
                this.errorMsg.current().then(m => this.toast.danger(m));
                console.error(err);
            }
        );
    }

    disableOk(): boolean {
        if (!this.dibs) { return true; }
        return this.amountChangeRequested && (!this.newBtype || !this.newCharge);
    }

    printLetter(details: any) {
        if (!details || !details.circ) { return; } // No one to notify.

        this.printer.print({
            printContext: 'default',
            templateName: 'damaged_item_letter',
            contextData: {
                circulation: details.circ,
                copy: this.copy,
                patron: details.circ.usr(),
                note: details.note,
                cost: parseFloat(details.bill_amount).toFixed(2),
                title: this.bibSummary.display.title,
                dibs: this.dibs,
            }
        });
    }
}

