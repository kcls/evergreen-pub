import {Component, OnInit} from '@angular/core';
import {Title} from '@angular/platform-browser';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';

interface StatusDisposition {
    icon: string,
    class: string
};

interface RequestStatus {
    code: string,
    label: string
}

// Define create_date as a string so it can be used
// in the Date pipe in the template.
type Request = Hash & {id: number, create_date: string, _status: string};

@Component({
  selector: 'app-patron-request-list',
  templateUrl: './list.component.html',
  styleUrls: ['list.component.css']
})
export class RequestListComponent implements OnInit {

    requests: Request[] = [];
    cancelRequested: number | null = null;
    showRequestDetails: {[id: number]: boolean} = {};

    statuses: RequestStatus[] = [
        {code: 'submitted', label: $localize`Request Submitted`},
        {code: 'patron-pending', label: $localize`Pending Patron Response`},
        {code: 'purchase-review', label: $localize`Under Consideration for Purchase`},
        {code: 'purchase-approved', label: $localize`Purchase Approved`},
        {code: 'purchase-failed', label: $localize`Unable to Purchase`},
        {code: 'ill-review', label: $localize`Transferred to Interlibrary Loan`},
        {code: 'ill-requested', label: $localize`Interlibrary Loan Request Submitted`},
        {code: 'ill-failed', label: $localize`Unable to Complete Interlibrary Loan`},
        {code: 'hold-failed', label: $localize`Unable to Place Hold`},
        {code: 'hold-placed', label: $localize`Hold Placed`},
        {code: 'complete', label: $localize`Request Complete`}
    ];

    statusDispositions: {[icon: string]: StatusDisposition} = {
        complete: {icon: 'check', class: 'bg-green-600 text-white'},
        //pending: {icon: 'pending', class: 'bg-gray-600 text-white'},
        pending: {icon: '', class: ''},
        //skipped: {icon: 'remove_circle_outline', class: 'bg-gray-600 text-white font-light'},
        skipped: {icon: '', class: ''},
        failed: {icon: 'feedback', class: 'bg-rose-600 text-white'},
    };

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
        ).then((list: unknown) => {
            this.requests = (list as Hash[]).map((hash: Hash) => {
                let request = hash["request"] as Request;
                request._status = (hash["status"] as Hash)["status"] as string;
                console.log('LOADED request', request._status);
                return request;
            });
        });
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

    getStatusDisposition(request: Request, stat: string): StatusDisposition {
        let reqStat = request._status;

        if (reqStat === stat) {
            // Status in question matches the current status of the request.
            if (stat.match(/failed/)) {
                this.statusDispositions.failed;
            } else {
                return this.statusDispositions.complete;
            }
        }

        switch (stat) {
            case 'submitted':
                return this.statusDispositions.complete;
            case 'patron-pending':
                    // TODO
                return this.statusDispositions.pending;
            case 'purchase-review':
                    // TODO
                return this.statusDispositions.pending;
            case 'purchase-approved':
                    // TODO
                return this.statusDispositions.pending;
            case 'ill-review':
                if (request.route_to === 'ill') {
                    return this.statusDispositions.complete;
                } else if (reqStat === 'submitted') {
                    return this.statusDispositions.pending;
                } else {
                    return this.statusDispositions.skipped;
                }
            case 'ill-requested':
                if (request.route_to === 'ill') {
                    // TODO
                    return this.statusDispositions.complete;
                } else if (reqStat === 'submitted') {
                    return this.statusDispositions.pending;
                } else {
                    return this.statusDispositions.skipped;
                }
            case 'ill-failed':
                if (request.route_to === 'ill') {
                    // TODO
                    return this.statusDispositions.complete;
                } else if (reqStat === 'submitted') {
                    return this.statusDispositions.pending;
                } else {
                    return this.statusDispositions.skipped;
                }
            case 'hold-failed':
                    // TODO
                return this.statusDispositions.pending;
            case 'hold-placed':
                    // TODO
                return this.statusDispositions.pending;
            case 'complete':
                if (reqStat === 'complete') {
                    return this.statusDispositions.complete;
                } else {
                    return this.statusDispositions.pending;
                }
        }

        return this.statusDispositions.pending;
    }
}

