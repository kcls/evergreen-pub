import {Component, OnInit, Renderer2, ViewChild} from '@angular/core';
import {Router, ActivatedRoute} from '@angular/router';
import {Observable, empty} from 'rxjs';
import {mergeMap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {GridDataSource, GridCellTextGenerator} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {Location} from '@angular/common';
import {AdaRequestDialogComponent} from './request.component';

@Component({
    templateUrl: 'list.component.html'
})

export class AdaRequestListComponent implements OnInit {

    cellTextGenerator: GridCellTextGenerator;
    dataSource: GridDataSource = new GridDataSource();
    @ViewChild('grid', {static: false}) grid: GridComponent;
    @ViewChild('requestDialog', {static: false})
        private requestDialog: AdaRequestDialogComponent;

    constructor(
        private router: Router,
        private ngLocation: Location,
        private org: OrgService,
        private auth: AuthService,
        private pcrud: PcrudService
    ) { }

    ngOnInit() {

        this.cellTextGenerator = {
            barcode: row => row.usr().card().barcode()
        };

        this.dataSource.getRows =
            (pager: Pager, sort: any[]): Observable<any> => {

            const orderBy: any = {aar: 'create_time ASC'};

            if (sort.length) {
                // Sort specified from grid
                orderBy.aar = sort[0].name + ' ' + sort[0].dir;
            }

            const searchOps = {
                offset: pager.offset,
                limit: pager.limit,
                order_by: orderBy,
                flesh: 2,
                flesh_fields: {
                    aar: ['usr', 'approved_by', 'rejected_by'], // TODO rejected_by
                    au: ['card']
                }
            };

            return this.pcrud.search('aar',
                {approved_by: null, rejected_by: null}, searchOps);
        };
    }

    showPatron(row: IdlObject) {
        let path = `/staff/circ/patron/${row.usr().id()}/edit`;

        if (row.reject_time()) {
            path = `/staff/circ/patron/${row.usr().id()}/checkout`;
        }

        const url = this.ngLocation.prepareExternalUrl(path);
        window.open(url);
    }

    showRequest(req: IdlObject) {
        this.requestDialog.request = req;
        this.requestDialog.open({size: 'lg'}).subscribe(req => {
            if (req) {
                this.grid.reload();
                this.showPatron(req);
            }
        });
    }
}

