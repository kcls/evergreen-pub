import {Component, Input, ViewChild, TemplateRef, OnInit} from '@angular/core';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {from} from 'rxjs';
import {concatMap, tap} from 'rxjs/operators';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {EventService} from '@eg/core/event.service';
import {NetService} from '@eg/core/net.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {AlertDialogComponent} from '@eg/share/dialog/alert.component';
import {ProgressInlineComponent} from '@eg/share/dialog/progress-inline.component';

@Component({
  selector: 'eg-acq-po-provider-dialog',
  templateUrl: './po-provider-dialog.component.html'
})

export class PoProviderDialogComponent extends DialogComponent {
    poId: number;
    moving = false;
    provider: ComboboxEntry;

    constructor(
        private modal: NgbModal,
        private evt: EventService,
        private net: NetService,
        private auth: AuthService
    ) { super(modal); }

    move() {

        if (!this.poId || !this.provider) {
            return;
        }

        this.moving = true;

        this.net.request(
            'open-ils.acq',
            'open-ils.acq.purchase_order.provider.update',
            this.auth.token(), this.poId, this.provider.id
        ).toPromise().then(resp => {

            let evt = this.evt.parse(resp);

            if (evt || Number(resp) != 1) {
                alert($localize`Provider chang failed: {evt}`);
                return;
            }

            this.moving = false;
            this.close(true);
        });
    }
}


