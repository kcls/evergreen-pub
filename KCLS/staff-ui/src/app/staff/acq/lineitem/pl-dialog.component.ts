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
  selector: 'eg-acq-pl-dialog',
  templateUrl: './pl-dialog.component.html'
})

export class PicklistDialogComponent extends DialogComponent {

    lineitemIds: number[] = [];
    picklist: ComboboxEntry;
    moving = false;

    @ViewChild('plNameExists') plNameExists: AlertDialogComponent;
    @ViewChild('progress') progress: ProgressInlineComponent;

    constructor(
        private modal: NgbModal,
        private evt: EventService,
        private idl: IdlService,
        private net: NetService,
        private pcrud: PcrudService,
        private auth: AuthService
    ) { super(modal); }

    move() {

        if (!this.picklist) { return; }

        this.moving = true;

        const promise = this.picklist.freetext ?
            this.createPicklist() :
            Promise.resolve(this.picklist.id);

        promise.then(plId => {
            this.moveToPicklist(plId)
            .then(_ => this.moving = false)
            .then(_ => this.close(plId));
        });
    }

    createPicklist(): Promise<number> {

        const name = this.picklist.label;

        return this.pcrud.search('acqpl',
            {owner: this.auth.user().id(), name: name},
            null, {idlist: true}

        ).toPromise().then(existing => {
            return {existing: existing, name: name};

        }).then(info => {
            if (!info) { return; }

            if (info.existing) {
                // Alert the user the requested name is already in
                // use and reopen the create dialog.
                this.plNameExists.open().toPromise().then(_ => this.createPicklist());
                return;
            }

            const pl = this.idl.create('acqpl');
            pl.name(info.name);
            pl.owner(this.auth.user().id());

            return this.net.request(
                'open-ils.acq',
                'open-ils.acq.picklist.create', this.auth.token(), pl
            ).toPromise();

        }).then(plId => {
            if (!plId) { return null; }

            const evt = this.evt.parse(plId);
            if (evt) { alert(evt); return null; }

            return plId;
        });
    }

    moveToPicklist(plId: number): Promise<any> {
        if (!plId) { return Promise.resolve(); }

        const liList = [];

        return this.pcrud.search('jub', {id: this.lineitemIds})
        .pipe(tap(li => {
            li.picklist(plId);
            liList.push(li);
        }))
        .toPromise()
        .then(_ => {
            return from(liList).pipe(concatMap(li => {
                return this.net.request(
                    'open-ils.acq',
                    'open-ils.acq.lineitem.update',
                    this.auth.token(), li
                );
            }))
            .toPromise();
        });
    }
}


