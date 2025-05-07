import {Component, Input, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {Location} from '@angular/common';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {from, empty, range} from 'rxjs';
import {concatMap, tap, map, takeLast} from 'rxjs/operators';
import {NgbNav, NgbNavChangeEvent} from '@ng-bootstrap/ng-bootstrap';
import {IdlObject} from '@eg/core/idl.service';
import {EventService} from '@eg/core/event.service';
import {OrgService} from '@eg/core/org.service';
import {NetService} from '@eg/core/net.service';
import {PcrudService, PcrudContext} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {GridDataSource, GridColumn, GridCellTextGenerator} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {GridFlatDataService} from '@eg/share/grid/grid-flat-data.service';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';
import {BroadcastService} from '@eg/share/util/broadcast.service';
import {ProgressInlineComponent} from '@eg/share/dialog/progress-inline.component';

@Component({
  templateUrl: 'pending.component.html',
  selector: 'eg-patron-pending'
})
export class PendingPatronsComponent implements OnInit {

    gridDataSource: GridDataSource = new GridDataSource();

    @ViewChild('grid') private grid: GridComponent;
    @ViewChild('confirmDelete') private confirmDelete: ConfirmDialogComponent;
    @ViewChild('loadProgress') private loadProgress: ProgressInlineComponent;

    contextOrg: number;
    deleteCount = 0;
    loading = false;

    constructor(
        private router: Router,
        private ngLocation: Location,
        private evt: EventService,
        private org: OrgService,
        private net: NetService,
        private auth: AuthService,
        private broadcaster: BroadcastService
    ) {}

    ngOnInit() {

        this.gridDataSource.getRows = (pager: Pager, sort: any[]) => {
            if (!this.contextOrg) { return empty(); }

            this.loading = true;
            setTimeout(() => this.loadProgress.update({value: 0}));

            const orgs = this.org.descendants(this.contextOrg, true);

            return this.net.request(
                'open-ils.actor',
                'open-ils.actor.user.stage.retrieve.by_org',
                this.auth.token(), orgs,
                pager.limit, pager.offset

            ).pipe(
                map(data => {
                    this.loadProgress.increment();

                    const user = data.user;
                    data.id = user.row_id();
                    user.home_ou(this.org.get(user.home_ou()));

                    data.mailing_address =
                        data.billing_addresses[0] || data.mailing_addresses[0];

                    return data;
                }),
                tap(null, null, () => this.loading = false)
            );
        };

        this.broadcaster.listen('eg.pending_usr.update').subscribe(data => {
            console.debug('Broadcast received for "eg.pending_usr.update"');
            this.grid.reload();
        });
    }

    homeLibChanged(org: IdlObject) {
        this.contextOrg = org ? org.id() : null;
        this.grid.reload();
    }

    openPatron(rows: any | any[]) {
        const stages = [].concat(rows);

        if (stages.length === 0) { return; }

        const stage = stages[0];

        const url = this.ngLocation.prepareExternalUrl(
            '/staff/circ/patron/register/stage/' + stage.user.usrname());
        window.open(url);
    }

    deleteSelected(rows: any[]) {
        if (rows.length === 0) { return; }

        this.deleteCount = rows.length;

        this.confirmDelete.open().subscribe(confirmed => {
            if (!confirmed) { return; }

            from(rows).pipe(concatMap(row => {

                return this.net.request(
                    'open-ils.actor',
                    'open-ils.actor.user.stage.delete',
                    this.auth.token(), row.id
                );
            })).toPromise().then(_ => this.grid.reload());
        });
    }
}

