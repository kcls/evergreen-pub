import {Component, Input, ViewChild} from '@angular/core';
import {Observable, throwError, from} from 'rxjs';
import {mergeMap} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {StoreService} from '@eg/core/store.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {AuthService} from '@eg/core/auth.service';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {StringComponent} from '@eg/share/string/string.component';


/**
 * Dialog for transferring holds.
 */

@Component({
  selector: 'eg-hold-transfer-dialog',
  templateUrl: 'transfer-dialog.component.html'
})

export class HoldTransferDialogComponent
    extends DialogComponent {

    @Input() holdIds: number | number[];

    @ViewChild('successMsg', { static: true }) private successMsg: StringComponent;
    @ViewChild('errorMsg', { static: true }) private errorMsg: StringComponent;
    @ViewChild('targetNeeded', { static: true }) private targetNeeded: StringComponent;

    transferTarget: number;
    changesApplied: boolean;
    numSucceeded: number;
    numFailed: number;
    targetTitle = '';

    constructor(
        private modal: NgbModal, // required for passing to parent
        private toast: ToastService,
        private store: StoreService,
        private net: NetService,
        private pcrud: PcrudService,
        private evt: EventService,
        private auth: AuthService) {
        super(modal); // required for subclassing
    }

    open(args: NgbModalOptions): Observable<boolean> {
        this.numSucceeded = 0;
        this.numFailed = 0;
        this.holdIds = [].concat(this.holdIds); // array-ify ints

        this.transferTarget =
            this.store.getLocalItem('eg.circ.hold.title_transfer_target');

        if (!this.transferTarget) {
            this.targetNeeded.current()
            .then((msg) => this.toast.warning(msg));

            return throwError('Transfer Target Required');
        }

        return from(
            this.pcrud.search('mfde', {
                source: this.transferTarget,
                name: 'title_proper'
            })
            .toPromise()
            .then(title => this.targetTitle = title ? title.value() : '')
        ).pipe(mergeMap(_ => super.open(args)));
    }

    async transferHolds(): Promise<any> {
        return this.net.request(
            'open-ils.circ',
            'open-ils.circ.hold.change_title.specific_holds',
            this.auth.token(), this.transferTarget, this.holdIds
        ).toPromise().then(async(result) => {
            if (Number(result) === 1) {
                this.numSucceeded++;
                this.toast.success(await this.successMsg.current());
            } else {
                this.numFailed++;
                console.error('Retarget Failed', this.evt.parse(result));
                this.toast.warning(await this.errorMsg.current());
            }
        });
    }

    async transferBatch(): Promise<any> {
        this.numSucceeded = 0;
        this.numFailed = 0;
        await this.transferHolds();
        this.close(this.numSucceeded > 0);
    }
}



