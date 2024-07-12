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

    // Emits after completion of every new patron auth+permission check.
    patronChecked: EventEmitter<void> = new EventEmitter<void>();

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
            .then(r => this.maxRequestCount = Number(r));
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
}

