import {Component, OnInit, Output, Input, ViewChild, EventEmitter} from '@angular/core';
import {empty, of, from, Observable} from 'rxjs';
import {tap, concatMap} from 'rxjs/operators';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {OrgService} from '@eg/core/org.service';
import {CircService} from './circ.service';
import {StringComponent} from '@eg/share/string/string.component';
import {AlertDialogComponent} from '@eg/share/dialog/alert.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {CheckinResult, CheckinParams} from './circ.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {PrintService} from '@eg/share/print/print.service';
import {PatronService} from '@eg/staff/share/patron/patron.service';
import {PermService} from '@eg/core/perm.service';

/** Route Item Dialog */

@Component({
  templateUrl: 'lost-paid-confirm-dialog.component.html',
  selector: 'eg-lost-paid-confirm-dialog'
})
export class LostPaidConfirmDialogComponent extends DialogComponent {

    checkinResult: CheckinResult;
    itemCondition: string | null = null;
    initials = '';
    processing = false;
    hasCheckinBypassPerms: boolean | null = null;

    constructor(
        private modal: NgbModal,
        private pcrud: PcrudService,
        private org: OrgService,
        private circ: CircService,
        private perms: PermService,
        public patronService: PatronService,
        private printer: PrintService) {
        super(modal);
    }


    open(ops?: NgbModalOptions): Observable<any> {
        this.itemCondition = null;
        this.initials = '';
        this.processing = false;

        if (this.hasCheckinBypassPerms === null) {
            this.perms.hasWorkPermHere('CHECKIN_BYPASS_REFUND')
            .then(map => this.hasCheckinBypassPerms = map['CHECKIN_BYPASS_REFUND']);
        }

        return super.open(ops);
    }

    refundable(): boolean {
        return this.checkinResult.firstEvent &&
            this.checkinResult.firstEvent.payload &&
            this.checkinResult.firstEvent.payload &&
            this.checkinResult.firstEvent.payload.is_refundable;
    }

    moneySummary(): string {
        return this.checkinResult.firstEvent?.payload?.money_summary || {};
    }

    checkin(skipRefund?: boolean) {
        this.processing = true;

        let params: CheckinParams = this.checkinResult.params;
        params.confirmed_lostpaid_checkin = true;
        params.lostpaid_checkin_skip_processing = skipRefund;
        params.lostpaid_item_condition_ok = this.itemCondition === 'good';

        console.debug('Checking item in with params: ', params);

        this.circ.checkin(params)
        .then(result => {

            console.debug('Lost/Paid checkin returned: ', result);

            const lpr = result.firstEvent.payload.lostpaid_checkin_result;

            console.debug('Lost/Paid result', lpr);

            if (lpr.refund_actions) {
                // Refund succeeded.  Print the summary.
                return this.patronService.printRefundSummary(lpr.refunded_xact);
            } else {

                if (lpr.item_discarded) {
                    // TODO alert staff
                    console.debug('Item Was Discarded');
                }

                if (lpr.transaction_zeroed) {
                    // TODO alert staff
                    console.debug('Transaction was zeroed');
                }
            }

        }).then(_ => this.close());
    }
}

