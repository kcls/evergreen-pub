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
import {CheckinResult} from './circ.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {PrintService} from '@eg/share/print/print.service';

/** Route Item Dialog */

@Component({
  templateUrl: 'lost-paid-confirm-dialog.component.html',
  selector: 'eg-lost-paid-confirm-dialog'
})
export class LostPaidConfirmDialogComponent extends DialogComponent {

    checkin: CheckinResult;
    itemCondition = '';


    /*
    noAutoPrint: {[template: string]: boolean} = {};
    slip: string;
    today = new Date();

    constructor(
        private modal: NgbModal,
        private pcrud: PcrudService,
        private org: OrgService,
        private circ: CircService,
        private printer: PrintService,
        private serverStore: ServerStoreService) {
        super(modal);
    }

    open(ops?: NgbModalOptions): Observable<any> {
        // Depending on various settings, the dialog may never open.
        // But in some cases we still have to collect the data
        // for printing.

        return from(this.applySettings())

        .pipe(concatMap(exit => {

            console.debug('Route Dialog applySettings() returned', exit);

            return from(
                this.collectData().then(exit2 => {
                    // If either applySettings or collectData() tell us
                    // to exit, make it so.
                    console.debug(
                        'Route Dialog collectData() completed with ', (exit || exit2));
                    return exit || exit2;
                })
            );
        }))

        .pipe(concatMap(exit => {
            if (exit) {
                return of(exit);
            } else {
                return from(this.headlessPrint());
            }
        }))

        .pipe(concatMap(exit => {
            console.debug('Route Dialog headlessPrint() returned', exit);
            if (exit) {
                return of(exit);
            } else {
                return super.open(ops);
            }
        }));
    }

    print(): Promise<any> {
        this.printer.print({
            templateName: this.slip,
            contextData: {checkin: this.checkin},
            printContext: 'default'
        });

        this.close();

        // TODO printer.print() should return a promise
        return Promise.resolve();
    }
    */
}

