import {Component, OnInit, AfterViewInit, ViewChild, Input, Output, EventEmitter} from '@angular/core';
import {tap} from 'rxjs/operators';
import {Pager} from '@eg/share/util/pager';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {LineitemService, COPY_ORDER_DISPOSITION, BatchUpdateChanges} from './lineitem.service';
import {ComboboxComponent, ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {ItemLocationService} from '@eg/share/item-location-select/item-location-select.service';
import {ItemLocationSelectComponent} from '@eg/share/item-location-select/item-location-select.component';
import {OrgSelectManualComponent} from '@eg/share/org-select-manual/org-select-manual.component';

@Component({
  templateUrl: 'copy-attrs.component.html',
  selector: 'eg-lineitem-copy-attrs'
})
export class LineitemCopyAttrsComponent implements OnInit {

    @Input() lineitem: IdlObject;
    // The batch variation will not have a row index, but we
    // want a value so its use in the domId will be defined.
    @Input() rowIndex = -1;
    @Input() batchAdd = false;
    @Input() gatherParamsOnly = false;

    @Input() resetOnSubmit = false;

    @Input() hideCollectionCode = false;
    @Input() hideCallNumber = false;

    @Input() isGlobal = false;

    batchCopyCount = '';

    distribFormulas: ComboboxEntry[];

    @ViewChild('distribFormCbox') private distribFormCbox: ComboboxComponent;


    callNumberEntries: ComboboxEntry[] = [];
    _callNumberOptions = [];
    @Input() set callNumberOptions(list: string[]) {
        if (list) {
            this._callNumberOptions = list;
            this.callNumberEntries = list.map(v => ({id: v, label: v}));
        } else {
            this._callNumberOptions = [];
            this.callNumberEntries = [];
        }
    }

    get callNumberOptions(): string[] {
        return this._callNumberOptions;
    }

    @Output() templateCopy = new EventEmitter<IdlObject>();

    fundEntries: ComboboxEntry[];
    circModEntries: ComboboxEntry[];

    private _copy: IdlObject;
    @Input() set copy(c: IdlObject) { // acqlid
        if (c === undefined) {
            return;
        } else if (c === null) {
            this._copy = null;
        } else {
            // Enture cbox entries are populated before the copy is
            // applied so the cbox has the minimal set of values it
            // needs at copy render time.
            this.setInitialOptions(c);
            this._copy = c;
        }
    }

    get copy(): IdlObject {
        return this._copy;
    }

    // A row of batch edit inputs
    @Input() batchMode = false;

    // One of several rows embedded in the main LI list page.
    // Always read-only.
    @Input() embedded = false;

    // Emits an 'acqlid' object;
    @Output() batchApplyAltRequested: EventEmitter<BatchUpdateChanges> = new EventEmitter<BatchUpdateChanges>();
    @Output() batchApplyRequested: EventEmitter<IdlObject> = new EventEmitter<IdlObject>();
    @Output() deleteRequested: EventEmitter<IdlObject> = new EventEmitter<IdlObject>();
    @Output() receiveRequested: EventEmitter<IdlObject> = new EventEmitter<IdlObject>();
    @Output() unReceiveRequested: EventEmitter<IdlObject> = new EventEmitter<IdlObject>();
    @Output() cancelRequested: EventEmitter<IdlObject> = new EventEmitter<IdlObject>();

    @ViewChild('locationSelector') locationSelector: ItemLocationSelectComponent;
    @ViewChild('circModSelector') circModSelector: ComboboxComponent;
    @ViewChild('fundSelector') fundSelector: ComboboxComponent;
    @ViewChild('callNumberSelector') callNumberSelector: ComboboxComponent;
    @ViewChild('owningLibSelect') owningLibSelector: OrgSelectManualComponent;

    constructor(
        private idl: IdlService,
        private net: NetService,
        private auth: AuthService,
        private loc: ItemLocationService,
        private liService: LineitemService
    ) {}

    ngOnInit() {

        this.liService.fetchDistributionFormulas()
          .then(formulas => this.distribFormulas = formulas);


        if (this.gatherParamsOnly) {
            this.batchMode = false;
            this.batchAdd = false;
        }

        if (this.batchMode || this.gatherParamsOnly) { // stub batch copy
            this.copy = this.idl.create('acqlid');
            this.copy.isnew(true);
            this.templateCopy.emit(this.copy);

        } else {

            // When a batch selector value changes, duplicate the selected
            // value into our selector entries, so if/when the value is
            // chosen we (and our pile of siblings) are not required to
            // re-fetch them from the server.
            this.liService.batchOptionWanted.subscribe(option => {
                const field = Object.keys(option)[0];
                if (field === 'location') {
                    this.locationSelector.comboBox.addAsyncEntry(option[field]);
                } else if (field === 'circ_modifier') {
                    this.circModSelector.addAsyncEntry(option[field]);
                } else if (field === 'fund') {
                    this.fundSelector.addAsyncEntry(option[field]);
                }
            });
        }
    }

    valueChange(field: string, entry: any) {
        const announce: any = {};
        this.copy.ischanged(true);

        switch (field) {

            case 'cn_label':
            case 'barcode':
            case 'collection_code':
                entry = (entry || '').trim();
                this.copy[field](entry);
                break;

            case 'owning_lib':
                this.copy[field](entry ? entry.id() : null);
                break;

            case 'location':
                this.copy[field](entry ? entry.id() : null);
                if (this.batchMode) {
                    announce[field] = entry;
                    this.liService.batchOptionWanted.emit(announce);
                }
                break;

            case 'circ_modifier':
            case 'fund':
                this.copy[field](entry ? entry.id : null);
                if (this.batchMode) {
                    announce[field] = entry;
                    this.liService.batchOptionWanted.emit(announce);
                }
                break;
        }
    }

    // Tell our inputs about the values we know we need
    // Values will be pre-cached in the liService
    setInitialOptions(copy: IdlObject) {

        if (copy.fund()) {
            const fund = this.liService.fundCache[copy.fund()];
            this.fundEntries = [{id: fund.id(), label: fund.code(), fm: fund}];
        }

        if (copy.circ_modifier()) {
            const mod = this.liService.circModCache[copy.circ_modifier()];
            this.circModEntries = [{id: mod.code(), label: mod.name(), fm: mod}];
        }
    }

    fieldIsDisabled(field: string) {
        if (this.batchMode) { return false; }
        if (this.gatherParamsOnly) { return false; }

        if (this.embedded || // inline expandy view
            this.copy.isdeleted() ||
            this.disposition() !== 'pre-order') {
            return true;
        }

        return false;
    }

    disposition(): COPY_ORDER_DISPOSITION {
        return this.liService.copyDisposition(this.lineitem, this.copy);
    }

    focusNext(field: string, rowIndex: number) {
        let node = document.getElementById(`${field}-${rowIndex + 1}`);
        if (!node) {
            // Loop back around to the top.
            node = document.getElementById(`${field}-1`);
        }
        if (node) { node.focus(); }
    }

    batchUpateClick() {
        this.batchApplyRequested.emit(this.copy);

        this.batchApplyAltRequested.emit({
            copy: this.copy,
            distributionFormula: Number(this.distribFormCbox.selectedId),
            itemCount: Number(this.batchCopyCount),
        });

        if (this.resetOnSubmit) {
            this.copy = this.idl.create('acqlid');
            if (this.locationSelector) {
                this.locationSelector.clear();
            }
            if (this.owningLibSelector) {
                this.owningLibSelector.clear();
            }
            if (this.callNumberSelector) {
                this.callNumberSelector.selected = null;
            }
            if (this.distribFormCbox) {
                this.distribFormCbox.selected = null;
            }
            this.batchCopyCount = '';
        }
    }
}


