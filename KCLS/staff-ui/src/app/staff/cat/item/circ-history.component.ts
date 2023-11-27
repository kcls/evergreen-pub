import {Component, Input, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {PrintService} from '@eg/share/print/print.service';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {EventService} from '@eg/core/event.service';
import {PermService} from '@eg/core/perm.service';
import {BarcodeSelectComponent} from '@eg/staff/share/barcodes/barcode-select.component';
import {CatalogService} from '@eg/share/catalog/catalog.service';
import {CircService, ItemCircInfo} from '@eg/staff/share/circ/circ.service';
import {CopyAlertsDialogComponent
    } from '@eg/staff/share/holdings/copy-alerts-dialog.component';
import {FormatService} from '@eg/core/format.service';
import {AddBillingDialogComponent} from '@eg/staff/share/billing/billing-dialog.component';
import {ToastService} from '@eg/share/toast/toast.service';
import {StringService} from '@eg/share/string/string.service';

@Component({
  selector: 'eg-item-circ-history',
  templateUrl: 'circ-history.component.html'
})

export class ItemCircHistoryComponent implements OnInit {

    @Input() item: IdlObject;
    recentCircs: IdlObject[] = [];

    loading = false;
    @ViewChild('billingDialog') private billingDialog: AddBillingDialogComponent;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private net: NetService,
        private org: OrgService,
        private printer: PrintService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private perms: PermService,
        private idl: IdlService,
        private evt: EventService,
        private cat: CatalogService,
        private holdings: HoldingsService,
        private circs: CircService,
        private toast: ToastService,
        private strings: StringService,
        public  format: FormatService
    ) { }

    ngOnInit() {
        this.load();
    }

    load(): Promise<any> {
        this.loading = true;
        return this.circs.getRecentCircs(this.item)
        .then(circs => {
            circs.forEach(circ => {
                circ.circ_lib(this.org.get(circ.circ_lib()));
                circ.checkin_lib(this.org.get(circ.checkin_lib()));
            });
            this.recentCircs = circs;
        })
        .then(_ => this.loading = false);
    }

    addBilling(circId: number) {
        this.billingDialog.xactId = circId;
        this.billingDialog.open().subscribe(data => {
            // No need to reload the data since money is not displayed.
            if (data) {
                this.strings.interpolate('staff.cat.item.circs.billing')
                .then(str => this.toast.success(str));
            }
        });
    }
}


