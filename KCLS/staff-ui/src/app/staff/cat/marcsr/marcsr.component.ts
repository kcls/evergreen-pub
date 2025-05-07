import {Component, OnInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {HttpClient} from '@angular/common/http';
import {from} from 'rxjs';
import {tap} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {MarcRecord, MarcField} from '@eg/staff/share/marc-edit/marcrecord';
import {AnonCacheService} from '@eg/share/util/anon-cache.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {GridDataSource, GridColumn, GridCellTextGenerator,
    GridRowFlairEntry} from '@eg/share/grid/grid';
import {GridComponent} from '@eg/share/grid/grid.component';
import {Pager} from '@eg/share/util/pager';
import {MarcDiffDialogComponent} from './diff-dialog.component';
import {GridFlatDataService} from '@eg/share/grid/grid-flat-data.service';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';

@Component({
  templateUrl: 'marcsr.component.html'
})
export class MarcSearchReplaceComponent implements OnInit {

    search: string;
    replace: string;

    buckets: ComboboxEntry[];
    bucketId: number;

    processing = false;
    postProcessed = false;
    progressMax = 0;
    progressValue = 0;
    numModified = 0;
    recordCount = 0;
    postApply = false;
    showExamples = false;
    recordsChanged: {[id: number]: boolean} = {};

    gridDataSource: GridDataSource = new GridDataSource();
    cellTextGenerator: GridCellTextGenerator;
    rowFlair: (row: IdlObject) => GridRowFlairEntry;

    @ViewChild('grid') private grid: GridComponent;
    @ViewChild('diffDialog') private diffDialog: MarcDiffDialogComponent;
    @ViewChild('confirmApply') private confirmApply: ConfirmDialogComponent;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private idl: IdlService,
        private net: NetService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private flatData: GridFlatDataService,
        private store: ServerStoreService
    ) {}

    ngOnInit() {

        this.route.paramMap.subscribe((params: ParamMap) => {
            this.bucketId = +params.get('bucketId');
            this.load();
        });

        this.gridDataSource.getRows = (pager: Pager, sort: any[]) => {
            if (!this.bucketId) { return from([]); }

            const query: any = {bucket: this.bucketId};

            return this.flatData.getRows(this.grid.context, query, pager, sort);
        };

        this.rowFlair = (row: IdlObject) => {
            if (this.recordChanged(row)) {
                return {icon: 'save', title: ''};
            }
        };
    }

    recordChanged(row: any): boolean {
        return this.recordsChanged[Number(row['target_biblio_record_entry.id'])];
    }

    load() {
        this.getBuckets()
        .then(_ => {
            const domId = !this.bucketId ? 'bucket-select' : 'task-search';
            const node = document.getElementById(domId);
            if (node) { node.focus(); }
        })
        .then(_ => this.getRecordCount(this.bucketId));
    }

    getRecordCount(bucketId: number): Promise<any> {
        this.recordCount = 0;
        return this.net.request('open-ils.cat',
            'open-ils.cat.biblio.marc.batch_update.record_count',
            this.auth.token(), bucketId)
        .toPromise().then(count => this.recordCount = count);
    }

    getBuckets(): Promise<any> {
        if (this.buckets) { return Promise.resolve(); }

        return this.net.request(
            'open-ils.actor',
            'open-ils.actor.container.retrieve_by_class',
            this.auth.token(), this.auth.user().id(),
            'biblio', ['staff_client', 'vandelay_queue']

        ).pipe(tap(buckets => {
            this.buckets = buckets
            .sort((b1, b2) => b1.name() < b2.name() ? -1 : 1)
            .map(b => ({id: b.id(), label: b.name()}));

        })).toPromise();
    }

    bucketChanged(entry: ComboboxEntry) {
        this.recordCount = 0;
        this.bucketId = entry ? entry.id : null;

        if (this.bucketId) {
            this.getRecordCount(this.bucketId);
        }

        this.grid.reload();
    }

    disableSave(): boolean {
        return (
            !this.search ||
            !this.bucketId ||
            this.processing ||
            this.postApply
        );
    }

    applyChanges() {
        this.confirmApply.open().subscribe(confirmed => {
            if (confirmed) { this.applyChangesPostConfirm(); }
        });
    }

    applyChangesPostConfirm() {
        this.processing = true;
        this.postProcessed = false;
        this.progressMax = 0;
        this.progressValue = 0;
        this.numModified = 0;

        const args: any = {
            apply: true,
            bucket_id: this.bucketId,
            search: this.search,
            replace: this.replace || ''
        };

        this.net.request('open-ils.cat',
            'open-ils.cat.biblio.marc.batch_update',
            this.auth.token(), args
        ).subscribe(
            resp => {
                if (resp.total) {
                    this.progressMax = resp.total;
                    this.progressValue = resp.progress;
                    this.numModified = resp.modified;
                }

                if (resp.record_modified) {
                    this.recordsChanged[Number(resp.record_id)] = true;
                }
            },
            err => console.error(err),
            () => {
                this.processing = false;
                this.postProcessed = true;
                this.postApply = true;
            }
        );
    }

    showDiffDialog(row: any) {
        // Timeout allows for changes to propagate from search/replace
        // inputs to models just in case.
        setTimeout(() => {
            this.diffDialog.search = this.search;
            this.diffDialog.replace = this.replace;
            this.diffDialog.postApply = this.postApply;
            this.diffDialog.recordId = row['target_biblio_record_entry.id'];
            this.diffDialog.open({size: 'xl'});
        });
    }

    showList() {
        this.postProcessed = false;
        this.gridDataSource.data = [];
        setTimeout(() => this.grid.reload());
    }

    startOver(force?: boolean) {
        this.recordsChanged = {};
        this.postApply = false;
        this.search = '';
        this.replace = '';
    }
}

