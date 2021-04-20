import {Injectable} from '@angular/core';
import {Observable, empty, from} from 'rxjs';
import {map, concatMap, mergeMap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {EventService, EgEvent} from '@eg/core/event.service';
import {AuthService} from '@eg/core/auth.service';
import {BibRecordService, BibRecordSummary} from '@eg/share/catalog/bib-record.service';
import {AudioService} from '@eg/share/util/audio.service';
import {CircEventsComponent} from './events-dialog.component';
import {CircComponentsComponent} from './components.component';
import {StringService} from '@eg/share/string/string.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {StoreService} from '@eg/core/store.service';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';

export interface WorkLogEntry {
    when?: Date;
    msg?: string;
    action?: string;
    actor?: string // staff username
    item?: string; // barcode
    item_id?: number;
    user?: string; // patron family name
    patron_id?: number;
    hold_id?: number;
    amount?: number; // paid amount
}


@Injectable()
export class WorkLogService {

    maxEntries: number = null;
    maxPatrons: number = null;
    components: CircComponentsComponent;

    constructor(
        private store: StoreService,
        private serverStore: ServerStoreService,
        private auth: AuthService
    ) {}

    loadSettings(): Promise<any> {
        return this.serverStore.getItemBatch([
            'ui.admin.work_log.max_entries',
            'ui.admin.patron_log.max_entries'
        ]).then(sets => {
            this.maxEntries = sets['ui.admin.work_log.max_entries'] || 20;
            this.maxPatrons = sets['ui.admin.patron_log.max_entries'] || 10;
        });
    }

    record(entry: WorkLogEntry) {

        if (this.maxEntries === null) {
            throw new Error('WorkLogService.loadSettings() required');
            return;
        }

        entry.when = new Date();
        entry.actor = this.auth.user().usrname();
        entry.msg = this.components[`worklog_${entry.action}`].text;

        const workLog = this.store.getLocalItem('eg.work_log') || [];
        let patronLog = this.store.getLocalItem('eg.patron_log') || [];

        workLog.push(entry);
        if (workLog.lenth > this.maxEntries) {
            workLog.shift();
        }

        console.log('HERE', workLog);

        this.store.setLocalItem('eg.work_log', workLog);

        if (entry.patron_id) {
            // Remove existing entries that match this patron
            patronLog = patronLog.filter(e => e.patron_id !== entry.patron_id);

            patronLog.push(entry);
            if (patronLog.length > this.maxPatrons) {
                patronLog.shift();
            }

            this.store.setLocalItem('eg.patron_log', patronLog);
        }
    }
}


