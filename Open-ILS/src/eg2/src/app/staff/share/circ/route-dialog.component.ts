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
  templateUrl: 'route-dialog.component.html',
  selector: 'eg-circ-route-dialog'
})
export class RouteDialogComponent extends DialogComponent {

    checkin: CheckinResult;
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
            return from(
                this.collectData().then(exit2 => {
                    // If either applySettings or collectData() tell us
                    // to exit, make it so.
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

    collectData(): Promise<boolean> {
        let promise = Promise.resolve(null);
        const hold = this.checkin.hold;

        console.debug('Route Dialog collecting data');

        if (this.slip !== 'hold_shelf_slip') {

            // Always fetch the most recent transit for the copy,
            // regardless of what data the server returns in the payload.

            promise = promise.then(_ => this.circ.findCopyTransit(this.checkin))
            .then(transit => {
                this.checkin.transit = transit;
                this.checkin.destOrg = transit.dest();
                this.checkin.routeTo = transit.dest().shortname();
                return this.circ.getOrgAddr(this.checkin.destOrg.id(), 'holds_address');
            })
            .then(addr => {
                this.checkin.destAddress = addr;
                return this.org.settings('lib.courier_code', this.checkin.destOrg.id());
            })

            .then(sets => this.checkin.destCourierCode = sets['lib.courier_code']);
        }

        if (hold) {
            promise = promise.then(_ => {
                return this.pcrud.retrieve('au', hold.usr(),
                    {flesh: 1, flesh_fields : {'au' : ['card', 'stat_cat_entries']}})
                .toPromise()
                .then(patron => this.checkin.patron = patron);
            });
        }

        return promise.then(_ => false);
    }

    headlessPrint(): Promise<boolean> {
        console.debug('Route Dialog headlessPrint()');

        if (this.slip == 'hold_transit_slip') {
            console.debug("Printing hold transit slip");
            // Hold transit slips always print.
            return this.print().then(_ => true); // exit
        }

        // Local holds and received hold transits only print if
        // auto-print is enabled.
        if (this.slip == 'hold_shelf_slip') {
            if (this.checkin.params.auto_print_holds_transits) {
                console.debug("Printing hold shelf slip");
                return this.print().then(_ => true); // exit
            } else {
                console.debug("NOT printing hold shelf slip auto=false");
            }
        }

        if (this.slip == 'transit_slip') {
            if (this.checkin.params.auto_print_transits) {
                console.debug("Printing transit slip");
                return this.print().then(_ => true); // exit
            } else {
                console.debug("NOT printing transit slip auto=false");
            }
        }


        return Promise.resolve(true); // Never show popups.

        /*
        if (this.checkin.params.auto_print_holds_transits
            || this.circ.suppressCheckinPopups) {
            // Print and exit.
            return this.print().then(_ => true); // exit
        }

        return Promise.resolve(false); // keep going
        */
    }

    applySettings(): Promise<boolean> {
        console.debug('Route Dialog applySettings()');

        if (this.checkin.transit && !this.checkin.transit.dest_recv_time()) {
            if (this.checkin.patron && this.checkin.hold &&
                // It's possible to recieve a fulfilled hold in the
                // checkin response when a checkin results in canceling
                // a hold transit for a hold that was fulfilled while
                // the item was in transit.
                !this.checkin.hold.fulfillment_time()) {
                this.slip = 'hold_transit_slip';
            } else {
                this.slip = 'transit_slip';
            }
        } else {
            this.slip = 'hold_shelf_slip';
        }

        // Printing depends on the context.  Handled later.
        // Avoid the below lookup.
        return Promise.resolve(false);

        /*

        const autoPrintSet = 'circ.staff_client.do_not_auto_attempt_print';

        return this.serverStore.getItemBatch([autoPrintSet]).then(sets => {
            const autoPrintArr = sets[autoPrintSet];

            if (Array.isArray(autoPrintArr)) {
                this.noAutoPrint['hold_shelf_slip'] =
                    autoPrintArr.includes('Hold Slip');

                this.noAutoPrint['hold_transit_slip'] =
                    autoPrintArr.includes('Hold/Transit Slip');

                this.noAutoPrint['transit_slip'] =
                    autoPrintArr.includes('Transit Slip');
            }
        })
        .then(_ => this.noAutoPrint[this.slip]);
        */
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
}

