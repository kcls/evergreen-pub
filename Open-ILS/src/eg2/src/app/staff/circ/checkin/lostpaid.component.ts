import {Component, ViewChild, OnInit, AfterViewInit, HostListener} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {empty, from} from 'rxjs';
import {concatMap, tap} from 'rxjs/operators';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {PrintService} from '@eg/share/print/print.service';
import {CircService, CheckinParams, CheckinResult} from '../../share/circ/circ.service';
import {StoreService} from '@eg/core/store.service';
import {PermService} from '@eg/core/perm.service';
import {PatronService} from '@eg/staff/share/patron/patron.service';
import {EventService} from '@eg/core/event.service';
import {WinService} from '@eg/core/win.service';
import {BroadcastService} from '@eg/share/util/broadcast.service';

declare var encodeJS: (jsThing: any) => any;

@Component({
  templateUrl: 'lostpaid.component.html',
})
export class CheckinLostPaidComponent implements OnInit, AfterViewInit {

    checkinParams: CheckinParams = null;
    checkinResult: CheckinResult = null;
    invalidCheckin = false;
    printPreviewHtml = '';

    itemCondition: string | null = null;
    initials = '';
    processing = false;
    hasCheckinBypassPerms: boolean | null = null;
    refundedCircId: number | null = null;
    xactWasZeroed = false;
    itemWasDiscarded = false;
    checkinComplete = false;
    makingPrintPreview = false;
    skipRefund = false;

    sourceWindow = 0;

    // affects display if trying to print a non-refunded circ
    circWasNotRefunded = false;

    // Took too long
    exceedsReturnDate = false;

    // Item type, etc.
    itemNotRefundable = false;

    reprinting = false;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private net: NetService,
        private org: OrgService,
        private perms: PermService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private circ: CircService,
        private store: StoreService,
        private evt: EventService,
        public patronService: PatronService,
        private printer: PrintService,
        private win: WinService,
        private broadcaster: BroadcastService,
    ) {}

    ngOnInit() {
        this.itemCondition = null;
        this.initials = '';
        this.processing = false;
        this.circWasNotRefunded = false;

        this.checkinParams = this.store.getLocalItem('circ.lostpaid.params');

        // Clean it up
        this.store.removeLocalItem('circ.lostpaid.params');

        // Will be set if we are going straight to the letter
        this.refundedCircId = +this.route.snapshot.paramMap.get('circId');
        this.sourceWindow = +this.route.snapshot.queryParamMap.get('window');

        if (this.refundedCircId) {
            this.reprinting = true;
            this.printLetter(true);
            return;

        } else if (!this.checkinParams) {
            this.invalidCheckin = true;
            return;
        }

        // Let the circ service know we're on top of things.
        this.checkinParams._lostpaid_checkin_in_progress = true;

        if (this.hasCheckinBypassPerms === null) {
            this.perms.hasWorkPermHere('CHECKIN_BYPASS_REFUND')
            .then(map => this.hasCheckinBypassPerms = map['CHECKIN_BYPASS_REFUND']);
        }



        // Re-run the checkin so we can see what the server
        // reports about the item.
        this.circ.applySettings()
            .then(_ => this.circ.checkin(this.checkinParams))
            .then(res => this.checkinResult = res);
    }

    ngAfterViewInit() {
    }

    moneySummary(): string {
        return this.checkinResult.firstEvent?.payload?.money_summary || {};
    }

    refundable(): boolean {
        return this.checkinResult.firstEvent &&
            this.checkinResult.firstEvent.payload &&
            this.checkinResult.firstEvent.payload &&
            this.checkinResult.firstEvent.payload.is_refundable;
    }

    notRefundableReason(): string {
        if (this.refundable()) {
            return '';
        }
        return this.checkinResult.firstEvent.payload.not_refundable_reason;
    }

    checkin(skipRefund?: boolean) {
        this.skipRefund = Boolean(skipRefund);
        this.processing = true;
        this.xactWasZeroed = false;
        this.itemWasDiscarded = false;

        let params: CheckinParams = this.checkinParams;
        params.confirmed_lostpaid_checkin = true;
        params.lostpaid_checkin_skip_processing = skipRefund;
        params.lostpaid_staff_initials = this.initials;

        // May be null if we didn't need to ask about the condition.
        params.lostpaid_item_condition_ok = this.itemCondition !== 'bad';

        console.debug('Checking item in with params: ', params);

        this.circ.checkin(params)
        .then(result => {
            this.processing = false;
            this.checkinComplete = true;
            this.itemNotRefundable = false;
            this.exceedsReturnDate = false;
            this.xactWasZeroed = false;
            this.itemWasDiscarded = false;

            console.debug('Lost/Paid checkin returned: ', result);

            const lpr = result.firstEvent.payload.lostpaid_checkin_result;

            console.debug('Lost/Paid result', lpr);

            let dataRaw = encodeJS(result);
            console.debug('Broadcasting', dataRaw);

            this.broadcaster.broadcast(
                'eg.checkin.lostpaid.result',
                {result: dataRaw, window: this.sourceWindow}
            );

            this.refundedCircId = lpr.refunded_xact;

            if (lpr.refund_actions) {
                this.printLetter(true);

            } else {

                if (lpr.item_discarded) {
                    this.itemWasDiscarded = true;
                }

                if (lpr.transaction_zeroed) {
                    this.xactWasZeroed = true;
                }
            }
        });
    }

    printLetter(previewOnly?: boolean): Promise<any> {
        this.makingPrintPreview = true;
        this.circWasNotRefunded = false;

        return this.net.request(
            'open-ils.circ',
            'open-ils.circ.refundable_payment.letter.by_xact.data',
            this.auth.token(), this.refundedCircId
        ).toPromise().then(data => {
            this.makingPrintPreview = false;
            let evt = this.evt.parse(data);

            if (evt) {
                if (evt.textcode === 'XACT_NOT_REFUNDED') {
                    this.circWasNotRefunded = true;
                    return;
                }
                // Unexpected event.
                console.error(evt);
                alert(evt);
                return;
            }

            const printDetails = {
                templateName: 'refund_summary',
                contextData: data,
                contentType: 'text/html',
                printContext: 'default'
            };

            if (previewOnly) {
                this.printer.compileRemoteTemplate(printDetails)
                .then(response => {
                    this.printPreviewHtml = response.content;
                    document.getElementById('print-preview-pane').innerHTML = response.content;
                });
            } else {
                this.printer.print(printDetails);
            }
        });
    }

    close() {
        window.close();
    }
}
