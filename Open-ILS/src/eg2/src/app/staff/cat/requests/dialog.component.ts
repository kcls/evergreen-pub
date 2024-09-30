import {Component, Input, ViewChild} from '@angular/core';
import {Location} from '@angular/common';
import {NetService} from '@eg/core/net.service';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {OrgService} from '@eg/core/org.service';
import {switchMap} from 'rxjs/operators';
import {Observable, from, throwError} from 'rxjs';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';

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

    statuses: ComboboxEntry[]  = [
        {id: 'pending',    label: $localize`Pending`},
        {id: 'processing', label: $localize`In Process`},
        {id: 'complete',   label: $localize`Complete`},
        {id: 'canceled',   label: $localize`Canceled`},
        {id: 'rejected',   label: $localize`Rejected`},
    ]

    languages = [
        $localize`English`,
        $localize`አማርኛ / Amharic`,
        $localize`عربي / Arabic`,
        $localize`中文 / Chinese`,
        $localize`Deutsch / German`,
        $localize`ગુજરાતી / Gujarati`,
        $localize`עִברִית / Hebrew`,
        $localize`हिंदी  / indi`,
        $localize`italiano / Italian`,
        $localize`日本語 / Japanese`,
        $localize`한국어 / Korean`,
        $localize`मराठी  / Marathi`,
        $localize`Kajin M̧ajeļ / Marshallese`,
        $localize`ਪੰਜਾਬੀ  / Punjabi/Panjabi`,
        $localize`فارسی / Persian`,
        $localize`Português / Portuguese`,
        $localize`Pусский / Russian`,
        $localize`Soomaali / Somali`,
        $localize`Español / Spanish`,
        $localize`Tagalog`,
        $localize`தமிழ்  / Tamil`,
        $localize`తెలుగు  / Telugu`,
        $localize`Українська / Ukrainian`,
        $localize`Tiếng Việt / Vietnamese`,
    ];

    // TODO move these into the dabase
    illDenials = [
        $localize`Staff attempted to borrow this item  for you, but unfortunately
            it was unavailable for loan from other library systems at this time.`,
        $localize`Unfortunately, the only libraries that own this are outside
            of North America. We do not engage in International Interlibrary Loan at this time.`,
        $localize`There are only a few libraries in the country that own this
            book and it has been in continual use. Please resubmit this request again in 2 months if still needed.`,
        $localize`Staff made every effort to borrow this item at no cost; however
            the only libraries left to ask charge loan fees of $ XX.XX Would you
            like to continue with this request and pay this amount if they will loan? (Please do not pre-pay.)`,
        $localize`There are only a few libraries in the country that own this book
            and the book has only recently been added to their collections. Libraries
            give priority to their patrons for new materials and are unable to loan
            material added recently to other libraries .  Please resubmit this
            request again in 3-6 months and we can try again.`,
        $localize`Unfortunately, this item is not available in the format/language requested at this time.`,
        $localize`Currently, this item is available as an electronic book or
            audiobook only.  We can't borrow audiovisual materials through Interlibrary Loan.`,
        $localize`KCLS currently owns this book. Interlibrary loan is strictly
            for books that we do not own. Please see reference staff to arrange a reference loan if needed.`,
        $localize`We were unfortunately unable to obtain a loan from other
            library systems. The good news is that this seems to be available full text online at the following address:`,
    ];

    illDenialOptions: ComboboxEntry[] = [];

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
        private auth: AuthService) {
        super(modal); // required for subclassing

        this.illDenialOptions = this.illDenials.map(denial => {
            // Remove any mutli-spaces caused by formatting.
            let value = denial.replace(/ +/g, ' ');
            value = value.replace(/\n/g, ' ');
            return {id: value, label: value};
        });
    }

    open(args: NgbModalOptions): Observable<boolean> {
        this.request = null;
        this.sourceRequest = null;
        this.patronBarcode = null;

        console.log(this.idl.classes['auir']);

        if (this.mode === 'create') {
            this.request = this.idl.create('auir');
            this.sourceRequest = this.idl.clone(this.request);
            return super.open(args);
        }

        if (!this.requestId) {
            return throwError('request ID required');
        }

        // Fire data loading observable and replace results with
        // dialog opener observable.
        return from(this.loadRequest()).pipe(switchMap(_ => super.open(args)));
    }

    findPatron() {
        this.patronNotFound = false;

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
        })
    }

    loadRequest(): Promise<void> {
        const flesh = {
            flesh: 2,
            flesh_fields: {
                auir: ['usr', 'claimed_by'],
                au: ['card']
            }
        };

        return this.pcrud.retrieve('auir', this.requestId, flesh)
        .toPromise().then(req => {
            this.request = req;
            this.sourceRequest = this.idl.clone(req);
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
                this.request.usr(this.request.usr().id());
                this.request.requestor(this.auth.user().id());

                return this.pcrud.create(this.request).toPromise()
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
        let code = 'pending';

        let req = this.request;
        if (req) {
            if (req.cancel_date()) {
                code = 'canceled';
            } else if (req.reject_date()) {
                code = 'rejected';
            } else if (req.claim_date()) {
                code = 'processing';
            } else if (req.complete_date()) {
                code = 'complete';
            }
        }

        return this.statuses.filter(s => s.id === code)[0].label;
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

    createIll() {
        this.save().then(_ => this.createIllRequest());
    }

    createIllRequest() {
        let req = this.request;

        let url = '/staff/cat/ill/track?';
        url += `title=${encodeURIComponent(req.title())}`;
        url += `&patronRequestId=${this.requestId}`;
        url += `&patronBarcode=${encodeURIComponent(req.usr().card().barcode())}`;
        url += `&illno=${encodeURIComponent(req.illno())}`;

        url = this.ngLocation.prepareExternalUrl(url);

        window.open(url);
    }

}


