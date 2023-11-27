import {Component, OnInit, Renderer2, ViewChild} from '@angular/core';
import {Router, ActivatedRoute} from '@angular/router';
import {Observable, empty, of, from} from 'rxjs';
import {concatMap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {GridDataSource, GridCellTextGenerator} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {Location} from '@angular/common';
import {WorkLogEntry, WorkLogService} from '@eg/staff/share/worklog/worklog.service';

@Component({
    templateUrl: 'worklog.component.html'
})

export class CircWorkLogComponent implements OnInit {

    autoIndex = 1;
    cellTextGenerator: GridCellTextGenerator;
    actionDataSource: GridDataSource = new GridDataSource();
    patronDataSource: GridDataSource = new GridDataSource();

    @ViewChild('actionGrid') actionGrid: GridComponent;
    @ViewChild('patronGrid') patronGrid: GridComponent;

    constructor(
        private router: Router,
        private ngLocation: Location,
        private org: OrgService,
        private auth: AuthService,
        private pcrud: PcrudService,
        private workLog: WorkLogService,
    ) { }

    ngOnInit() {

        this.workLog.loadSettings();

        this.actionDataSource.getRows =
            (pager: Pager, sort: any[]): Observable<any> => {

            const actions = this.workLog.getActions();
            actions.forEach(p => p.index = this.autoIndex++);

            return from(actions);
        };

        this.patronDataSource.getRows =
            (pager: Pager, sort: any[]): Observable<any> => {

            const patrons = this.workLog.getPatrons();
            patrons.forEach(p => p.index = this.autoIndex++);

            return from(patrons);
        };

        this.cellTextGenerator = {
            user: row => row.user,
            item: row => row.item
        };
    }

    showPatron(row: IdlObject) {
        if (row.patron_id) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/circ/patron/${row.patron_id}/checkout`);
            window.open(url);
        }
    }

    showItem(row: IdlObject) {
        if (row.item_id) {
            const url = this.ngLocation.prepareExternalUrl(
                `/staff/cat/item/${row.item_id}/summary`);
            window.open(url);
        }
    }

}

