import {Component, OnInit, Renderer2, ViewChild} from '@angular/core';
import {ActivatedRoute, ParamMap} from '@angular/router';
import {tap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {EventService} from '@eg/core/event.service';
import {PermService} from '@eg/core/perm.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';
import {RefundsService} from './refunds.service';

/** Show refundable payment details and support approval actions */

@Component({
    templateUrl: 'detail.component.html',
    styleUrls: ['detail.component.css']
})
export class RefundDetailComponent implements OnInit {

    rfXactId: number;
    mrxs: IdlObject;
    usrSummary: IdlObject;
    notesUpdatePending: boolean;
    refundableActions: any[] = [];
    canPause: boolean;
    canApprove: boolean;
    processDate: string;
    loading: boolean;

    @ViewChild('confirmApprove', {static: false})
        private confirmApprove: ConfirmDialogComponent;
    @ViewChild('confirmReject', {static: false})
        private confirmReject: ConfirmDialogComponent;
    @ViewChild('confirmPause', {static: false})
        private confirmPause: ConfirmDialogComponent;
    @ViewChild('confirmReset', {static: false})
        private confirmReset: ConfirmDialogComponent;

    @ViewChild('confirmUndoApprove', {static: false})
        private confirmUndoApprove: ConfirmDialogComponent;
    @ViewChild('confirmUndoReject', {static: false})
        private confirmUndoReject: ConfirmDialogComponent;
    @ViewChild('confirmUndoPause', {static: false})
        private confirmUndoPause: ConfirmDialogComponent;

    constructor(
        private route: ActivatedRoute,
        private net: NetService,
        private evt: EventService,
        private perms: PermService,
        private auth: AuthService,
        private pcrud: PcrudService,
        private refunds: RefundsService
    ) {
        this.route.paramMap.subscribe((params: ParamMap) => {
            this.rfXactId = +params.get('id');
        });
    }

    ngOnInit() {
       this.load();
    }

    state(): number {
        if (!this.mrxs) {
            return null;
        } else if (this.mrxs.refund_session()) {
            return 1; // already refunded
        } else if (this.mrxs.approve_date()) {
            return 2; // approved
        } else if (this.mrxs.reject_date()) {
            return 3; // rejected
        } else if (this.mrxs.pause_date()) {
            return 4; // paused
        } else if (!this.mrxs.xact().circulation().checkin_scan_time()) {
            return 6; // Not yet refundable
        } else {
            return 5; // pending
        }
    }

    async load() {
        if (!this.rfXactId) { return Promise.resolve(); }

        this.loading = true;

        return this.pcrud.retrieve('mrxs', this.rfXactId, {
            flesh: 4,
            flesh_fields: {
                mrxs: ['refundable_payments', 'xact', 'usr',
                    'approved_by', 'rejected_by', 'paused_by'],
                mbt: ['payments', 'billings', 'circulation'],
                mb: ['btype']
            },

        }).toPromise().then(mrxs => {
            this.mrxs = mrxs;

            // Sort payments and billings in descending order of creation
            mrxs.xact().payments(
                mrxs.xact().payments().sort(
                    (a, b) => a.payment_ts() > b.payment_ts() ? -1 : 1)
            );

            mrxs.xact().billings(
                mrxs.xact().billings().sort(
                    (a, b) => a.billing_ts() > b.billing_ts() ? -1 : 1)
            );

            return this.pcrud.search(
                'mus', {usr: mrxs.usr().id()}, {}, {atomic: true})
            .toPromise().then(sum => this.usrSummary = sum ? sum[0] : null);

        }).then(_ => {

            if (this.state() === 1) {
                // Transaction exported.  No further actions allowed.
                this.canPause = this.canApprove = false;
                return;
            }

            if (this.state() === 4 || this.state() === 5) {
                this.net.request(
                    'open-ils.circ',
                    'open-ils.circ.refundable_xact.refund_date',
                    this.auth.token(), this.mrxs.id()
                ).subscribe(dateStr => this.processDate = dateStr);
            }

            const homeou = this.mrxs.usr().home_ou();
            return this.perms.hasWorkPermAt([
                'ADMIN_REFUNDABLE_PAYMENT', 'APPROVE_REFUNDABLE_REFUND'], true)
            .then(perms => {
                this.canPause =
                    perms.ADMIN_REFUNDABLE_PAYMENT.includes(homeou);
                this.canApprove =
                    perms.APPROVE_REFUNDABLE_REFUND.includes(homeou);
            });

        }).then(_ => this.loadRefundActions()
        ).then(_ => this.loading = false);
    }

    loadRefundActions() {

        if (this.refundableActions.length > 0) {
            // Refundable actions already calculated
            return Promise.resolve();
        }

        if (this.state() > 1 && this.state() < 6) {
            // Xact has not been refunded -- fetch the simulated refund.
            return this.net.request(
                'open-ils.circ',
                'open-ils.circ.refundable_xact.refund.simulate',
                this.auth.token(), this.rfXactId
            ).pipe(tap(action => this.refundableActions.push(action)))
            .toPromise();
        }

        // Transaction has been processed.
        // Fetch the refund actions
        return this.pcrud.search('mract',
            {refundable_xact: this.rfXactId},
            {flesh: 1, flesh_fields: {mract: ['payment']}}

        ).pipe(tap(
            action => {
                // Map in-database refund_action's to something akin
                // to the actions returned by the simulate API.

                this.refundableActions.push({
                    zeroing: action.action() === 'credit',
                    payment: action.payment()
                });
            }

        )).toPromise().then(_ => {

            // Indicate on the last action in the list the refund
            // amount owed to the patron for consistency with
            // the display of simulated/anticipated refund actions.
            if (this.refundableActions.length > 0) {
                const last = this.refundableActions[this.refundableActions.length - 1];
                last.refund_due = this.mrxs.refund_amount();
            }
        });
    }

    approveRefund(undo?: boolean) {
        const dialog = undo ? this.confirmUndoApprove : this.confirmApprove;
        dialog.open().subscribe(
            yes => {
                if (yes) {
                    return this.performUpdate({approve: true, undo: undo});
                }
            }
        );
    }

    rejectRefund(undo?: boolean) {
        const dialog = undo ? this.confirmUndoReject : this.confirmReject;
        dialog.open().subscribe(
            yes => {
                if (yes) {
                    return this.performUpdate({reject: true, undo: undo});
                }
            }
        );
    }

    pauseRefund(undo?: boolean) {
        const dialog = undo ? this.confirmUndoPause : this.confirmPause;
        dialog.open().subscribe(
            yes => {
                if (yes) {
                    return this.performUpdate({pause: true, undo: undo});
                }
            }
        );
    }

    updateNotes() {
        this.performUpdate({notes: this.mrxs.notes()}).then(
            ok => {
                this.notesUpdatePending = false;
            },
            err => {
                console.error(err);
            }
        );
    }

    async performUpdate(args: any) {
        return this.net.request(
            'open-ils.circ',
            'open-ils.circ.refundable_xact.update',
            this.auth.token(), this.mrxs.id(), args
        ).toPromise().then(result => {
            const evt = this.evt.parse(result);
            if (evt) {
                // TODO: toast
                console.error(evt);
            } else {
                return this.load();
            }
        });
    }
}


