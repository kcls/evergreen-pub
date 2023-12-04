import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {of, Observable, throwError} from 'rxjs';
import {concatMap} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {AuthService} from '@eg/core/auth.service';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {StringComponent} from '@eg/share/string/string.component';
import {MarkItemsDialogComponent} from './mark-items-dialog.component';



/**
 * Dialog for marking items missing.
 *
 * This now simply invokes the generic Mark Items Dialog.
 */

@Component({
  selector: 'eg-mark-missing-dialog',
  templateUrl: 'mark-missing-dialog.component.html'
})

export class MarkMissingDialogComponent
    extends DialogComponent {

    @Input() copyIds: number[];
    @Input() copies: IdlObject[];

    @ViewChild('markItemsDialog')
        private markItemsDialog: MarkItemsDialogComponent;

    constructor(
        private pcrud: PcrudService,
        private modal: NgbModal
    ) { super(modal); }


    open(args?: NgbModalOptions): Observable<boolean> {
        let obs: Observable<IdlObject[]>;

        if (this.copies) {
            obs = of(this.copies);
        } else {
            obs = this.pcrud.search(
                'acp', {id: this.copyIds}, {}, {atomic: true});
        }

        return obs.pipe(concatMap(copies => {
            this.markItemsDialog.markAs = 'missing';
            this.markItemsDialog.copies = copies;
            return this.markItemsDialog.open(args);
        }));

    }
}

