import {Component, OnInit, ViewChild} from '@angular/core';
import {Router} from '@angular/router';
import {Location} from '@angular/common';
import {from, EMPTY} from 'rxjs';
import {concatMap} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {GridDataSource, GridColumn, GridCellTextGenerator,
    GridRowFlairEntry, GridColumnSort} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {PromptDialogComponent} from '@eg/share/dialog/prompt.component';

@Component({
  templateUrl: 'list.component.html'
})
export class ItemRequestComponent implements OnInit {
    gridDataSource: GridDataSource = new GridDataSource();
    showRouteToIll = true;
    showRouteToPurchasing = true;
    cellTextGenerator: GridCellTextGenerator;

    @ViewChild('grid') private grid: GridComponent;
    @ViewChild('vendorPrompt') private vendorPrompt: PromptDialogComponent;

    constructor(
        private router: Router,
        private ngLocation: Location,
        private idl: IdlService,
        private net: NetService,
        private pcrud: PcrudService,
        private auth: AuthService,
    ) {}

    ngOnInit() {
        this.cellTextGenerator = {
            patron_barcode: r => r.usr().card() ? r.usr().card().barcode() : '',
            route_to: r => r.route_to(),
        };

        this.gridDataSource.getRows = (pager: Pager, sort: GridColumnSort[]) => {
            const orderBy: any = {ausp: 'create_date'};

            if (sort.length) {
                orderBy.auir = sort[0].name + ' ' + sort[0].dir;
            }

            // base query to grab everything
            let base = {
                complete_date: null,
                cancel_date: null,
                route_to: ['ill', 'purchasing']
            }

            if (!this.showRouteToIll) {
                base.route_to = ['purchasing'];
            } else if (!this.showRouteToPurchasing) {
                base.route_to = ['ill'];
            }

            const query: any = new Array();
            query.push(base);

            // and add any filters
            const filters = this.gridDataSource.filters;
            Object.keys(filters).forEach(key => {
                Object.keys(filters[key]).forEach(key2 => {
                    query.push(filters[key][key2]);
                });
            });

            const flesh = {
                flesh: 2,
                flesh_fields: {
                    auir: ['usr', 'claimed_by'],
                    au: ['card']
                },
                order_by: orderBy
            };

            return this.pcrud.search('auir', query, flesh);
        };
    }

    toggleRouteToIll(action: boolean) {
        this.showRouteToIll = action;
        this.grid.reload();
    }

    toggleRouteToPurchasing(action: boolean) {
        this.showRouteToPurchasing = action;
        this.grid.reload();
    }

    claimItems(reqs: IdlObject[]) {
        reqs.forEach(r => {
            if (!r.claimed_by()) {
                r.claimed_by(this.auth.user().id());
                r.claim_date('now');
            }
        });

        this.updateReqs(reqs);
    }

    applyVendor(reqs: IdlObject[]) {
        this.vendorPrompt.open().subscribe(value => {
            if (!value) { return; }

            reqs.forEach(r => r.vendor(value));
            this.updateReqs(reqs);
        });
    }

    updateReqs(reqs: IdlObject[]) {
        from(reqs).pipe(concatMap(req => {
            return this.pcrud.update(req);
        })).subscribe(
            null,
            null,
            () => this.grid.reload()
        );
    }

    // may not need this.
    showRequestDialog(req: IdlObject) {
    }


    createIllRequest(reqs: IdlObject[]) {
        reqs = [].concat(reqs);
        let req = reqs[0];
        if (!req) { return; }

        let url = '/staff/cat/ill/track?';
        url += `title=${encodeURIComponent(req.title())}`;
        url += `&patronBarcode=${encodeURIComponent(req.usr().card().barcode())}`;

        url = this.ngLocation.prepareExternalUrl(url);

        window.open(url);
    }
}

