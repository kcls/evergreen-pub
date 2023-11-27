import {Component, OnInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {Location} from '@angular/common';
import {mergeMap, first, empty, Observable, Observer, of, from} from 'rxjs';
import {map, tap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {LineitemService} from '../lineitem/lineitem.service';
import {Pager} from '@eg/share/util/pager';
import {GridDataSource, GridColumn, GridCellTextGenerator} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {GridFlatDataService} from '@eg/share/grid/grid-flat-data.service';
import {ProgressInlineComponent} from '@eg/share/dialog/progress-inline.component';

@Component({
  templateUrl: 'report.component.html'
})
export class AsnReportComponent implements OnInit {

    invoiceIdent: string;

    @ViewChild('grid') grid: GridComponent;
    @ViewChild('progress') progress: ProgressInlineComponent;

    dataSource: GridDataSource = new GridDataSource();
    index = 0;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private ngLocation: Location,
        private pcrud: PcrudService,
        private net: NetService,
        private auth: AuthService,
        private flatData: GridFlatDataService,
        private li: LineitemService
    ) {}

    ngOnInit() {

        this.dataSource.getRows = (pager: Pager, sort: any[]) => {

            if (!this.invoiceIdent) { return empty(); }

            const query: any = {
                inv_ident: this.invoiceIdent
            };

            return this.flatData.getRows(this.grid.context, query, pager, sort)
            .pipe(mergeMap(row => {
                // No specific unique identifier for each row.
                row._index = this.index++;

                return from(
                    this.pcrud.search('mfde', {
                        source: row['lineitem.eg_bib_id'],
                        name: 'bibcn'
                    })
                    .toPromise()
                    .then(entry => {
                        if (entry) {
                            row._bib_call_number = entry.value();
                        }
                    })
                )
                .pipe(map(_ => row));
            }));
        };

        setTimeout(() => this.focusInput());
    }

    focusInput() {
        const node = document.getElementById('invoice-ident-input');
        if (node) { (node as HTMLInputElement).select(); }
    }

    load() {
        this.grid.reload();
    }

    printWorksheets() {
        let rows: any[] = [];
        this.grid.context.getSelectedRows().forEach(row => {
            const liId = row['lineitem.id'];
            if (rows.filter(r => r['lineitem.id'] === liId).length === 0) {
                rows.push(row);
            }
       });

       this.printWorksheetList(rows);
    }

    printWorksheetList(rows: any[]) {
        if (rows.length === 0) { return; }

        const row = rows.pop();

        const liId = row['lineitem.id'];
        const poId = row['purchase_order.id'];

        console.debug('Printing lineitem ', liId);

        const url = this.ngLocation.prepareExternalUrl(
            `/staff/acq/po/${poId}/lineitem/${liId}/worksheet/print/close`);

        window.open(url);

        setTimeout(() => this.printWorksheetList(rows), 2000);
    }
}

