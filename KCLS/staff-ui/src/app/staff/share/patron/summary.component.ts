import {Component, OnInit, Input, ViewEncapsulation} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {NgbNav, NgbNavChangeEvent} from '@ng-bootstrap/ng-bootstrap';
import {OrgService} from '@eg/core/org.service';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {PrintService} from '@eg/share/print/print.service';
import {PatronService, PatronSummary} from './patron.service';
import {ServerStoreService} from '@eg/core/server-store.service';

@Component({
  templateUrl: 'summary.component.html',
  styleUrls: ['summary.component.css'],
  // Other components use our patron summary border color
  encapsulation: ViewEncapsulation.None,
  selector: 'eg-patron-summary'
})
export class PatronSummaryComponent implements OnInit {

    private _summary: PatronSummary;
    @Input() set summary(s: PatronSummary) {
        if (s && this._summary && s.id !== this._summary.id) {
            this.showDob = this.showDobDefault;
        }
        this._summary = s;
    }

    get summary(): PatronSummary {
        return this._summary;
    }

    showDobDefault = false;
    showDob = false;

    constructor(
        private org: OrgService,
        private net: NetService,
        private printer: PrintService,
        private serverStore: ServerStoreService,
        public patronService: PatronService
    ) {}

    ngOnInit() {
        this.serverStore.getItem('circ.obscure_dob').then(hide => {
            this.showDobDefault = this.showDob = !hide;
        });
    }

    p(): IdlObject { // patron shorthand
        return this.summary ? this.summary.patron : null;
    }

    hasPrefName(): boolean {
        if (this.p()) {
            return (
                this.p().pref_first_given_name() ||
                this.p().pref_second_given_name() ||
                this.p().pref_family_name()
            );
        }
    }

    penaltyLabel(pen: IdlObject): string {
        if (pen.usr_message()) {
            // They don't often have titles, but defaulting to
            // title, assuming it will be shorter and therefore more
            // appropriate for summary display.
            return pen.usr_message().title() || pen.usr_message().message();
        }
        return pen.standing_penalty().label();
    }

    printAddress(addr: IdlObject) {
        this.printer.print({
            templateName: 'patron_address',
            contextData: {
                patron: this.p(),
                address: addr
            },
            printContext: 'default'
        });
    }

    printBarcode() {
        this.printer.print({
            templateName: 'patron_barcode',
            printContext: 'receipt',
            contextData: {barcode: this.p().card().barcode()},
        });
    }

    copyAddress(addr: IdlObject) {
        // Note navigator.clipboard requires special permissions.
        // This is hinky, but gets the job done without the perms.

        const node = document.getElementById(
            `patron-address-copy-${addr.id()}`) as HTMLTextAreaElement;

        // Un-hide the textarea just long enough to copy its data.
        // Using node.style instead of *ngIf in hopes it
        // will be quicker, so the user never sees the textarea.
        node.style.visibility = 'visible';
        node.style.display = 'block';
        node.focus();
        node.select();

        if (!document.execCommand('copy')) {
            console.error('Copy command failed');
        }

        node.style.visibility = 'hidden';
        node.style.display = 'none';
    }

    copyBarcode() {
        const node =
            document.getElementById(`patron-barcode-copy`) as HTMLTextAreaElement;

        node.style.visibility = 'visible';
        node.style.display = 'block';
        node.focus();
        node.select();

        if (!document.execCommand('copy')) {
            console.error('Copy command failed');
        }

        node.style.visibility = 'hidden';
        node.style.display = 'none';
    }

    orgSn(orgId: number): string {
        const org = this.org.get(orgId);
        return org ? org.shortname() : '';
    }

    patronPickupLib(): string {
        const plSet = this.summary.patron.settings()
            .filter(s => s.name() === 'opac.default_pickup_location')[0];

        if (plSet && plSet.value()) {
            return this.orgSn(Number(JSON.parse(plSet.value())));
        } else {
            return this.orgSn(this.summary.patron.home_ou());
        }
    }

    patronStatusColor(): string {
        return this.patronService.patronStatusColor(this.p(), this.summary);
    }

    addrIsMailing(addr: IdlObject): boolean {
        return this.p().mailing_address() &&
            this.p().mailing_address().id() === addr.id();
    }

    addrIsBilling(addr: IdlObject): boolean {
        return this.p().billing_address() &&
            this.p().billing_address().id() === addr.id();
    }

   getStatCatValue(catId: number): string {
        if (this.p() && this.p().stat_cat_entries()) {
            const map = this.p()
                .stat_cat_entries().filter(e => e.stat_cat() === catId)[0];

            if (map) { return map.stat_cat_entry(); }
        }
        return '';
    }

    lastActivity(): IdlObject {
        if (this.p()) { return this.p().usr_activity()[0]; }
        return null;
    }

    lastActivityLabel(): string {
        const act = this.lastActivity();
        if (act) { return act.etype().label(); }
        return '';
    }
}

