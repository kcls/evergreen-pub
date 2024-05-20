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


@Component({
  templateUrl: 'lostpaid.component.html',
})
export class CheckinLostPaidComponent implements OnInit, AfterViewInit {

    itemId: number | null = null;
    checkinParams: CheckinParams = null;
    checkinResult: CheckinResult = null;
    invalidCheckin = false;

    itemCondition: string | null = null;
    initials = '';
    processing = false;
    hasCheckinBypassPerms: boolean | null = null;

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

            console.debug('Lost/Paid checkin returned: ', result);

            const lpr = result.firstEvent.payload.lostpaid_checkin_result;

            console.debug('Lost/Paid result', lpr);

            if (lpr.refund_actions) {
                // TODO give printRefundSummary() the needed params so
                // staff can modify certain details in the final printout.
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

        }).then(_ => this.refreshPrintDetails());
    }

    refreshPrintDetails() {
        /*
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
        */
    }


    printLetter(previewOnly?: boolean) {
        /*
        if (previewOnly) {
            this.printer.compileRemoteTemplate(this.printDetails)
            .then(response => {
                this.printPreviewHtml = response.content;
                document.getElementById('print-preview-pane').innerHTML = response.content;
            });
        } else {
            this.printer.print(this.printDetails);
        }
        */
    }
}
