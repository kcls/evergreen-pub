import {Component, OnInit, Renderer2, ViewChild} from '@angular/core';
import {Router, ActivatedRoute} from '@angular/router';
import {Observable, empty} from 'rxjs';
import {mergeMap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {GridDataSource} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {RefundsService} from './refunds.service';

@Component({
    templateUrl: 'refunds.component.html'
})
export class RefundsComponent implements OnInit {

    dataSource: GridDataSource;
    @ViewChild('grid', {static: false}) grid: GridComponent;
    patronBarcode: string;
    receiptCode: string;

    constructor(
        private router: Router,
        private org: OrgService,
        private auth: AuthService,
        private pcrud: PcrudService,
        private refunds: RefundsService
    ) {
      this.dataSource = new GridDataSource();
    }

    ngOnInit() {

        if (!this.refunds.contextOrg) {
            this.refunds.contextOrg = this.org.get(this.auth.user().ws_ou());
        }

        this.dataSource.getRows =
            (pager: Pager, sort: any[]): Observable<any> => {

            const orderBy: any = {};

            if (sort.length) {
                // Sort specified from grid
                orderBy.mrxs = sort[0].name + ' ' + sort[0].dir;
            }

            const searchOps = {
                offset: pager.offset,
                limit: pager.limit,
                order_by: orderBy
            };

            if (this.receiptCode) {
                return this.getXactsByReceipt(searchOps);
            } else if (this.patronBarcode) {
                return this.getXactsByUser(searchOps);
            } else {
                return this.getXactsByOrg(searchOps);
            }
        };
    }

    getXactsByOrg(searchOps: any): Observable<any> {
        const orgs = this.org.descendants(
          this.refunds.contextOrg.id(), true);

        return this.pcrud.search('merx',
            {patron_home_ou: orgs}, {}, {atomic: true}
        ).pipe(mergeMap(xacts => {
            if (xacts.length === 0) { return empty(); }
            const ids = xacts.map(x => x.id());
            return this.pcrud.search('mrxs', {id: ids}, searchOps);
        }));
    }

    getXactsByUser(searchOps: any): Observable<any> {
        return this.pcrud.search('ac',
            {barcode: this.patronBarcode}, {}, {atomic: true}
        ).pipe(mergeMap(card => {
            if (card.length === 0) { return empty(); }
            const userId = card[0].usr();
            return this.pcrud.search('mrxs', {usr: userId}, searchOps);
        }));
    }

    getXactsByReceipt(searchOps: any): Observable<any> {
        return this.pcrud.search('mrps',
            {receipt_code: this.receiptCode}, {}, {atomic: true}
        ).pipe(mergeMap(payment => {
            if (payment.length === 0) { return empty(); }
            const xactId = payment[0].refundable_xact();
            return this.pcrud.retrieve('mrxs', xactId, searchOps);
        }));
    }

    contextOrg(): IdlObject {
        return this.refunds.contextOrg;
    }

    showDetails(row: any) {
        this.router.navigate(['/staff/circ/refunds/' + row.id()]);
    }

    orgChanged(org: IdlObject) {
        this.patronBarcode = null;
        this.refunds.contextOrg = org;
        this.grid.reload();
    }

    searchPatron() {
        this.grid.reload();
    }
}


