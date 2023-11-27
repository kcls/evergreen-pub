import {Component, OnInit, AfterViewInit, ViewChild, Renderer2} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {of, Observable} from 'rxjs';
import {tap, take} from 'rxjs/operators';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {FormatService} from '@eg/core/format.service';
import {AuthService} from '@eg/core/auth.service';
import {OrgService} from '@eg/core/org.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {StoreService} from '@eg/core/store.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {ComboboxEntry, ComboboxComponent} from '@eg/share/combobox/combobox.component';
import {ProgressDialogComponent} from '@eg/share/dialog/progress.component';
import {EventService} from '@eg/core/event.service';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';
import {BroadcastService} from '@eg/share/util/broadcast.service';

// Contains all the items attached to a given volume.
interface VolSet {
    volume: IdlObject;
    items: IdlObject[];
}

// Contains all the volumes which are owned by a given org unit.
interface OrgSet {
    org: IdlObject;
    volumes: VolSet[];
}

@Component({
  templateUrl: 'update-items.component.html'
})
export class UpdateItemsComponent implements OnInit, AfterViewInit {

    recordId: number = null;
    lineitemId: number = null;
    lineitem: IdlObject = null;
    lineitems: IdlObject[] = [];
    circModMap: {[id: number]: IdlObject} = {};
    circModifiers: ComboboxEntry[] = [];

    // Locations that live "here"
    localCopyLocations: ComboboxEntry[] = [];

    // Locations that live "here" plus any extras that we had to
    // retrieve for items that don't have remote copy locatoins.
    copyLocationsMap: {[id: number]: IdlObject} = {};

    templateNames: ComboboxEntry[] = [];
    templates: any = {};
    circulate: 'yes' | 'no' = null;
    copyPrice: number = null;
    holdings: OrgSet[] = [];
    fetchingAcpl: boolean;
    useCheckdigit: boolean;
    addNotes: boolean;
    printLabels: boolean;
    note: string;
    anotherNote: string;
    loading = false;
    autoBarcodeInProgress = false;

    editingCircModifier = false;

    // True if any changes have been made.
    changesMade: boolean;
    itemAttrCounts: {[field: string]: {[value: string]: number}} = {};

    @ViewChild('callNumberCbox', {static: false}) callNumberCbox: ComboboxComponent;
    @ViewChild('circModCbox', {static: false}) circModCbox: ComboboxComponent;
    @ViewChild('copyLocCbox', {static: false}) copyLocCbox: ComboboxComponent;
    @ViewChild('copyTemplateCbox', {static: false}) copyTemplateCbox: ComboboxComponent;
    @ViewChild('progressDialog', {static: false}) progressDialog: ProgressDialogComponent;
    @ViewChild('lineitemCbox', {static: false}) lineitemCbox: ComboboxComponent;

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private renderer: Renderer2,
        private idl: IdlService,
        private net: NetService,
        private format: FormatService,
        private org: OrgService,
        private pcrud: PcrudService,
        private store: StoreService,
        private serverStore: ServerStoreService,
        private auth: AuthService,
        private evt: EventService,
        private broadcaster: BroadcastService,
        private holdingSvc: HoldingsService
    ) {}

    ngOnInit() {
        this.route.paramMap.subscribe((params: ParamMap) => {
            const recId = +params.get('recordId');

            if (recId !== this.recordId) {
                this.recordId = recId;
                this.load();
            }
        });

        this.serverStore.getItemBatch([
            'eg.acq.update_items.use_checkdigit',
            'eg.acq.update_items.add_notes',
            'eg.acq.update_items.print_labels',
            'cat.copy.templates'

        ]).then(settings => {
            this.addNotes = settings['eg.acq.update_items.add_notes'] === true;
            this.printLabels = settings['eg.acq.update_items.print_labels'] === true;
            this.useCheckdigit = settings['eg.acq.update_items.use_checkdigit'] === true;
        });
    }

    ngAfterViewInit() {
        const tmpl = this.store.getLocalItem('cat.copy.last_template');
        if (tmpl) {
            this.copyTemplateCbox.selectedId = tmpl;
        }
    }

    savePref(name: string) {
        switch (name) {
            case 'checkdigit':
                this.serverStore.setItem(
                    'eg.acq.update_items.use_checkdigit', this.useCheckdigit);
                break;

            case 'notes':
                this.serverStore.setItem(
                    'eg.acq.update_items.add_notes', this.addNotes);
                break;

            case 'labels':
                this.serverStore.setItem(
                    'eg.acq.update_items.print_labels', this.printLabels);
                break;

        }
    }

    lineitemChanged(entry: ComboboxEntry) {
        if (!entry) { return; }
        this.lineitemId = entry.id;
        this.load();
    }

    reset() {
        this.circulate = null;
        this.copyPrice = null;
        this.holdings = [];
        this.changesMade = false;
    }

    load(): Promise<any> {
        this.reset();

        this.loading = true;

        // Some staff store initials in second_given_name.
        this.note = 'PROC:' +
            (this.auth.user().second_given_name() || ' ') +
            this.format.transform({value: new Date(), datatype: 'timestamp'});

        return this.populateCallNumbers()
        .then(_ => this.fetchCircMods())
        .then(_ => this.fetchCopyLocations())
        .then(_ => this.loadLineitems())
        .then(_ => this.fetchTemplates())
        .then(_ => this.loading = false);
    }

    fetchTemplates(): Promise<any> {

        return this.serverStore.getItem('cat.copy.templates')
        .then(tmpls => {

            if (!tmpls) {
                tmpls = this.store.getLocalItem('cat.copy.templates');
            }

            if (!tmpls) { return Promise.resolve(); }

            this.templates = tmpls;
            this.templateNames = Object.keys(tmpls)
                .sort((n1, n2) => n1 < n2 ? -1 : 1)
                .map(name => ({id: name, label: name}));
        });
    }

    fetchCircMods(): Promise<any> {
        if (this.circModifiers.length > 0) {
            return Promise.resolve();
        }

        const mods = [];
        return this.pcrud.retrieveAll('ccm')
        .pipe(tap((circMod => mods.push(circMod))))
        .toPromise().then(_ => {
            mods.forEach(mod => this.circModMap[mod.code()] = mod);
            this.circModifiers = mods
                .sort((m1, m2) => m1.code() < m2.code() ? -1 : 1)
                .map(mod => ({
                    id: mod.code(),
                    label: mod.code() + ' : ' + mod.name()
                }));
        });
    }

    // KCLS uses the same locations across all branches, so we only
    // need to fetch the locations for the logged in location.
    // If an item has a location from a remote branch, use the
    // matching local version instead.
    fetchCopyLocations(): Promise<any> {
        if (this.localCopyLocations.length > 0) { return Promise.resolve(); }

        const locs = [];
        return this.pcrud.search('acpl', {
            owning_lib: this.org.ancestors(this.auth.user().ws_ou(), true),
            deleted: 'f'
        })
        .pipe(tap((loc => {
            locs.push(loc);
            this.copyLocationsMap[loc.id()] = loc;
        })))
        .toPromise().then(_ => {
            this.localCopyLocations = locs
                .sort((l1, l2) => l1.name() < l2.name() ? -1 : 1)
                .map(mod => ({id: mod.name(), label: mod.name()}));
        });
    }

    // Get the bib call numbers
    populateCallNumbers(): Promise<any> {
        return this.net.request(
            'open-ils.cat',
            'open-ils.cat.biblio.record.marc_cn.retrieve',
            this.recordId
        ).toPromise().then(callNumbers => {

            const entries: ComboboxEntry[] = [];

            callNumbers.forEach(block => {
                const tag = Object.keys(block)[0];
                entries.push({id: block[tag]});
            });

            this.callNumberCbox.entries = entries;

            if (entries.length > 0) {
                this.callNumberCbox.selectedId = entries[0].id;
            }
        });
    }

    loadLineitems(): Promise<any> {

        // No need to refetch the lineitem items when
        // navigating between lineitems.
        if (this.lineitems.length) {
            this.compileLiData();
            return Promise.resolve();
        }

        return this.net.request(
            'open-ils.acq',
            'open-ils.acq.lineitems_for_bib.by_bib_id',
            this.auth.token(), this.recordId, {
                flesh_po: true,
                flesh_li_details: true,
                flesh_notes: true,
                flesh_li_details_copy: true,
                lineitem_state: ['on-order', 'received']
            }
        ).pipe(tap(li => {

            this.lineitems.push(li);

        })).toPromise().then(_ => {

            // Sort newest lineitems to the top.
            this.lineitems = this.lineitems.sort(
                (a, b) => a.create_time() > b.create_time() ? -1 : 1);

            this.compileLiData();
        });
    }

    compileLiData() {
        if (this.lineitems.length === 0) { return; }

        // Default to the newest lineitem
        if (!this.lineitemId) {
            this.lineitemId = this.lineitems[0].id();
        }

        this.lineitemCbox.selectedId = this.lineitemId;

        // Sort the items linked to the currently displayed lineitem.
        this.lineitem =
            this.lineitems.filter(li => li.id() === this.lineitemId)[0];

        // Sort the notes
        this.lineitem.lineitem_notes(
            this.lineitem.lineitem_notes().sort((n1, n2) =>
                n1.create_time() > n2.create_time() ? -1 : 1));

        this.lineitem.lineitem_details()
            .forEach(item => this.addItemToHoldings(item));

        // Sort orgs by short name
        this.holdings = this.holdings.sort(
            (o1, o2) => o1.org.shortname() < o2.org.shortname() ? -1 : 1);

        this.holdings.forEach(orgSet => {
            // Sort volumes by label
            orgSet.volumes.sort((v1, v2) =>
                v1.volume.label() < v2.volume.label() ? -1 : 1);

            orgSet.volumes.forEach(vol => {
                // Sort items by barcode
                vol.items = vol.items.sort(
                    (i1, i2) => i1.barcode() < i2.barcode() ? -1 : 1);
            });
        });

        this.compileAttrCounts();
    }

    addItemToHoldings(item: IdlObject) {
        const copy = item.eg_copy_id();
        const org = this.org.get(copy.call_number().owning_lib());

        let orgSet: OrgSet =
            this.holdings.filter(o => o.org.id() === org.id())[0];

        if (!orgSet) {
            orgSet = {org: org, volumes: []};
            this.holdings.push(orgSet);
        }

        const vol = copy.call_number();

        let volume: VolSet = orgSet.volumes.filter(
            v => v.volume.label() === vol.label())[0];

        if (!volume) {
            volume = {volume: vol, items: []};
            orgSet.volumes.push(volume);
        }

        volume.items.push(copy);
    }

    compileAttrCounts() {
        this.itemAttrCounts = {
            circ_modifier: {},
            location: {},
            circulate: {},
            price: {}
        };

        const neededLocations: number[] = [];
        this.copyList().forEach(copy => {

            ['circ_modifier', 'location', 'circulate', 'price']
            .forEach(attr => {
                let value = copy[attr]();

                if (attr === 'circ_modifier') {
                    const mod = this.circModMap[value];
                    value = mod.code() + ' : ' + mod.name();
                }

                if (attr === 'location') {
                    if (this.copyLocationsMap[value]) {
                        value = this.copyLocationsMap[value].name();

                    } else {
                        // We dont' have this copy location handy.
                        // Fetch it later and update the attr counts.
                        neededLocations.push(value);
                        return;
                    }
                }

                if (this.itemAttrCounts[attr][value]) {
                    this.itemAttrCounts[attr][value]++;
                } else {
                    this.itemAttrCounts[attr][value] = 1;
                }
            });
        });

        if (neededLocations.length > 0) {
            // We need to fetch some copy locations that are not available
            // in our collection of "here" locations.  Note this should
            // only happen once per lineitem render.
            this.fetchOtherCopyLocations(neededLocations);
        }
    }

    fetchOtherCopyLocations(ids: number[]): Promise<any> {
        return this.pcrud.search('acpl', {id: ids})
        .pipe(tap(loc => this.copyLocationsMap[loc.id()] = loc)).toPromise()
        .then(_ => {

            // Rebuild the location counts with the additional locations

            this.itemAttrCounts.location = {};
            this.copyList().forEach(copy => {
                const value = this.copyLocationsMap[copy.location()].name();
                if (this.itemAttrCounts.location[value]) {
                    this.itemAttrCounts.location[value]++;
                } else {
                    this.itemAttrCounts.location[value] = 1;
                }
            });
        });
    }

    // Returns an array of copies sorted by org unit and volume.
    copyList(): IdlObject[] {
        let copies = [];

        this.holdings.forEach(orgSet => {
            orgSet.volumes.forEach(volSet =>
                copies = copies.concat(volSet.items)
            );
        });

        return copies;
    }

    barcodeChanged(copy: IdlObject, barcode: string) {
        barcode = (barcode || '').trim();
        copy.barcode(barcode);
        copy.ischanged(true);
        this.changesMade = true;
        copy._dupe_barcode = false;

        if (barcode && !this.autoBarcodeInProgress) {
            // Manual barcode entry requires dupe check

            copy._dupe_barcode = false;
            this.pcrud.search('acp', {
                deleted: 'f',
                barcode: barcode,
                id: {'!=': copy.id()}
            }).subscribe(resp => {
                if (resp) { copy._dupe_barcode = true; }
            });
        }
    }

    callNumberChanged(volume: IdlObject, label: string) {
        volume.label(label);
        volume.ischanged(true);
        this.changesMade = true;
    }

    applyCallNumber() {
        const entry = this.callNumberCbox.selected;
        if (!entry) { return; }

        const newLabel = entry.id || entry.label;

        this.holdings.forEach(orgSet => {
            orgSet.volumes.forEach(volSet => {

                const volume = volSet.volume;

                if (volume.label() !== newLabel) {
                    volume.label(newLabel);
                    volume.ischanged(true);
                    this.changesMade = true;
                }
            });
        });

        // Focus the first barcode after a batch action
        const lastCopy = this.copyList().reverse()[0];
        this.focusNextBarcode(lastCopy.id());
    }

    changeCopyField(name: string, value: any) {
        this.copyList().forEach(copy => {
            if (copy[name] && copy[name]() !== value) {
                copy[name](value);
                copy.ischanged(true);
                this.changesMade = true;
            }
        });

        this.compileAttrCounts();
    }

    circModChanged(entry: ComboboxEntry) {
        if (entry) {
            this.changeCopyField('circ_modifier', entry.id);
        }
    }

    copyLocationChanged(entry: ComboboxEntry) {
        if (!entry) { return; }

        const locName = entry.id;
        this.changeCopyField('location', this.mapCopyLocationToId(locName));
    }

    // Map a location name to an ID.  When multiples exist with the same
    // name, map to a local location if possible, otherwise just pick one.
    // Generally, a local location with the selected name will always exist.
    mapCopyLocationToId(name: string): IdlObject {

        const locs = [];
        Object.keys(this.copyLocationsMap).forEach(id => {
            const loc1 = this.copyLocationsMap[id];
            if (loc1.name() === name) {
                locs.push(loc1);
            }
        });

        if (locs.length === 1) {
            return locs[0].id();
        }

        // Multiple locations have the requested name.  Try to use
        // the "here" location for consistency, otherwise just pick
        // one.  The data will be massaged later (via CRON) to keep the
        // location data sane.

        let loc;
        locs.forEach(loc1 => {
            if (loc1.owning_lib() === this.auth.user().ws_ou()) {
                loc = loc1;
            }
        });

        return loc ? loc.id() : locs[0].id();
    }

    circulateChanged() {
        this.changeCopyField(
            'circulate', this.circulate === 'yes' ? 't' : 'f');
    }

    priceChanged() {
        this.changeCopyField('price', this.copyPrice);
    }

    applyTemplate() {
        const entry = this.copyTemplateCbox.selected;
        if (!entry) { return; }

        this.store.setLocalItem('cat.copy.last_template', entry.id);

        const template = this.templates[entry.id];

        Object.keys(template).forEach(field => {
            const value = template[field];

            if (value === null || value === undefined) { return; }

            this.changeCopyField(field, value);
        });

        this.compileAttrCounts();
    }

    focusNextBarcode(id: number) {
        let found = false;
        let nextId: number = null;
        let firstId: number = null;

        // Find the ID of the next item.  If this is the last item,
        // loop back to the first item.
        this.copyList().forEach(copy => {
            if (nextId !== null) { return; }

            // In case we have to loop back to the first copy.
            if (firstId === null) { firstId = copy.id(); }

            if (found) {
                if (nextId === null) {
                    nextId = copy.id();
                }
            } else if (copy.id() === id) {
                found = true;
            }
        });

        this.renderer.selectRootElement(
            '#barcode-input-' + (nextId || firstId)).focus();
    }

    barcodeCanChange(item: IdlObject): boolean {
        const stat = Number(item.status().id());

        // Only In-Process and ASN-Received items can
        // have their barcode changed.
        return (stat === 5 || stat === 155);

    }

    autogenBarcodes() {

        this.autoBarcodeInProgress = true;

        // Autogen only replaces barcodes for items which are in
        // certain statuses.
        const copies = this.copyList()
        .filter((copy, idx) => {
            // Skip barcodes that cannot be changed, including the
            // seed barcode.
            return this.barcodeCanChange(copy);
        });

        if (copies.length > 1) { // seed barcode will always be present
            this.proceedWithAutogen(copies)
            .then(_ => this.autoBarcodeInProgress = false);
        }
    }

    proceedWithAutogen(copyList: IdlObject[]): Promise<any> {

        const seedBarcode: string = copyList[0].barcode();
        copyList.shift(); // Avoid replacing the seed barcode

        const count = copyList.length;

        return this.net.request('open-ils.cat',
            'open-ils.cat.item.barcode.autogen',
            this.auth.token(), seedBarcode, count, {
                checkdigit: this.useCheckdigit,
                skip_dupes: true
            }
        ).pipe(tap(barcodes => {

            copyList.forEach(item => {
                if (item.barcode() !== barcodes[0]) {
                    item.barcode(barcodes[0]);
                    item.ischanged(true);
                    this.changesMade = true;
                }

                barcodes.shift();
            });
        })).toPromise();
    }

    save(close?: boolean) {

        this.progressDialog.open();

        let volumes = [];

        this.updateHoldings()
        .then(vols => volumes = vols)
        .then(_ => this.createNotes())
        .then(_ => this.openPrintLabels())
        .then(_ => {
            this.progressDialog.close();

            if (close) {
                this.broadcastChanges(volumes);
                setTimeout(() => window.close());
            } else {
                window.location.reload();
            }
        });
    }

    broadcastChanges(volumes: IdlObject[]) {

        const volIds = volumes.map(v => v.id());
        const copyIds = [];

        volumes.forEach(vol =>
            vol.copies().forEach(copy => copyIds.push(copy.id())));

        this.broadcaster.broadcast('eg.holdings.update', {
            copies : copyIds,
            volumes: volIds,
            records: [this.recordId]
        });
    }

    updateHoldings(): Promise<any> {

        // Volume update API wants volumes fleshed with copies, instead
        // of the other way around, which is what we have here.
        const volumes: IdlObject[] = [];

        this.holdings.forEach(orgSet => {
            orgSet.volumes.forEach(volSet => {

                const newVol = this.idl.clone(volSet.volume);
                const copies: IdlObject[] = [];

                volSet.items.forEach(copy => {

                    // Make sure the copy is updated to point to the
                    // new call number if a label change results in
                    // a new call number being created.
                    if (newVol.ischanged()) { copy.ischanged(true); }

                    if (copy.ischanged()) {
                        const newCopy = this.idl.clone(copy);
                        // de-flesh
                        newCopy.call_number(copy.call_number().id());
                        copies.push(newCopy);
                    }
                });

                newVol.copies(copies);

                if (newVol.ischanged() || copies.length > 0) {
                    volumes.push(newVol);
                }
            });
        });

        if (volumes.length === 0) { return Promise.resolve([]); }

        return this.net.request('open-ils.cat',
            'open-ils.cat.asset.volume.fleshed.batch.update.override',
            this.auth.token(), volumes
        ).toPromise().then(resp => {

            const evt = this.evt.parse(resp);

            if (evt) {
                console.error(evt);
                alert(evt);
                return Promise.reject();
            }

            return Promise.resolve(volumes);
        });
    }

    canSave(): boolean {
        let ok = true;

        this.copyList().some(copy => {
            if (copy.barcode() === '' || copy.call_number().label() === '') {
                return ok = false;
            }
        });

        return ok;
    }

    createNotes(): Promise<any> {
        if (!this.addNotes) { return Promise.resolve(); }

        const notes: IdlObject[] = [];

        const note1 = this.idl.create('acqlin');
        note1.isnew(true);
        note1.value(this.note);
        note1.lineitem(this.lineitemId);

        notes.push(note1);

        if (this.anotherNote) {
            const note2 = this.idl.create('acqlin');
            note2.isnew(true);
            note2.value(this.anotherNote);
            note2.lineitem(this.lineitemId);
            notes.push(note2);
        }

        return this.net.request('open-ils.acq',
            'open-ils.acq.lineitem_note.cud.batch',
            this.auth.token(), notes
        ).toPromise().then(resp => {
            if (resp !== 1) {
                console.log('Error creating notes ', resp);
            }
        });
    }

    editItems() {
        const copyIds: number[] = this.copyList().map(c => c.id());
        this.holdingSvc.spawnAddHoldingsUi(this.recordId, null, null, copyIds);
    }

    openPrintLabels(): Promise<any> {
        if (!this.printLabels) { return Promise.resolve(); }

        const copyIds: number[] = this.copyList().map(c => c.id());

        return this.net.request(
            'open-ils.actor',
            'open-ils.actor.anon_cache.set_value',
            null, 'print-labels-these-copies', {copies : copyIds}

        ).toPromise().then(key => {

            const url = '/eg/staff/cat/printlabels/' + key;
            setTimeout(() => window.open(url, '_blank'));
        });
    }
}

