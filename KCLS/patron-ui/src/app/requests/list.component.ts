import {Component, OnInit} from '@angular/core';
import {Title} from '@angular/platform-browser';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';

// Define create_date as a string so it can be used
// in the Date pipe in the template.
type Request = Hash & {create_date: string};

@Component({
  selector: 'app-patron-request-list',
  templateUrl: './list.component.html',
  styleUrls: ['list.component.css']
})
export class RequestListComponent implements OnInit {

    requests: Request[] = [];
    cancelRequested: number | null = null;

    constructor(
        private title: Title,
        private gateway: Gateway,
        public app: AppService
    ) { }

    ngOnInit() {
        this.requests = [];
        this.title.setTitle($localize`My Requests`);
        this.app.authSessionLoad.subscribe(() => this.load());
        this.load();
    }

    load() {
        if (!this.app.getAuthSession()) { return; }

        this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron-request.retrieve.pending',
            this.app.getAuthtoken()
        ).then((list: unknown) => this.requests = list as Request[]);
    }

    cancel(request: Request) {
        if (!this.cancelRequested) {
            this.cancelRequested = Number(request.id);
            return; // wait for confirmation.
        }

        this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.patron-request.cancel',
            this.app.getAuthtoken(), request.id
        ).then(resp => {
            console.debug('Cancel returned', resp);
            this.cancelRequested = null;
            this.load();
        });
    }

    getStatus(req: Request): string {
        if (req.reject_date) {
            return $localize`Rejected`;
        } else if (req.complete_date) {
            return $localize`Completed`;
        } else if (req.claim_date) {
            return $localize`Processing`;
        } else {
            return $localize`Pending`;
        }
    }

    stepState(step: string): string {
        return 'done';
    }
}

