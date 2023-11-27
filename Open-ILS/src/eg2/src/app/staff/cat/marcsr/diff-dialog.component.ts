import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {Observable} from 'rxjs';
import {concatMap} from 'rxjs/operators';
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

interface DiffEntry {
    record_id: number;
    breaker_before: string;
    breaker_after: string;
    diff: string;
}

@Component({
  selector: 'eg-marc-diff-dialog',
  templateUrl: 'diff-dialog.component.html'
})

export class MarcDiffDialogComponent
    extends DialogComponent implements OnInit {

    search = '';
    replace = '';
    entry: DiffEntry;
    recordId: number;
    tab = 'diff';
    postApply = false;

    constructor(
        private modal: NgbModal, // required for passing to parent
        private toast: ToastService,
        private net: NetService,
        private evt: EventService,
        private pcrud: PcrudService,
        private auth: AuthService) {
        super(modal); // required for subclassing
    }

    ngOnInit() {
        this.onOpen$.subscribe(_ => this.load());
    }

    load() {
        this.entry = null;

        const args: any = {record_id: this.recordId};

        if (this.postApply) {
            this.tab = 'after';
        } else {
            this.tab = 'diff';
            args.search = this.search;
            args.replace = this.replace || '';
        }

        this.net.request(
            'open-ils.cat',
            'open-ils.cat.biblio.marc.batch_update', this.auth.token(), args
        ).subscribe(e => {
            const evt = this.evt.parse(e);

            if (evt) {
                console.error(evt);
                alert(evt);
                return;
            }

            if (e.breaker_after) {
                console.debug('Setting entry to ', e);
                this.entry = e;
            }
        });
    }
}

