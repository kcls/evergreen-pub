import {Component, OnInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {Location} from '@angular/common';
import {mergeMap, concatMap, first, EMPTY, empty, Observable, Observer, of, from} from 'rxjs';
import {map, tap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {LineitemService} from '../lineitem/lineitem.service';
import {Pager} from '@eg/share/util/pager';
import {GridDataSource, GridColumn, GridCellTextGenerator, GridRowFlairEntry} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {GridFlatDataService} from '@eg/share/grid/grid-flat-data.service';
import {ProgressInlineComponent} from '@eg/share/dialog/progress-inline.component';
import {PartialReceiveDialogComponent} from './partial-receive-dialog.component';

@Component({
  templateUrl: 'report.component.html'
})
export class AsnReportComponent implements OnInit {

    invoiceIdent: string;
    asnBarcode: string;
    codeList: string[] = [];

    @ViewChild('grid') grid: GridComponent;
    @ViewChild('progress') progress: ProgressInlineComponent;
    @ViewChild('prDialog') prDialog: PartialReceiveDialogComponent;

    rowFlairCallback: (row: any) => GridRowFlairEntry;

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

        const codes = this.route.snapshot.queryParamMap.get('containerCodes');
        if (codes) { this.codeList = codes.split(','); }

        this.dataSource.getRows = (pager: Pager, sort: any[]) => {
            //console.debug(this.invoiceIdent, this.asnBarcode, this.codeList);

            if (!this.invoiceIdent && !this.asnBarcode && this.codeList.length === 0) {
                return EMPTY;
            }

            let query: any = {};

            if (this.invoiceIdent) {
                query.inv_ident = this.invoiceIdent;
            } else if (this.codeList.length > 0) {
                query.container_code = this.codeList;
            } else {
                query.container_code = this.asnBarcode;
            }

            sort = [
                // For grouped containers
                {name: 'container_code', dir: 'asc'},
                {name: 'shipment_notification.recv_date', dir: 'asc'}
            ];

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

        this.rowFlairCallback = (row: any): GridRowFlairEntry => {
            if (row._isPartial) {
                return {icon: 'priority_high'};
            }
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


    modifyReceiveCount(rows: any[]) {
        let row = rows[0];
        if (!row) { return; }

        this.prDialog.lineitemId = row['lineitem.id'];
        this.prDialog.asnItemCount = row['item_count_for_lineitem'];

        this.prDialog.open({size: 'md'}).subscribe(count => {
            console.debug('Modified ', count);
            row._isPartial = true;
        });
    }

    markInvoicesReadyForPayment() {
        let invoiceIds = [];
        this.grid.context.getSelectedRows().forEach(row => {

            if (Boolean(row['ready_for_payment_at'])) {
                return;
            }

            let id = Number(row['invoice.id']);
            if (!invoiceIds.includes(id)) {
                invoiceIds.push(id);
            }
        });

        this.pcrud.search('acqinv', {id: invoiceIds}, {}, {atomic: true}).toPromise()
        .then(invoices => {
            let toUpdate = [];
            invoices.forEach(inv => {
                if (Boolean(inv.ready_for_payment_at())) {
                    return;
                }

                inv.ready_for_payment_at('now');
                inv.ready_for_payment_by(this.auth.user().id());
                toUpdate.push(inv);
            });

            this.pcrud.update(toUpdate)
            .subscribe(
                resp => {
                    console.log('Resp', resp);
                },
                _ => {},
                () => {
                    console.log('all done');
                }
            );

        });

        console.log("Marking invoices as ready for payment", invoiceIds);
    }
}

