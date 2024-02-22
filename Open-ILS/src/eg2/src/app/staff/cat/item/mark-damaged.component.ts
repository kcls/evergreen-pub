import {Component, Input, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {NetService} from '@eg/core/net.service';
import {PrintService} from '@eg/share/print/print.service';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {EventService} from '@eg/core/event.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {MarkDamagedDialogComponent
    } from '@eg/staff/share/holdings/mark-damaged-dialog.component';

@Component({
  templateUrl: 'mark-damaged.component.html'
})
export class MarkDamagedComponent implements OnInit, AfterViewInit {

    copyId: number;
    printPreviewHtml = '';
    printDetails: any = {};

    @ViewChild('markDamagedDialog')
    private markDamagedDialog: MarkDamagedDialogComponent;

    constructor(
        private route: ActivatedRoute,
        private net: NetService,
        private printer: PrintService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private evt: EventService,
        private toast: ToastService,
        private store: ServerStoreService,
        private holdings: HoldingsService
    ) {}

    ngOnInit() {
        this.copyId = +this.route.snapshot.paramMap.get('id');
        this.printDetails = {};
    }

    ngAfterViewInit() {
        this.markDamagedDialog.copyId = this.copyId;

        this.markDamagedDialog.open({size: 'lg'})
        .subscribe((details: any) => {
            if (details && details.circ) {
                this.printDetails = {
                    printContext: 'default',
                    templateName: 'damaged_item_letter',
                    contextData: {
                        circulation: details.circ,
                        copy: details.copy,
                        patron: details.circ.usr(),
                        note: details.note,
                        cost: parseFloat(details.bill_amount).toFixed(2),
                        title: details.title,
                        dibs: details.dibs
                    }
                };
                this.printLetter(true);
            }
        });
    }

    printLetter(previewOnly?: boolean) {
        if (previewOnly) {
            this.printer.compileRemoteTemplate(this.printDetails)
            .then(response => {
                this.printPreviewHtml = response.content;
                document.getElementById('print-preview-pane').innerHTML = response.content;
            });
        } else {
            this.printer.print(this.printDetails);
        }
    }
}

