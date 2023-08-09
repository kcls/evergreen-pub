import {Component, OnInit, Output, Input, ViewChild, EventEmitter} from '@angular/core';
import {empty, of, from, Observable} from 'rxjs';
import {tap, concatMap} from 'rxjs/operators';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {OrgService} from '@eg/core/org.service';
import {CircService} from './circ.service';
import {StringComponent} from '@eg/share/string/string.component';
import {AlertDialogComponent} from '@eg/share/dialog/alert.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {CheckinResult, CheckinParams} from './circ.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {PrintService} from '@eg/share/print/print.service';

/** Route Item Dialog */

@Component({
  templateUrl: 'lost-paid-confirm-dialog.component.html',
  selector: 'eg-lost-paid-confirm-dialog'
})
export class LostPaidConfirmDialogComponent extends DialogComponent {

    checkinResult: CheckinResult;
    itemCondition = '';

    constructor(
        private modal: NgbModal,
        private pcrud: PcrudService,
        private org: OrgService,
        private circ: CircService,
        private printer: PrintService) {
        super(modal);
    }


    /*
    open(ops?: NgbModalOptions): Observable<any> {
    }

    print(): Promise<any> {
        this.printer.print({
            templateName: this.slip,
            contextData: {checkin: this.checkin},
            printContext: 'default'
        });

        this.close();

        return Promise.resolve();
    }
    */

    checkin() {
        // TODO show progress inline

        let params: CheckinParams = this.checkinResult.params;
        params.confirmed_lostpaid_checkin = true;

        console.debug('Checking item in with params: ', params);
        alert('not yet implemented');

        /*
        this.circ.checkin(params)
        .then(result => {
            console.debug('Lost/Paid checkin returned: ', result);
            // TODO print refund actions taken letter.
        });
        */
    }
}

