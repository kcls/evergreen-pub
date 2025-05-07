import {Component, OnInit, Output, Input, ViewChild, EventEmitter} from '@angular/core';
import {empty, Observable} from 'rxjs';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {Pager} from '@eg/share/util/pager';
import {GridDataSource, GridColumn, GridCellTextGenerator,
    GridColumnSort} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';

/* Triggered Events Component */


@Component({
  templateUrl: 'triggered-events.component.html',
  selector: 'eg-triggered-events'
})
export class TriggeredEventsComponent implements OnInit {

    @Input() persistKey: string;
    @Input() targetType: string; // user / copy
    @Input() targetId: number;   // user ID / copy ID
    @Input() eventClass = 'circ'; // circ / ahr
    @Input() eventState = 'pending';

    dataSource: GridDataSource = new GridDataSource();
    cellTextGenerator: GridCellTextGenerator;

    @ViewChild('grid') grid: GridComponent;

    constructor(
        private net: NetService,
        private auth: AuthService
    ) {}

    ngOnInit() {
        this.dataSource.getRows =
            (pager: Pager, sort: GridColumnSort[]) => this.getEvents(pager);

        this.cellTextGenerator = {
            title: row => row.title,
            'item_barcode': row => this.targetItem(row).barcode(),
            'target_id': row => this.targetUserId(row) + '',
        };
    }

    getEvents(pager: Pager): Observable<IdlObject> {
        if (!this.targetType || !this.targetId) { return empty(); }

        const filter = {
            event: {state: this.eventState},
            limit: pager.limit,
            offset: pager.offset,
            order_by: [{class: 'atev', field: 'run_time', direction: 'desc'}]
        };

        const method =
            `open-ils.actor.${this.targetType}.events.${this.eventClass}`;

        return this.net.request('open-ils.actor',
            method, this.auth.token(), this.targetId, filter, true);

    }

    reload() {
        this.grid.reload();
    }

    targetUserId(evt: IdlObject): number {
        const usr = evt.target().usr(); // same for circ and holds
        return typeof usr === 'object' ? usr.id() : usr; // maybe fleshed
    }

    targetItem(evt: IdlObject): IdlObject {
        const field = this.eventClass === 'circ' ? 'target_copy' : 'current_copy';

        // Protect against calls for this data mid-eventClass change
        if (evt.target()[field]) {
            return evt.target()[field]();
        }
    }

    targetBib(evt: IdlObject): IdlObject {
        const item = this.targetItem(evt);
        if (item) {
            return item.call_number().record();
        }
    }

    affectEvents(evts: IdlObject[], action: 'cancel' | 'reset') {
        if (evts.length === 0) { return; }
        this.dataSource.requestingData = true;

        const method = `open-ils.actor.user.event.${action}.batch`;

        this.net.request(
            'open-ils.actor', method,
            this.auth.token(), evts.map(e => e.id())
        ).subscribe(
            null,
            null,
            () => this.grid.reload()
        );
    }
}

