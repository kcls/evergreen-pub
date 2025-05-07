import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {of, empty, from, Observable, throwError} from 'rxjs';
import {concatMap, map} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {AuthService} from '@eg/core/auth.service';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {StringComponent} from '@eg/share/string/string.component';
import {HoldingsService} from './holdings.service';


/**
 * Dialog for marking items various statuses
 */


interface MarkItemArgs {
    handle_checkin?: boolean;
    handle_transit?: boolean;
    handle_last_hold_copy?: boolean;
    handle_copy_delete_warning?: boolean;
}


@Component({
  selector: 'eg-mark-items-dialog',
  templateUrl: 'mark-items-dialog.component.html'
})

export class MarkItemsDialogComponent
    extends DialogComponent implements OnInit {

    @Input() markAs: 'missing' | 'discard';
    @Input() copies: IdlObject[];

    copyCount = 0;
    method: string;
    statusName: string;
    copyStatuses: {[statId: number]: IdlObject} = {};
    numSucceeded: number;
    numFailed: number;
    currentBarcode: string;

    @ViewChild('successMsg') private successMsg: StringComponent;
    @ViewChild('errorMsg') private errorMsg: StringComponent;

    @ViewChild('confirmDelete') private confirmDelete: ConfirmDialogComponent;
    @ViewChild('confirmLastHold') private confirmLastHold: ConfirmDialogComponent;
    @ViewChild('confirmCheckedOut') private confirmCheckedOut: ConfirmDialogComponent;
    @ViewChild('confirmInTransit') private confirmInTransit: ConfirmDialogComponent;

    constructor(
        private modal: NgbModal, // required for passing to parent
        private toast: ToastService,
        private net: NetService,
        private evt: EventService,
        private holdings: HoldingsService,
        private auth: AuthService) {
        super(modal); // required for subclassing
    }

    ngOnInit() {}

    open(args?: NgbModalOptions): Observable<boolean> {
        this.numSucceeded = 0;
        this.numFailed = 0;
        this.currentBarcode = '';
        let copyStatus: number;

        switch (this.markAs) {
            case 'missing':
                this.method = 'open-ils.circ.mark_item_missing';
                copyStatus = 4;
                break;
            case 'discard':
                this.method = 'open-ils.circ.mark_item_discard';
                copyStatus = 13;
                break;
        }

        return of(
            this.holdings.getCopyStatuses()
            .then(stats => {
                this.copyStatuses = stats;
                this.statusName = this.copyStatuses[copyStatus].name();
            })
        ).pipe(concatMap(_ => super.open(args)));
    }

    markOneItem(copy: IdlObject, args?: MarkItemArgs): Observable<boolean> {
        if (!args) { args = {}; }
        this.currentBarcode = copy.barcode();

        return this.net.request(
            'open-ils.circ', this.method, this.auth.token(), copy.id(), args)
        .pipe(concatMap(resp => {
            return this.handleMarkResponse(copy, args, resp);
        }));
    }

    handleMarkResponse(copy: IdlObject, args: MarkItemArgs, resp: any): Observable<boolean> {
        const evt = this.evt.parse(resp);

        if (!evt) { return of(true); } // success

        let dialog: ConfirmDialogComponent;

        switch (evt.textcode) {
            case 'ITEM_TO_MARK_CHECKED_OUT':
                dialog = this.confirmCheckedOut;
                args.handle_checkin = true;
                break;
            case 'ITEM_TO_MARK_IN_TRANSIT':
                args.handle_transit = true;
                dialog = this.confirmInTransit;
                break;
            case 'ITEM_TO_MARK_LAST_HOLD_COPY':
                args.handle_last_hold_copy = true;
                dialog = this.confirmLastHold;
                break;
            case 'COPY_DELETE_WARNING':
                args.handle_copy_delete_warning = true;
                dialog = this.confirmDelete;
                break;
            default:
                console.error('Marking failed ' + evt);
                return of(false);
        }

        return dialog.open().pipe(concatMap(confirmed => {
            if (confirmed) {
                return this.markOneItem(copy, args);
            } else {
                return of(false);
            }
        }));
    }

    // Returns a stream of copy IDs for successfully modified copies.
    markItems() {
        if (!this.copies || this.copies.length === 0) {
            this.close();
            return;
        }

        this.copyCount = this.copies.length;

        from(this.copies).pipe(concatMap(copy => {
            return this.markOneItem(copy)
            .pipe(map(modified => {
                if (modified) {
                    this.numSucceeded++;
                    this.respond(copy.id());
                } else {
                    this.numFailed++;
                }
            }));
        })).toPromise().then(_ => this.close());
    }
}



