/**
 * Common code for mananging holdings
 */
import {Injectable, EventEmitter} from '@angular/core';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {tap} from 'rxjs/operators';
import {NetService} from '@eg/core/net.service';
import {AnonCacheService} from '@eg/share/util/anon-cache.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {EventService} from '@eg/core/event.service';

export interface CallNumData {
    owner?: number;
    label?: string;
    fast_add?: boolean;
    barcode?: string;
    callnumber?: number;
}

@Injectable()
export class HoldingsService {

    copyStatuses: {[id: number]: IdlObject};

    constructor(
        private net: NetService,
        private auth: AuthService,
        private pcrud: PcrudService,
        private evt: EventService,
        private idl: IdlService,
        private anonCache: AnonCacheService
    ) {}

    // Open the holdings editor UI in a new browser window/tab.
    spawnAddHoldingsUi(
        recordId: number,                  // Bib record ID
        editExistingCallNums?: number[],   // Add copies to / modify existing CNs
        newCallNumData?: CallNumData[],    // Creating new call numbers
        editCopyIds?: number[],            // Edit existing items
        hideCopies?: boolean,              // Hide the copy edit pane
        hideVols?: boolean) {

        const raw: any[] = [];

        if (editExistingCallNums) {
            editExistingCallNums.forEach(
                callNumId => raw.push({callnumber: callNumId}));
        } else if (newCallNumData) {
            newCallNumData.forEach(data => raw.push(data));
        }

        this.anonCache.setItem(null, 'edit-these-copies', {
            record_id: recordId,
            raw: raw,
            copies: editCopyIds,
            hide_vols : hideVols === true,
            hide_copies : hideCopies === true
        }).then(key => {
            if (!key) {
                console.error('Could not create holds cache key!');
                return;
            }
            setTimeout(() => {
                const tab = hideVols ? 'attrs' : 'holdings';
                const url = `/eg2/staff/cat/volcopy/${tab}/session/${key}`;
                window.open(url, '_blank');
            });
        });
    }

    /* TODO: make these more configurable per lp1616170 */
    getMagicCopyStatuses(): Promise<number[]> {
        return Promise.resolve([
            1,  // Checked out
            3,  // Lost
            4,  // Missing
            6,  // In transit
            8,  // On holds shelf
            11, // Cataloging
            16  // Long overdue
        ]);
    }

    // Using open-ils.actor.get_barcodes
    getItemIdFromBarcode(barcode: string): Promise<number> {
        return this.net.request(
            'open-ils.actor',
            'open-ils.actor.get_barcodes',
            this.auth.token(), this.auth.user().ws_ou(), 'asset', barcode
        ).toPromise().then(resp => {
            if (this.evt.parse(resp)) {
                return Promise.reject(resp);
            } else if (resp.length === 0) {
                return null;
            } else {
                return resp[0].id;
            }
        });
    }

    getCopyStatuses(): Promise<{[id: number]: IdlObject}> {
        if (this.copyStatuses) {
            return Promise.resolve(this.copyStatuses);
        }

        this.copyStatuses = {};
        return this.pcrud.retrieveAll('ccs', {order_by: {ccs: 'name'}})
        .pipe(tap(stat => this.copyStatuses[stat.id()] = stat))
        .toPromise().then(_ => this.copyStatuses);
    }

    // TODO stub methods were copied from volcopy.service.  Update
    // volcopy.service to call these first then tweak locally as needed.
    createStubVol(recordId: number, orgId: number, options?: any): IdlObject {
        if (!options) { options = {}; }

        const vol = this.idl.create('acn');
        // vol.id(this.autoId--);
        vol.isnew(true);
        vol.record(recordId);
        vol.label(null);
        vol.owning_lib(Number(orgId));
        // vol.prefix(this.defaults.values.prefix || -1);
        // vol.suffix(this.defaults.values.suffix || -1);
        vol.prefix(-1);
        vol.suffix(-1);
        vol.copies([]);

        return vol;
    }

    createStubCopy(vol: IdlObject, options?: any): IdlObject {
        if (!options) { options = {}; }

        const copy = this.idl.create('acp');
        // copy.id(this.autoId--);
        copy.isnew(true);
        //copy.call_number(vol); // fleshed
        copy.call_number(vol.id());
        copy.price('0.00');
        copy.deposit_amount('0.00');
        copy.fine_level(2);     // "Normal"
        copy.loan_duration(2);  // "Normal"
        copy.location(1); // "Stacks"
        //copy.location(this.commonData.acp_default_location);
        copy.circ_lib(Number(options.circLib || vol.owning_lib()));

        copy.deposit('f');
        copy.circulate('t');
        copy.holdable('t');
        copy.opac_visible('t');
        copy.ref('f');
        copy.mint_condition('t');

        copy.parts([]);
        copy.tags([]);
        copy.notes([]);
        copy.copy_alerts([]);
        copy.stat_cat_entries([]);

        return copy;
    }
}

