import {Injectable, EventEmitter} from '@angular/core';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';
import {PatronService, PatronSummary, PatronStats, PatronAlerts
    } from '@eg/staff/share/patron/patron.service';
import {PatronSearch} from '@eg/staff/share/patron/search.component';
import {StoreService} from '@eg/core/store.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {CircService, CircDisplayInfo} from '@eg/staff/share/circ/circ.service';
import {PrintService} from '@eg/share/print/print.service';

export interface BillGridEntry extends CircDisplayInfo {
    xact: IdlObject; // mbt
    billingLocation?: string;
    paymentPending?: number;
}

export interface CircGridEntry {
    index: number;
    title?: string;
    author?: string;
    isbn?: string;
    copy?: IdlObject;
    circ?: IdlObject;
    volume?: IdlObject;
    record?: IdlObject;
    dueDate?: string;
    copyAlertCount: number;
    nonCatCount: number;
    patron: IdlObject;
}

const PATRON_FLESH_FIELDS = [
    'card',
    'cards',
    'settings',
    'standing_penalties',
    'addresses',
    'billing_address',
    'mailing_address',
    'waiver_entries',
    'usr_activity',
    'notes',
    'profile',
    'net_access_level',
    'stat_cat_entries',
    'ident_type',
    'ident_type2',
    'groups'
];

@Injectable()
export class PatronContextService {

    summary: PatronSummary;
    loaded = false;
    lastPatronSearch: PatronSearch;
    searchBarcode: string = null;

    // These should persist tab changes
    checkouts: CircGridEntry[] = [];

    maxRecentPatrons = 1;

    settingsCache: {[key: string]: any} = {};

    constructor(
        private store: StoreService,
        private serverStore: ServerStoreService,
        private org: OrgService,
        private auth: AuthService,
        private net: NetService,
        private circ: CircService,
        private printer: PrintService,
        public patrons: PatronService
    ) {}

    reset() {
        this.summary = null;
        this.loaded = false;
        this.lastPatronSearch = null;
        this.searchBarcode = null;
        this.checkouts = [];
    }

    loadPatron(id: number): Promise<any> {
        this.loaded = false;
        this.checkouts = [];
        return this.refreshPatron(id).then(_ => this.loaded = true);
    }

    // Update the patron data without resetting all of the context data.
    refreshPatron(id?: number): Promise<any> {

        if (!id) {
            if (!this.summary) {
                return Promise.resolve();
            } else {
                id = this.summary.id;
            }
        }

        return this.patrons.getFleshedById(id, PATRON_FLESH_FIELDS)
        .then(p => this.summary = new PatronSummary(p))
        .then(_ => this.getPatronStats(id))
        .then(_ => this.compileAlerts())
        .then(_ => this.addRecentPatron());
    }

    addRecentPatron(patronId?: number): Promise<any> {

        if (!patronId) { patronId = this.summary.id; }

        return this.serverStore.getItem('ui.staff.max_recent_patrons')
        .then(num => {
            if (num) { this.maxRecentPatrons = num; }

            const patrons: number[] =
                this.store.getLoginSessionItem('eg.circ.recent_patrons') || [];

            patrons.splice(0, 0, patronId);  // put this user at front
            patrons.splice(this.maxRecentPatrons, 1); // remove excess

            // remove any other occurrences of this user, which may have been
            // added before the most recent user.
            const idx = patrons.indexOf(patronId, 1);
            if (idx > 0) { patrons.splice(idx, 1); }

            this.store.setLoginSessionItem('eg.circ.recent_patrons', patrons);
        });
    }

    getPatronStats(id: number): Promise<any> {

        // When quickly navigating patron search results it's possible
        // for this.patron to be cleared right before this function
        // is called.  Exit early instead of making an unneeded call.
        if (!this.summary) { return Promise.resolve(); }

        return this.patrons.getVitalStats(this.summary.patron)
        .then(stats => this.summary.stats = stats);
    }

    patronAlertsShown(): boolean {
        if (!this.summary) { return false; }
        this.store.addLoginSessionKey('eg.circ.last_alerted_patron');
        const shown = this.store.getLoginSessionItem('eg.circ.last_alerted_patron');
        if (shown === this.summary.patron.id()) { return true; }
        this.store.setLoginSessionItem('eg.circ.last_alerted_patron', this.summary.patron.id());
        return false;
    }

    compileAlerts(): Promise<any> {

        // User navigated to a different patron mid-data load.
        if (!this.summary) { return Promise.resolve(); }

        return this.patrons.compileAlerts(this.summary)
        .then(alerts => {
            this.summary.alerts = alerts;

            if (this.searchBarcode) {
                const card = this.summary.patron.cards()
                    .filter(c => c.barcode() === this.searchBarcode)[0];
                this.summary.alerts.retrievedWithInactive =
                    card && card.active() === 'f';
                this.searchBarcode = null;
            }
        });
    }

    orgSn(orgId: number): string {
        const org = this.org.get(orgId);
        return org ? org.shortname() : '';
    }

    formatXactForDisplay(xact: IdlObject): BillGridEntry {

        const entry: BillGridEntry = {
            xact: xact,
            paymentPending: 0
        };

        if (xact.summary().xact_type() !== 'circulation') {

            entry.xact.grocery().billing_location(
                this.org.get(entry.xact.grocery().billing_location()));

            entry.title = xact.summary().last_billing_type();
            entry.billingLocation =
                xact.grocery().billing_location().shortname();
            return entry;
        }

        entry.xact.circulation().circ_lib(
            this.org.get(entry.xact.circulation().circ_lib()));

        const circDisplay: CircDisplayInfo =
            this.circ.getDisplayInfo(xact.circulation());

        entry.billingLocation =
            xact.circulation().circ_lib().shortname();

        return Object.assign(entry, circDisplay);
    }

    printLostPaidByPayment(paymentId: number): Promise<any> {
        if (!paymentId) { return; }

        return this.net.request('open-ils.circ',
            'open-ils.circ.refundable_payment.receipt.by_pay.html',
            this.auth.token(), paymentId

        ).toPromise().then(receipt => {

            if (receipt &&
                receipt.textcode === 'MONEY_REFUNDABLE_XACT_SUMMARY_NOT_FOUND') {
                alert('Cannot generate lost/paid receipt for payment #' + paymentId);
                return;
            }

            if (!receipt || !receipt.template_output()) {
                return alert(
                    'Error creating refundable payment receipt for payment ' + paymentId);
            }

            const html = receipt.template_output().data();

            this.printer.print({
                text: html,
                contentType: 'text/html',
                printContext: 'default'
            });
        });
    }

    printLostPaid(xactId: number): Promise<any> {

        if (!xactId) { return; }

        return this.net.request('open-ils.circ',
            'open-ils.circ.refundable_payment.receipt.by_xact.html',
            this.auth.token(), xactId

        ).toPromise().then(receipt => {

            if (receipt &&
                receipt.textcode === 'MONEY_REFUNDABLE_XACT_SUMMARY_NOT_FOUND') {
                alert('Cannot generate lost/paid receipt for transaction #' + xactId);
                return;
            }

            if (!receipt || !receipt.template_output()) {
                return alert(
                    'Error creating refundable payment receipt for payment ' + xactId);
            }

            const html = receipt.template_output().data();

            this.printer.print({
                text: html,
                contentType: 'text/html',
                printContext: 'default'
            });
        });
    }
}


