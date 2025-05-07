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

@Component({
  selector: 'eg-item-recent-history',
  templateUrl: 'recent-history.component.html'
})

export class ItemRecentHistoryComponent implements OnInit {

    @Input() item: IdlObject;

    loading = false;
    circInfo: ItemCircInfo;

    @ViewChild('copyAlertsDialog') private copyAlertsDialog: CopyAlertsDialogComponent;

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
        public  format: FormatService
    ) { }

    ngOnInit() {
        this.loading = true;
        this.loadCircInfo()
        .then(_ => this.loading = false);
    }

    loadCircInfo(): Promise<any> {
        return this.circs.getItemCircInfo(this.item)
        .then(info => this.circInfo = info);
    }
}


