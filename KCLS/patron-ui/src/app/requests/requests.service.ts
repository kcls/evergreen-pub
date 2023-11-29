import {Injectable, EventEmitter} from '@angular/core';
import {Gateway} from '../gateway.service';
import {AppService} from '../app.service';

@Injectable()
export class RequestsService {
    selectedFormat: string | null = null;
    requestsAllowed: boolean | null = null;

    // Emits after completion of every new patron auth+permission check.
    patronChecked: EventEmitter<void> = new EventEmitter<void>();

    constructor(private app: AppService, private gateway: Gateway) {
        app.authSessionLoad.subscribe(() => this.checkRequestPerms());
    }

    reset() {
        this.selectedFormat = null;
        this.requestsAllowed = null;
    }

    checkRequestPerms() {
        this.requestsAllowed = null;

        this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron-request.create.allowed',
            this.app.getAuthtoken()
        ).then((r: unknown) => {
            this.requestsAllowed = Number(r) === 1;
            this.patronChecked.emit();
        });
    }
}

