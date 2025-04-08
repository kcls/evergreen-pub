import {Component, Input, ViewChild} from '@angular/core';
import {Location} from '@angular/common';
import {NetService} from '@eg/core/net.service';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {OrgService} from '@eg/core/org.service';
import {switchMap, concatMap} from 'rxjs/operators';
import {Observable, tap, from, throwError} from 'rxjs';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {ServerStoreService} from '@eg/core/server-store.service';

@Component({
  selector: 'eg-item-request-dialog',
  templateUrl: 'dialog.component.html'
})

export class ItemRequestDialogComponent extends DialogComponent {

    request: IdlObject = null;
    requestId: number | null = null;
    // Clone of in-database request for comparison.
    sourceRequest: IdlObject = null;
    // For creating mediated requests
    patronBarcode = '';
    patronNotFound = false;

    disabledPickupOrgs = [];
    illDenialSelectorVal = '';
    illDenialOptions: IdlObject[] = [];
    patronIllAllowed = true;
    patronRequestsAllowed = true;
    maxRequestsAllowed: number | null = null;
    patronActiveRequestCount = 0;
    patronHasMaxRequests = false;
    patronHasOverdueIll = false;

    formats: IdlObject[] = [];
    audiences: IdlObject[] = [];
    languages: IdlObject[] = [];

    @Input() mode: 'edit' | 'create' = 'edit';

    constructor(
        private modal: NgbModal,
        private ngLocation: Location,
        private toast: ToastService,
        private idl: IdlService,
        private net: NetService,
        private evt: EventService,
        private pcrud: PcrudService,
        private org: OrgService,
        private auth: AuthService,
        private serverStore: ServerStoreService
    ) {
        super(modal); // required for subclassing
    }

    open(args: NgbModalOptions): Observable<boolean> {
        this.request = null;
        this.sourceRequest = null;
        this.patronBarcode = null;
        this.resetCreate();

        if (this.mode === 'create') {
            return from(this.loadOptions().then(_ => this.loadCreateData())).pipe(switchMap(_ => super.open(args)));
        }

        if (!this.requestId) {
            return throwError('request ID required');
        }

        // Fire data loading observable and replace results with
        // dialog opener observable.
        return from(this.loadOptions().then(_ => this.loadRequest())).pipe(switchMap(_ => super.open(args)));
    }

    // TODO
    loadOptions(): Promise<any> {
        if (this.formats.length > 0) {
            return Promise.resolve();
        }

        return this.pcrud.retrieveAll(
            'cuirf',
            {order_by: {cuirf: 'position'}},
            {atomic: true}
        ).toPromise()
        .then(formats => this.formats = formats)
        .then(_ => {
            return this.pcrud.retrieveAll(
                'cuira',
                {order_by: {cuirf: 'position'}},
                {atomic: true}
            ).toPromise()
            .then(audiences => this.audiences = audiences);
        })
        .then(_ => {
            return this.pcrud.retrieveAll(
                'cuirl',
                {order_by: {cuirf: 'position'}},
                {atomic: true}
            ).toPromise()
        })
        .then(langs => {
            // Move the default language to the front of the list
            const index = langs.findIndex(l => l.is_default() === 't');
            if (index > -1) {
                const lang = langs[index];
                langs.splice(index, 1);
                langs.unshift(lang);
            }
            this.languages = langs;
        });
    }

    loadCreateData(): Promise<any> {
        return this.setMaxRequests().then(_ => this.applyPickupOrgs());
    }

    setMaxRequests(): Promise<any> {
        if (this.maxRequestsAllowed !== null) {
            return Promise.resolve();
        }
        return this.serverStore.getItem('patron_requests.max_active')
        .then(count => this.maxRequestsAllowed = count ? Number(count) : 20);
    }

    applyPickupOrgs(): Promise<any> {
        if (this.disabledPickupOrgs.length > 0) {
            return Promise.resolve();
        }

		return this.net.request(
            'open-ils.actor',
            'open-ils.actor.settings.value_for_all_orgs.atomic',
            this.auth.token(),
            'opac.holds.org_unit_not_pickup_lib'
        ).toPromise().then(list => {
            list.forEach(setting => {
                if (setting.summary.value) {
                    this.disabledPickupOrgs.push(setting.org_unit);
                }
            });

            // Now add the org units where can_have_vols is false
            // dupes are fine.
            this.org.list().forEach(org => {
                if (org.ou_type().can_have_vols() === 'f') {
                    this.disabledPickupOrgs.push(org.id());
                }
            });
        });
    }

    orgSn(id: number): string {
        let org = this.org.get(id);
        return org ? org.shortname() : '';
    }

    orgName(id: number): string {
        let org = this.org.get(id);
        return org ? org.name() : '';
    }

    resetCreate() {
        this.patronNotFound = false;
        this.patronIllAllowed = true;
        this.patronRequestsAllowed = true;
        this.patronHasMaxRequests = false;
        this.patronHasOverdueIll = false;

        this.request = this.idl.create('auir');

        this.request.route_to(null);
        this.request.ill_opt_out(null);
        this.request.pickup_lib(null);

        this.sourceRequest = this.idl.clone(this.request);
    }

    findPatron() {
        this.resetCreate();

        if (!this.patronBarcode) {
            return;
        }

        this.pcrud.search(
            'ac',
            {'barcode': this.patronBarcode},
            {'flesh': 1, 'flesh_fields': {'ac': ['usr']}}
        ).toPromise().then(card => {
            if (!card) {
                this.patronNotFound = true;
                this.request.usr(null);
                return;
            }

            // Swap the fleshing
            let patron = card.usr();
            card.usr(patron.id());
            patron.card(card);

            this.request.usr(patron);

            return patron;
        }).then(patron => {
            if (!patron) { return null; }
            return this.loadPatronAccess(patron.id());
        });
    }

    // Load info about what this user can access.
    loadPatronAccess(patronId: number): Promise<void> {
        return this.net.request(
            'open-ils.actor',
            'open-ils.actor.patron.patron-request.access',
            this.auth.token(), patronId,
        ).toPromise().then(access => {

            this.patronRequestsAllowed = Number(access.create_allowed) === 1;
            this.patronActiveRequestCount = Number(access.active_request_count);
            this.patronHasOverdueIll = Number(access.has_overdue_ill) == 1;
            this.patronIllAllowed = Number(access.ill_allowed) === 1;
            this.patronHasMaxRequests = Number(access.at_max_requests) === 1;

            if (this.mode === 'create') {
                this.request.pickup_lib(access.pickup_lib);

                if (!this.patronIllAllowed || this.patronHasOverdueIll) {
                    this.request.ill_opt_out(true);
                    this.request.route_to('acq');
                }
            }
        });
    }

    setFormat(code: string) {
        this.request.format(this.formats.filter(f => f.code() === code)[0]);
    }
    setAudience(code: string) {
        this.request.audience(this.audiences.filter(f => f.code() === code)[0]);
    }
    setLanguage(code: string) {
        this.request.language(this.languages.filter(f => f.code() === code)[0]);
    }

    loadRequest(): Promise<void> {
        const flesh = {
            flesh: 2,
            flesh_fields: {
                auir: ['usr', 'claimed_by', 'format', 'language', 'audience'],
                au: ['card']
            }
        };

        return this.pcrud.retrieve('auir', this.requestId, flesh)
        .toPromise().then(req => {
            this.request = req;
            this.sourceRequest = this.idl.clone(req);

            // IF staff want to see info on the patron while editing
            // existing requests, add this to the promise chain.
            // return this.loadPatronAccess(req.usr().id()) ...

            return this.net.request(
                'open-ils.actor',
                'open-ils.actor.patron-request.status',
                this.auth.token(), req.id())
            .pipe(tap(stat => req._status = stat.status))
            .toPromise()
        });
    }

    save(claim?: boolean): Promise<void> {
        if (claim) {
            this.request.claimed_by(this.auth.user().id());
            this.request.claim_date('now');
        }

        // Various changes to the request require we update the
        // routing info.  However, we don't want to override any
        // routing info manually applied by staff
        if (this.mode !== 'create') {
            if (this.request.route_to() === this.sourceRequest.route_to()) {
                if (this.request.pubdate() !== this.sourceRequest.pubdate() ||
                    this.request.format() !== this.sourceRequest.format()) {

                    // Clear the value to force an update.
                    this.request.route_to(null);
                }
            }
        }

        let promise = Promise.resolve();

        if (!this.request.route_to()) {
            promise = this.net.request(
                'open-ils.actor',
                'open-ils.actor.patron-request.get_route_to',
                this.auth.token(), this.request
            ).toPromise().then(routeTo => {
                console.log('Route-To calculated as ' + routeTo);
                this.request.route_to(routeTo);
            });
        }

        let lineitem = null;
        if (this.request.lineitem() !== this.sourceRequest.lineitem()) {
            // Applying a line item value requires special care.
            // Save + remove the value so we can update it separately.
            lineitem = this.request.lineitem();
            this.request.lineitem(null);
        }

        if (this.mode !== 'create') {
            return promise.then(_ => {
                this.pcrud.update(this.request).toPromise()
                .then(_ => this.applyLineitem(lineitem))
                .then(_ => this.close(true))
            });
        } else {
            return promise.then(_ => {
                const req = this.idl.clone(this.request);

                req.usr(this.request.usr().id());
                req.requestor(this.auth.user().id());
                req.format(this.request.format()?.code());
                req.language(this.request.language()?.code());
                req.audience(this.request.audience()?.code());

                return this.pcrud.create(req).toPromise()
                .then(_ => this.close(true))
            });
        }
    }

    applyLineitem(lineitem: number | null): Promise<any> {
        if (!lineitem) { return Promise.resolve(); }

        return this.net.request(
            'open-ils.actor',
            'open-ils.actor.patron-request.lineitem.apply',
            this.auth.token(), this.requestId, lineitem)
        .toPromise()
        .then(resp => {
            console.log('Applying lineitem returned: ', resp);

            const evt = this.evt.parse(resp);
            if (evt) {
                alert($localize`Error applying lineitem ${evt}`);
                return;
            }

            this.toast.success($localize`Hold successfully placed`);
        });
    }

    clearClaimedBy() {
        this.request.claimed_by(null);
        this.request.claim_date(null);
    }

    getStatus(): string {
        return this.request._status;
    }

    setStatus(code: string) {
        switch (code) {
            case 'complete':
                this.request.cancel_date(null);
                this.request.reject_date(null);
                this.request.rejected_by(null);
                this.request.reject_reason(null);
                this.request.complete_date('now');
                break;

            case 'rejected':
                this.request.cancel_date(null);
                this.request.reject_date('now');
                this.request.rejected_by(this.auth.user().id());
                this.request.complete_date(null);
                break;

            case 'active':
                this.request.cancel_date(null);
                this.request.reject_date(null);
                this.request.rejected_by(null);
                this.request.complete_date(null);
                break;
        }
    }

    illDenialChanged(content) {
        this.request.ill_denial(content);
    }

    disableSave(): boolean {
        if (!this.request) { return true; }
        if (!this.request.usr()) { return true; }
        if (!this.request.title()) { return true; }
        if (!this.request.format()) { return true; }

        if (this.mode === 'create') {
            return (
                !this.request.pickup_lib() ||
                !this.patronRequestsAllowed ||
                this.patronHasMaxRequests
            );
        }

        // In edit mode, avoid disabling save for existing requests just
        // because of patron blocks. Let staff decide how to handle those cases.
        return false;
    }

    // True if the UI should indicate something about the patron, but
    // not necessarily if all actions should be blocked.
    patronHasBlocks(): boolean {
        return (
            !this.patronRequestsAllowed ||
            !this.patronIllAllowed ||
            this.patronHasOverdueIll ||
            this.patronHasMaxRequests
        );
    }
}


