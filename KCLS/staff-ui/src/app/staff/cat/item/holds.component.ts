import {Component, Input, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {tap, concatMap} from 'rxjs/operators';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {EventService} from '@eg/core/event.service';
import {HoldCancelDialogComponent} from '@eg/staff/share/holds/cancel-dialog.component';

@Component({
  selector: 'eg-item-holds-transits',
  templateUrl: 'holds.component.html'
})

export class ItemHoldsTransitsComponent implements OnInit {

    @Input() item: IdlObject;
    hold: IdlObject;
    transit: IdlObject;
    loading = true;

    @ViewChild('cancelDialog') private cancelDialog: HoldCancelDialogComponent;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private net: NetService,
        private org: OrgService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private idl: IdlService,
        private evt: EventService
    ) { }

    ngOnInit() {
        this.load();
    }

    load(): Promise<any> {
        this.loading = true;
        this.hold = null;
        this.transit = null;

        return this.pcrud.search('ahr', {
            current_copy: this.item.id(),
            cancel_time: null,
            fulfillment_time: null,
            capture_time: {'<>': null}
        }, {
            flesh: 2,
            flesh_fields: {ahr: ['requestor', 'usr'], au: ['card']}

        }).toPromise().then(hold => {
            if (hold) {
                hold.pickup_lib(this.org.get(hold.pickup_lib()));
                hold.current_shelf_lib(this.org.get(hold.current_shelf_lib()));
                this.hold = hold;
            }
        })

        .then(_ => {
            return this.pcrud.search('atc',
                {target_copy: this.item.id()},
                {order_by: {atc: 'source_send_time DESC'}, limit: 1}
            ).toPromise();
        })

        .then(transit => {
            if (transit) {
                transit.source(this.org.get(transit.source()));
                transit.dest(this.org.get(transit.dest()));
                this.transit = transit;
            }
        })
        .then(_ => this.loading = false);
    }

    showCancelDialog() {
        this.cancelDialog.holdIds = [this.hold.id()];
        this.cancelDialog.open({}).subscribe(
            rowsModified => {
                this.load();
            }
        );
    }
}

