import {Injectable, EventEmitter} from '@angular/core';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';

interface PatronAccess {
    create_allowed: boolean,
    has_overdue_ill: boolean,
    ill_allowed: boolean,
    active_request_count: number,
    max_allowed: number,
    at_max_requests: boolean,
    pickup_lib: number,
}

@Injectable()
export class RequestsService {
    formats: Array<Hash> = [];
    languages: Array<Hash> = [];
    audiences: Array<Hash> = [];

    selectedFormat: string | null = null;
    requestsAllowed = true;
    activeRequestCount = 0;
    maxRequestCount = 0;
    pickupLibs: Hash[] = [];
    illRequestsAllowed = true;
    atMaxRequests = false;
    hasOverdueIll = false;
    illOptOut = false;

    requestSubmitted = false;

    patronAccess: PatronAccess = {
        create_allowed: true,
        has_overdue_ill: false,
        ill_allowed: true,
        active_request_count: 0,
        max_allowed: 0,
        at_max_requests: false,
        pickup_lib: 0,
    }

    // Emits after completion of every new patron auth+permission check.
    patronChecked: EventEmitter<void> = new EventEmitter<void>();

    // Called by the create form when it's time to reset/clear the values.
    // Some values are managed outside of the main create form (e.g. format)
    formResetRequested: EventEmitter<void> = new EventEmitter<void>();

    formatChanged: EventEmitter<void> = new EventEmitter<void>();
    patronAccessLoaded: EventEmitter<PatronAccess> = new EventEmitter<PatronAccess>();

    constructor(
        private app: AppService,
        private settings: Settings,
        private gateway: Gateway) {
        app.authSessionLoad.subscribe(() => this.loadPatronAccess());
    }

    reset() {
        this.selectedFormat = null;
        this.requestsAllowed = true;
        this.illRequestsAllowed = true;
        this.hasOverdueIll = false;
        this.atMaxRequests = false;
    }

    loadOptions(): Promise<any> {
        if (this.formats.length > 0) {
            return Promise.resolve();
        }

        return this.gateway.requestOne(
            'open-ils.pcrud',
            'open-ils.pcrud.search.cuirf.atomic',
            'ANONYMOUS', // field safe
            {'code':{'<>':null}},
            {'order_by': {'cuirf': 'position'}}
        ).then(formats => this.formats = formats as Hash[])
        .then(_ => {
            return this.gateway.requestOne(
                'open-ils.pcrud',
                'open-ils.pcrud.search.cuira.atomic',
                'ANONYMOUS', // field safe
                {'code':{'<>':null}},
                {'order_by': {'cuirf': 'position'}}
            ).then(audiences => this.audiences = audiences as Hash[])
        })
        .then(_ => {
            return this.gateway.requestOne(
                'open-ils.pcrud',
                'open-ils.pcrud.search.cuirl.atomic',
                'ANONYMOUS', // field safe
                {'code':{'<>':null}},
                {'order_by': {'cuirf': 'label'}}
            ).then(languages => {
                let langs = languages as Hash[];
                // Move the default language to the front of the list
                const index = langs.findIndex(l => l.is_default === 't');
                if (index > -1) {
                    const lang = langs[index];
                    langs.splice(index, 1);
                    langs.unshift(lang);
                }
                this.languages = langs;
            });
        })
    }

    loadPatronAccess(): Promise<PatronAccess> {
        return this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron.patron-request.access',
            this.app.getAuthtoken()
        ).then((a: unknown) => {
            const access = a as PatronAccess;
            //console.debug('patron access:', access);

            this.requestsAllowed = Number(access.create_allowed) === 1;
            this.activeRequestCount = Number(access.active_request_count);
            this.maxRequestCount = Number(access.max_allowed);
            this.hasOverdueIll = Number(access.has_overdue_ill) === 1;
            this.illRequestsAllowed = Number(access.ill_allowed) === 1;
            this.atMaxRequests = Number(access.at_max_requests) === 1;

            this.patronAccess = access;

            this.patronChecked.emit();
            this.patronAccessLoaded.emit(access);

            return access;
        });
    }

    tooManyActiveRequests(): boolean {
        return this.atMaxRequests;
    }

    loadPickupLibs(): Promise<Hash[]> {
        if (this.pickupLibs.length > 0) {
            return Promise.resolve(this.pickupLibs);
        }

        // Users are allowed to select a hold pickup lib from the set of
        // org units where the opac.holds.org_unit_not_pickup_lib setting
        // is false/unset and the org unit is "can have vols"
        return this.app.getOrgTree().then(tree => {
            return this.settings.settingValueForOrgs('opac.holds.org_unit_not_pickup_lib')
            .then((list: Hash[]) => {
                list.forEach(setting => {
                    if (!(setting.summary as Hash).value) {
                        let org = this.app.getOrgUnit(setting.org_unit as number);
                        if (org && (org.ou_type as Hash).can_have_vols === 't') {
                            org.id = Number(org.id);
                            this.pickupLibs.push(org);
                        }
                    }
                });

                this.pickupLibs = this.pickupLibs.sort((a: Hash, b: Hash) =>
                    (a.name as string) < (b.name as string) ? -1 : 1);

                return this.pickupLibs;
            });
        });
    }
}

