import {Component, Input, Output, OnInit, EventEmitter, ViewChild} from '@angular/core';
import {IdlService} from '@eg/core/idl.service';
import {EventService} from '@eg/core/event.service';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {OrgService} from '@eg/core/org.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {StringComponent} from '@eg/share/string/string.component';
import {MarcRecord} from './marcrecord';
import {ComboboxEntry, ComboboxComponent
  } from '@eg/share/combobox/combobox.component';
import {ConfirmDialogComponent} from '@eg/share/dialog/confirm.component';
import {MarcEditContext, MARC_RECORD_TYPE} from './editor-context';
import {NgbNav, NgbNavChangeEvent} from '@ng-bootstrap/ng-bootstrap';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';


export interface MarcSavedEvent {
    marcXml: string;
    bibSource?: number;
    recordId?: number;
}

/**
 * MARC Record editor main interface.
 */

@Component({
  selector: 'eg-marc-editor',
  templateUrl: './editor.component.html'
})

export class MarcEditorComponent implements OnInit {

    editorTab: 'rich' | 'flat';
    sources: ComboboxEntry[];
    context: MarcEditContext;

    catDate: Date; // cat date in selector
    origCatDate: Date; // cat date pulled from bib record

    // True if the save request is in flight
    dataSaving: boolean;

    saveCount = 0;

    // KCLS
    // True if we are changing tabs to the "Front" (enriched) editor
    // after applying changes in the flat text editor.
    inPostSaveTabChange = false;

    @Input() recordType: MARC_RECORD_TYPE = 'biblio';

    _pendingRecordId: number;
    @Input() set recordId(id: number) {
        if (this.record && this.record.id === id) { return; }

        // Avoid fetching the record by ID before OnInit since we may
        // not yet know our recordType.
        if (this.initCalled) {
            this._pendingRecordId = null;
            this.fromId(id);

         } else {
            // fetch later in OnInit
            this._pendingRecordId = id;
         }
    }

    get recordId(): number {
        return this.record ? this.record.id : this._pendingRecordId;
    }

    @Input() set recordXml(xml: string) {
        if (xml) {
            this.fromXml(xml);
        }
    }

    get record(): MarcRecord {
        return this.context.record;
    }

    // Tell us which record source to select by default.
    // Useful for new records and in-place editing from bare XML.
    @Input() recordSource: number;

    // If true, saving records to the database is assumed to
    // happen externally.  IOW, the record editor is just an
    // in-place MARC modification interface.
    @Input() inPlaceMode: boolean;

    // In inPlaceMode, this is emitted in lieu of saving the record
    // in th database.  When inPlaceMode is false, this is emitted after
    // the record is successfully saved.
    @Output() recordSaved: EventEmitter<MarcSavedEvent>;

    @ViewChild('sourceSelector', {static: false}) sourceSelector: ComboboxComponent;
    @ViewChild('confirmDelete', {static: false}) confirmDelete: ConfirmDialogComponent;
    @ViewChild('confirmUndelete', {static: false}) confirmUndelete: ConfirmDialogComponent;
    @ViewChild('cannotDelete', {static: false}) cannotDelete: ConfirmDialogComponent;
    @ViewChild('successMsg', {static: false}) successMsg: StringComponent;
    @ViewChild('failMsg', {static: false}) failMsg: StringComponent;

    fastItemLabel: string;
    fastItemBarcode: string;
    showFastAdd: boolean;
    initCalled = false;

    constructor(
        private evt: EventService,
        private idl: IdlService,
        private net: NetService,
        private auth: AuthService,
        private org: OrgService,
        private pcrud: PcrudService,
        private toast: ToastService,
        private holdings: HoldingsService,
        private store: ServerStoreService
    ) {
        this.sources = [];
        this.recordSaved = new EventEmitter<MarcSavedEvent>();
        this.context = new MarcEditContext();

        this.recordSaved.subscribe(_ => {
            this.dataSaving = false;
            if (this.editorTab === 'flat') {
                this.inPostSaveTabChange = true;
                this.editorTab = 'rich';
            }
        });
    }

    ngOnInit() {

        this.initCalled = true;

        this.context.recordType = this.recordType;

        if (!this.record && this.recordId) {
            this.fromId(this.recordId);
        }

        this.store.getItem('cat.marcedit.flateditor').then(
            useFlat => this.editorTab = useFlat ? 'flat' : 'rich');

        if (this.recordType !== 'biblio') { return; }

        this.pcrud.retrieveAll('cbs').subscribe(
            src => this.sources.push({id: +src.id(), label: src.source()}),
            _ => {},
            () => {
                this.sources = this.sources.sort((a, b) =>
                    a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1
                );

                if (this.recordSource) {
                    this.sourceSelector.applyEntryId(this.recordSource);
                }
            }
        );
    }

    changesPending(): boolean {
        return this.context.changesPending;
    }

    clearPendingChanges() {
        this.context.changesPending = false;
    }

    // Remember the last used tab as the preferred tab.
    tabChange(evt: NgbNavChangeEvent) {

        // Avoid undo persistence across tabs since that could result
        // in changes getting lost.
        this.context.resetUndos();

        // explicit values to make compiler happy
        this.editorTab = evt.nextId === 'flat' ? 'flat' : 'rich';


        if (this.inPostSaveTabChange) {
            // Avoid saving post-save tab changes to settings.
            this.inPostSaveTabChange = false;
            return;
        }

        if (evt.nextId === 'flat') {
            this.store.setItem('cat.marcedit.flateditor', true);
        } else {
            this.store.removeItem('cat.marcedit.flateditor');
        }
    }

    saveRecord(): Promise<any> {
        const xml = this.record.toXml();
        this.dataSaving = true;

        // Save actions clears any pending changes.
        this.context.changesPending = false;
        this.context.resetUndos();

        let sourceName: string = null;
        let sourceId: number = null;

        // We don't just use this.recordSource here because we need
        // to use the name (label) for an API call.  That seems like
        // an API bug...
        if (this.sourceSelector && this.sourceSelector.selected) {
            sourceName = this.sourceSelector.selected.label;
            sourceId = this.sourceSelector.selected.id;
        }

        const emission = {
            marcXml: xml, bibSource: sourceId, recordId: this.recordId};

        if (this.inPlaceMode) {
            // Let the caller have the modified XML and move on.
            this.recordSaved.emit(emission);
            this.saveCount++;
            return Promise.resolve();
        }

        let promise;

        if (this.record.id) { // Editing an existing record

            promise = this.modifyRecord(xml, sourceName, sourceId);

        } else {

            promise = this.createRecord(xml, sourceName);
        }

        // NOTE we do not reinitialize our record with the MARC returned
        // from the server after a create/update, which means our record
        // may be out of sync, e.g. missing 901* values.  It's the
        // callers responsibility to tear us down and rebuild us.
        return promise.then(marcXml => {
            if (!marcXml) { return null; }
            this.saveCount++;
            this.successMsg.current().then(msg => this.toast.success(msg));
            emission.marcXml = marcXml;
            emission.recordId = this.recordId;
            this.recordSaved.emit(emission);
            this.fastAdd();
            return marcXml;
        });
    }

    modifyRecord(marcXml: string, sourceName: string, sourceId: number): Promise<any> {
        const method = this.recordType === 'biblio' ?
            'open-ils.cat.biblio.record.xml.update' :
            'open-ils.cat.authority.record.overlay';

        return this.net.request('open-ils.cat', method,
            this.auth.token(), this.record.id, marcXml, sourceName

        ).toPromise().then(response => {

            const evt = this.evt.parse(response);
            if (evt) {
                console.error(evt);
                this.failMsg.current().then(msg => this.toast.warning(msg));
                this.dataSaving = false;
                return null;
            }

            // authority.record.overlay resturns a '1' on success.
            return typeof response === 'object' ? response.marc() : marcXml;
        });
    }

    createRecord(marcXml: string, sourceName?: string): Promise<any> {

        const method = this.recordType === 'biblio' ?
            'open-ils.cat.biblio.record.xml.create' :
            'open-ils.cat.authority.record.import';

        return this.net.request('open-ils.cat', method,
            this.auth.token(), marcXml, sourceName
        ).toPromise().then(response => {

            const evt = this.evt.parse(response);

            if (evt) {
                console.error(evt);
                this.failMsg.current().then(msg => this.toast.warning(msg));
                this.dataSaving = false;
                return null;
            }

            this.record.id = response.id();
            return response.marc();
        });
    }

    fromId(id: number): Promise<any> {
        const idlClass = this.recordType === 'authority' ? 'are' : 'bre';

        // KCLS JBAS-2640 apply tab preference each time a new record is
        // loaded, e.g. catalog nex/prev navigation.  Beware if we start
        // using fromId() directly after a save, this could clobber the
        // inPostSaveTabChange (jump-to-fron-editor) handling.
        this.store.getItem('cat.marcedit.flateditor').then(
            useFlat => this.editorTab = useFlat ? 'flat' : 'rich');

        return this.pcrud.retrieve(idlClass, id)
        .toPromise().then(rec => {
            this.context.record = new MarcRecord(rec.marc());
            this.record.id = id;
            this.record.deleted = rec.deleted() === 't';

            if (idlClass === 'bre') {
                if (rec.source()) {
                    this.sourceSelector.applyEntryId(+rec.source());
                }

                if (rec.cataloging_date()) {
                    this.catDate = this.origCatDate =
                        new Date(Date.parse(rec.cataloging_date()));
                } else {
                    // Default to now when unset.
                    this.catDate = new Date();
                    this.origCatDate = null;
                }
            }
        });
    }

    updateRecordSource(entry) {
        this.recordSource = entry.id;
    }

    fromXml(xml: string) {
        this.context.record = new MarcRecord(xml);
        this.record.id = null;
    }

    setCatDate(clear?: boolean) {
        this.dataSaving = true;

        let date: string = null;

        if (clear) {
            this.catDate = null;
            if (this.origCatDate === null) {
                this.dataSaving = false;
                return; // nothing to clear
            }
        } else if (this.catDate === null) {
            this.dataSaving = false;
            return; // nothing to set
        } else {
            date = this.catDate.toISOString();
        }

        this.net.request('open-ils.cat',
            'open-ils.cat.biblio.cataloging_date.set',
            this.auth.token(), this.record.id, date
        ).subscribe(
            resp => {
                if (Number(resp) === 1) {
                    if (date) {
                        this.origCatDate = this.catDate;
                    } else {
                        this.origCatDate = null;
                    }

                    if (clear) {
                        // Reset to Now on clear.
                        this.catDate = new Date();
                    }

                } else {
                    console.error('Could not set cat date');
                    const evt = this.evt.parse(resp);
                    if (evt) { alert(evt); }
                }
            },
            () => this.dataSaving = false,
            () => this.dataSaving = false
        );
    }

    deleteRecord(): Promise<any> {

        return this.confirmDelete.open().toPromise()
        .then(yes => {
            if (!yes) { return; }

            let promise;
            if (this.recordType === 'authority') {
                promise = this.deleteAuthorityRecord();
            } else {
                promise = this.deleteBibRecord();
            }

            return promise.then(ok => {
                if (!ok) { return; }

                return this.fromId(this.record.id).then(_ => {
                    this.recordSaved.emit({
                        marcXml: this.record.toXml(),
                        recordId: this.recordId
                    });
                });
            });
        });
    }

    deleteAuthorityRecord(): Promise<boolean> {
        return this.pcrud.retrieve('are', this.record.id).toPromise()
        .then(rec => this.pcrud.remove(rec).toPromise())
        .then(resp => resp !== null);
    }

    deleteBibRecord(): Promise<boolean> {

        return this.net.request('open-ils.cat',
            'open-ils.cat.biblio.record_entry.delete',
            this.auth.token(), this.record.id).toPromise()

        .then(resp => {

            const evt = this.evt.parse(resp);
            if (evt) {
                if (evt.textcode === 'RECORD_NOT_EMPTY') {
                    return this.cannotDelete.open().toPromise()
                    .then(_ => false);
                } else {
                    console.error(evt);
                    alert(evt);
                    return false;
                }
            }

            return true;
        });
    }

    undeleteRecord(): Promise<any> {

        return this.confirmUndelete.open().toPromise()
        .then(yes => {
            if (!yes) { return; }

            let promise;
            if (this.recordType === 'authority') {
                promise = this.undeleteAuthorityRecord();
            } else {
                promise = this.undeleteBibRecord();
            }

            return promise.then(ok => {
                if (!ok) { return; }
                return this.fromId(this.record.id)
                .then(_ => {
                    this.recordSaved.emit({
                        marcXml: this.record.toXml(),
                        recordId: this.recordId
                    });
                });
            });
        });
    }

    undeleteAuthorityRecord(): Promise<any> {
        return this.pcrud.retrieve('are', this.record.id).toPromise()
        .then(rec => {
            rec.deleted('f');
            return this.pcrud.update(rec).toPromise();
        }).then(resp => resp !== null);
    }

    undeleteBibRecord(): Promise<any> {

        return this.net.request('open-ils.cat',
            'open-ils.cat.biblio.record_entry.undelete',
            this.auth.token(), this.record.id).toPromise()

        .then(resp => {

            const evt = this.evt.parse(resp);
            if (evt) {
                console.error(evt);
                alert(evt);
                return false;
            }

            return true;
        });
    }

    // Spawns the copy editor with the requested barcode and
    // call number label.  Called after our record is saved.
    fastAdd() {
        if (this.showFastAdd && this.fastItemLabel && this.fastItemBarcode) {

            const fastItem = {
                label: this.fastItemLabel,
                barcode: this.fastItemBarcode,
                fast_add: true
            };

            this.holdings.spawnAddHoldingsUi(this.recordId, null, [fastItem]);
        }
    }
}

