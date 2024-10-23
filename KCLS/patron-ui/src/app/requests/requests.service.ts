import {Injectable, EventEmitter} from '@angular/core';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';

@Injectable()
export class RequestsService {
    selectedFormat: string | null = null;
    illOptOut = false;
    requestsAllowed: boolean | null = null;
    activeRequestCount = 0;
    maxRequestCount = 0;
    pickupLibs: Hash[] = [];

    requestSubmitted = false;

    // Emits after completion of every new patron auth+permission check.
    patronChecked: EventEmitter<void> = new EventEmitter<void>();

    // Called by the create form when it's time to reset/clear the values.
    // Some values are managed outside of the main create form (e.g. format)
    formResetRequested: EventEmitter<void> = new EventEmitter<void>();

    formatChanged: EventEmitter<void> = new EventEmitter<void>();

    constructor(
        private app: AppService,
        private settings: Settings,
        private gateway: Gateway) {
        app.authSessionLoad.subscribe(() => this.checkRequestPerms());
    }

    reset() {
        this.selectedFormat = null;
        this.requestsAllowed = null;
    }

    checkRequestPerms() {
        this.requestsAllowed = null;
        this.activeRequestCount = 0;

        this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron-request.create.allowed',
            this.app.getAuthtoken()
        ).then((r: unknown) => {
            this.requestsAllowed = Number(r) === 1;
        }).then(() => {
            return this.settings.getServerSetting('patron_requests.max_active')
            .then(r => {
              this.maxRequestCount = Number(r);
              if (this.maxRequestCount === 0) {
                  // If the setting has no value.
                  this.maxRequestCount = 20;
              }
            });
        }).then(() => {
            if (!this.requestsAllowed) {
                return Promise.resolve([]);
            }
            return this.gateway.requestOne(
                'open-ils.actor',
                'open-ils.actor.patron-request.retrieve.pending',
                this.app.getAuthtoken()
            );
        }).then((r: unknown) => {
            this.activeRequestCount = (r as Hash[]).length;
            if (this.tooManyActiveRequests()) {
                this.requestsAllowed = false;
            }
            this.patronChecked.emit();
        });
    }

    tooManyActiveRequests(): boolean {
        return this.activeRequestCount > 0 &&
            this.activeRequestCount >= this.maxRequestCount;
    }

    loadPickupLibs(): Promise<Hash[]> {
        if (this.pickupLibs.length > 0) {
            return Promise.resolve(this.pickupLibs);
        }

        // Users are allowed to select a hold pickup lib from the set of
        // org units where the opac.holds.org_unit_not_pickup_lib setting
        // is false/unset and the org unit is "can have users"
        return this.app.getOrgTree().then(tree => {
            return this.settings.settingValueForOrgs('opac.holds.org_unit_not_pickup_lib')
            .then((list: Hash[]) => {
                list.forEach(setting => {
                    if (!(setting.summary as Hash).value) {
                        let org = this.app.getOrgUnit(setting.org_unit as number);
                        if (org && (org.ou_type as Hash).can_have_users === 't') {
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

