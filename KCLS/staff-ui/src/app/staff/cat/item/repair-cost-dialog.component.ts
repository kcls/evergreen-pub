import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {Observable} from 'rxjs';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {StringComponent} from '@eg/share/string/string.component';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';

/* Dialog for modifying circulation due dates. */

@Component({
  selector: 'eg-repair-cost-dialog',
  templateUrl: 'repair-cost-dialog.component.html'
})

export class RepairCostDialogComponent extends DialogComponent implements OnInit {

    repairCost = 0;
    staffInitials = '';
    missingPiecesNote = '';

    constructor(private modal: NgbModal) { super(modal); }

    ngOnInit() {
    }
}
