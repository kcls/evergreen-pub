import {Component, Input, ViewChild, OnInit} from '@angular/core';
import {from} from 'rxjs';
import {AuthService} from '@eg/core/auth.service';
import {NetService} from '@eg/core/net.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {OrgService} from '@eg/core/org.service';
import {GridDataSource} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';

@Component({
    templateUrl: './float-policy-test.component.html',
})
export class FloatPolicyTestComponent implements OnInit {
    itemBarcode = '';
    checkinOrg: number | null = null;
    destOrg: number | null = null;
    destOrgName = '';
    dataSource: GridDataSource = new GridDataSource();
    copyStats: any = [];
    @ViewChild('grid') grid: GridComponent;

    constructor(
        private net: NetService,
        private org: OrgService,
        private auth: AuthService
    ) {}

    ngOnInit() {
        this.checkinOrg = this.auth.user().ws_ou();
        this.dataSource.getRows = (pager: Pager, sort: any[]) => {
            return from(this.copyStats);
        };
    }

    test() {
        this.copyStats = [];
        this.destOrg = null;

        if (!this.itemBarcode || !this.checkinOrg) {
            return;
        }

        this.net.request(
            'open-ils.circ',
            'open-ils.circ.float_policy.test',
            this.auth.token(),
            this.itemBarcode,
            this.checkinOrg
        ).subscribe(info => {
            info.stats.forEach(i => {
                i.circ_lib = this.org.get(i.circ_lib).shortname();
                i.avail_slots = i.location_slots - i.location_slots_filled;
            });
            this.copyStats = info.stats;
            this.destOrg = info.dest;
            this.destOrgName = this.org.get(info.dest).shortname();
            this.grid.reload();
        });
    }
}


