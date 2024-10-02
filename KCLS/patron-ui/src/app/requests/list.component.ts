import {Component, OnInit} from '@angular/core';
import {FormControl, Validators} from '@angular/forms';
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

    controls: {[field: string]: FormControl} = {
        //pendingCbox: new FormControl(''),
        completedCbox: new FormControl('')
    };

    statuses: RequestStatus[] = [
        {code: 'submitted', label: $localize`Request Submitted`},
        {code: 'patron-pending', label: $localize`Pending Patron Response`},
        {code: 'purchase-review', label: $localize`Under Consideration for Purchase`},
        {code: 'purchase-approved', label: $localize`Purchase Approved`},
        {code: 'purchase-rejected', label: $localize`Unable to Purchase`},
        {code: 'ill-review', label: $localize`Transferred to Interlibrary Loan`},
        {code: 'ill-requested', label: $localize`Interlibrary Loan Request Submitted`},
        {code: 'ill-rejected', label: $localize`Unable to Complete Interlibrary Loan`},
        {code: 'hold-failed', label: $localize`Unable to Place Hold`},
        {code: 'hold-canceled', label: $localize`Hold Canceled`},
        {code: 'hold-placed', label: $localize`Hold Placed`},
        {code: 'completed', label: $localize`Request Complete`}
    ];

    statusDispositions: {[icon: string]: StatusDisposition} = {
        completed: {icon: 'check', class: 'bg-green-600 text-white'},
        pending: {icon: 'pending', class: 'bg-gray-600 text-white'},
        //skipped: {icon: 'remove_circle_outline', class: 'bg-gray-600 text-white font-light'},
        skipped: {icon: '', class: ''},
        //rejected: {icon: 'feedback', class: 'bg-rose-600 text-white'},
        rejected: {icon: 'warning', class: 'bg-rose-600 text-white'},
    };

    constructor(
        private title: Title,
        private gateway: Gateway,
        public app: AppService
    ) { }

    ngOnInit() {
        this.controls.completedCbox.valueChanges.subscribe(_ => this.load());

        this.requests = [];
        this.title.setTitle($localize`My Requests`);
        this.app.authSessionLoad.subscribe(() => this.load());
        this.load();
    }

    load() {
        if (!this.app.getAuthSession()) { return; }

        let api = 'open-ils.actor.patron-request.retrieve.pending';
        if (this.controls.completedCbox.value) {
            api = 'open-ils.actor.patron-request.retrieve.all';
        }

        this.gateway.requestOne('open-ils.actor', api, this.app.getAuthtoken())
        .then((list: unknown) => {
            this.requests = (list as Hash[]).map((hash: Hash) => {
                let request = hash["request"] as Request;
                request._status = (hash["status"] as Hash)["status"] as string;
                console.log('fetched requet with status ', request._status);
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


    /* Status Movement
		submitted

		purchase-review
		purchase-rejected / purchase-approved
        hold-placed (todo)
        hold-rejected (todo)

		ill-review
		ill-rejected / ill-requested

		complete
	*/

    // Render a status as completed, rejected, or pending, depending on
    // the status of the request.
    getStatusDisposition(request: Request, stat: string): StatusDisposition {
        let reqStat = request._status;

        const hidden = {icon: '', class: ''};
        const rejected = this.statusDispositions.rejected;
        const complete = this.statusDispositions.completed;

        // Does the status in question match the current status of the request?
        // The 'submitted' status is always 'complete' since it's the first action.
        if (reqStat === stat || stat === 'submitted') {
            if (stat.match(/rejected/)) {
                return rejected;
            } else {
                return complete;
            }
        }

        // If this request is not in a rejected status, then there's
        // never a reason to display a rejected status in the list.
        if (stat.match(/rejected/)) {
            return hidden;
        }

        if (request.route_to === 'ill') {
            if (stat === 'ill-review' && reqStat !== 'submitted') {
                return complete;
            }

            if (stat === 'ill-requested' && reqStat === 'completed') {
                return complete;
            }
        } else {
            if (stat === 'purchase-review' && reqStat !== 'submitted') {
                return complete;
            }
            if (stat === 'purchase-approved' && reqStat === 'completed') {
                return complete;
            }
        }

        return hidden;
    }
}

