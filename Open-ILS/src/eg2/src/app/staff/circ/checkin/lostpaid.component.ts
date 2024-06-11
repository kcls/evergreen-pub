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
import {PrintService} from '@eg/share/print/print.service';
import {CircService, CheckinParams, CheckinResult} from '../../share/circ/circ.service';
import {StoreService} from '@eg/core/store.service';
import {PermService} from '@eg/core/perm.service';
import {PatronService} from '@eg/staff/share/patron/patron.service';
import {EventService} from '@eg/core/event.service';


@Component({
  templateUrl: 'lostpaid.component.html',
})
export class CheckinLostPaidComponent implements OnInit, AfterViewInit {

    itemId: number | null = null;
    checkinParams: CheckinParams = null;
    checkinResult: CheckinResult = null;
    invalidCheckin = false;
    printPreviewHtml = '';

    itemCondition: string | null = null;
    initials = '';
    processing = false;
    hasCheckinBypassPerms: boolean | null = null;
    refundedCircId: number | null = null;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private ngLocation: Location,
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
    ) {}

    ngOnInit() {
        this.itemId = +this.route.snapshot.paramMap.get('id');
        this.checkinParams = this.store.getLocalItem('circ.lostpaid.params');
        // Clean it up
        this.store.removeLocalItem('circ.lostpaid.params');

        if (!this.checkinParams) {
            this.invalidCheckin = true;
            return;
        }

        this.itemCondition = null;
        this.initials = '';
        this.processing = false;

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

    checkin(skipRefund?: boolean) {
        this.processing = true;

        let params: CheckinParams = this.checkinParams;
        params.confirmed_lostpaid_checkin = true;
        params.lostpaid_checkin_skip_processing = skipRefund;
        params.lostpaid_item_condition_ok = this.itemCondition === 'good';

        console.debug('Checking item in with params: ', params);

        this.circ.checkin(params)
        .then(result => {
            this.processing = false;

            console.debug('Lost/Paid checkin returned: ', result);

            const lpr = result.firstEvent.payload.lostpaid_checkin_result;

            console.debug('Lost/Paid result', lpr);

            if (!lpr) {
                // Will happen when we skip processing, but there's also
                // potential edge cases where this occurs.
                if (!params.lostpaid_checkin_skip_processing) {
                    console.error("No lost/paid result data was returned!");
                    return;
                } else {
                    // Close the window or display some info to staff?
                }
            }

            this.refundedCircId = lpr.refunded_xact;

            if (lpr.refund_actions) {
                this.printLetter(true);

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
        });
    }

    printLetter(previewOnly?: boolean): Promise<any> {
        return this.net.request(
            'open-ils.circ',
            'open-ils.circ.refundable_payment.letter.by_xact.data',
            this.auth.token(), this.refundedCircId
        ).toPromise().then(data => {
            let evt = this.evt.parse(data);

            if (evt) {
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
