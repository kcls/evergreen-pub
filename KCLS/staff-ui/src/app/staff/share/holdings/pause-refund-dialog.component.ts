import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {AuthService} from '@eg/core/auth.service';
import {StaffService} from '@eg/staff/share/staff.service';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {StringComponent} from '@eg/share/string/string.component';


/**
 * Dialog for pausing a refundable transaction and/or modifying
 * the refundable transaction notes.
 */

@Component({
  selector: 'eg-pause-refund-dialog',
  templateUrl: 'pause-refund-dialog.component.html'
})

export class PauseRefundDialogComponent
    extends DialogComponent implements OnInit {

    @Input() refundableXact: IdlObject;
    refundNotes = '';
    staffInitials = '';

    constructor(
        private modal: NgbModal, // required for passing to parent
        private net: NetService,
        private evt: EventService,
        private auth: AuthService,
        private staff: StaffService) {
        super(modal); // required for subclassing
    }

    ngOnInit() {
        this.onOpen$.subscribe(_ => {
            this.staffInitials = '';
            this.refundNotes = this.refundableXact.notes();
        });
    }

    go(pause: boolean) {
        if (!this.staffInitials) { return; }

        const notes = this.staff.appendInitials(
            this.refundNotes || '', this.staffInitials);

        const resp: any = {refund_notes: notes};
        if (pause) {
            resp.pause_refund = true;
        } else {
            resp.no_pause_refund = true;
        }

        this.close(resp);
    }
}



