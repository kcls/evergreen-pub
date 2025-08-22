import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {Observable, from} from 'rxjs';
import {concatMap, tap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {StringComponent} from '@eg/share/string/string.component';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {ProgressInlineComponent} from '@eg/share/dialog/progress-inline.component';

/* Dialog for modifying circulation due dates. */

@Component({
  selector: 'eg-partial-receive-dialog',
  templateUrl: 'partial-receive-dialog.component.html'
})

export class PartialReceiveDialogComponent
    extends DialogComponent implements OnInit {

    lineitem: IdlObject | null = null;
    lineitemId = 0;
    liTitle = '';
    nonViableItemCount = 0;
    processing = false;

    // Maybe show progress, depending on how quick this generally is.
    // @ViewChild('loadProgress') loadProgress: ProgressInlineComponent;

    constructor(
        private modal: NgbModal, // required for passing to parent
        private toast: ToastService,
        private net: NetService,
        private org: OrgService,
        private evt: EventService,
        private pcrud: PcrudService,
        private auth: AuthService) {
        super(modal);
    }

    ngOnInit() {
        this.onOpen$.subscribe(_ => {
            this.lineitem = null;
            this.liTitle = '';
            this.processing = false;
            this.nonViableItemCount = 0;

            this.net.request(
                'open-ils.acq',
                'open-ils.acq.lineitem.retrieve',
                this.auth.token(),
                this.lineitemId, {
                    flesh_li_details: true,
                    flesh_bib: true,
                    flesh_display_entries: true
                }
            ).subscribe(li => {
                const attrs = li.eg_bib_id().flat_display_entries();
                const titleAttr = attrs.filter(a => a.name() === 'title_proper')[0];

                if (titleAttr) {
                    this.liTitle = titleAttr.value();
                }

                this.lineitem = li;
            });
        });
    }

    modify() {
        this.processing = true;

        // received, non-canceled lineitem details
        let receivedItems = this.lineitem.lineitem_details()
            .filter(d => Boolean(d.recv_time()) && !Boolean(d.cancel_reason()));

        console.log(receivedItems + ' are marked as received');

        if (receivedItems.length < this.nonViableItemCount) {
            alert($localize`Non-received item count ${this.nonViableItemCount} exceeds received item count ${receivedItems.length}`);
            this.processing = false;
            return;
        }

        // KCLS un-receives items in reverse alphabetical order of the
        // owning org unit shortname.
        receivedItems = receivedItems.sort((a, b) => {
            const asn = this.org.get(a.owning_lib()).shortname();
            const bsn = this.org.get(b.owning_lib()).shortname();
            return asn > bsn ? -1 : 1;
        })

        receivedItems = receivedItems.slice(0, this.nonViableItemCount);
        let unReceiveCount = 0;

        from(receivedItems)
        .pipe(
            concatMap(lid => {
                return this.net.request(
                    'open-ils.acq',
                    'open-ils.acq.lineitem_detail.receive.rollback',
                    this.auth.token(), (lid as IdlObject).id()
                ).pipe(tap(resp => {
                    let evt = this.evt.parse(resp);
                    if (evt) {
                        console.error('Unreceive error', evt);
                    } else {
                        this.respond(++unReceiveCount);
                    }
                }));
            })
        ).subscribe(_ => {
            this.processing = false;
            this.close();
        });
    }
}

