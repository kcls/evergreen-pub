import {Component, OnInit, AfterViewInit, Input, Output, EventEmitter,
  ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {tap} from 'rxjs/operators';
import {Pager} from '@eg/share/util/pager';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {OrgService} from '@eg/core/org.service';
import {NetService} from '@eg/core/net.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {LineitemService, FleshCacheParams} from './lineitem.service';
import {ComboboxEntry, ComboboxComponent} from '@eg/share/combobox/combobox.component';
import {ItemLocationService} from '@eg/share/item-location-select/item-location-select.service';

const FORMULA_FIELDS = [
    'owning_lib',
    'location',
    'fund',
    'circ_modifier',
    'collection_code'
];

interface FormulaApplication {
    formula: IdlObject;
    count: number;
}

@Component({
  templateUrl: 'copies.component.html'
})
export class LineitemCopiesComponent implements OnInit, AfterViewInit {
    static newCopyId = -1;

    lineitemId: number;
    lineitem: IdlObject;
    copyCount = 1;
    batchOwningLib: IdlObject;
    batchFund: ComboboxEntry;
    batchCopyLocId: number;
    saving = false;
    progressMax = 0;
    progressValue = 0;
    formulaFilter = {owner: []};
    formulaOffset = 0;
    formulaValues: {[field: string]: {[val: string]: boolean}} = {};

    // Can any changes be applied?
    liLocked = false;

    distribFormulas: ComboboxEntry[];

    @ViewChild('distribFormCbox') private distribFormCbox: ComboboxComponent;

    constructor(
        private route: ActivatedRoute,
        private idl: IdlService,
        private org: OrgService,
        private net: NetService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private loc: ItemLocationService,
        private liService: LineitemService
    ) {}

    ngOnInit() {
        this.route.paramMap.subscribe((params: ParamMap) => {
            const id = +params.get('lineitemId');
            if (id !== this.lineitemId) {
                this.lineitemId = id;
                if (id) { this.load(); }
            }
        });

        this.liService.getLiAttrDefs();
    }

    fetchFormulas(): Promise<any> {

        return this.pcrud.search('acqdf',
            {owner: this.org.fullPath(this.auth.user().ws_ou(), true)},
            {}, {atomic: true}
        ).toPromise().then(forms => {

            // Sort the distribution formulas numerically first, followed
            // by asciibetically.  E.g. 10A, 10B, 12A, 106A
            const buckets: any = {};
            forms.forEach(df => {
                const match = df.name().match(/(\d+)/);
                const prefix = match ? df.name().match(/(\d+)/)[0] : '-';

                if (!buckets[prefix]) { buckets[prefix] = []; }
                buckets[prefix].push(df);
            });

            let formulas: ComboboxEntry[] = [];
            const keys = Object.keys(buckets)
              .sort((k1, k2) => Number(k1) < Number(k2) ? -1 : 1);

            keys.forEach(key => {
                formulas = formulas.concat(
                    buckets[key]
                      .sort((f1, f2) => f1.name() < f2.name() ? -1 : 1)
                      .map(f => ({id: f.id(), label: f.name()}))
                );
            });

            this.distribFormulas = formulas;
        });
    }

    load(params?: FleshCacheParams): Promise<any> {
        this.lineitem = null;
        this.copyCount = 1;

        if (!params) {
            params = {toCache: true, fromCache: true};
        }

        return this.liService.getFleshedLineitems([this.lineitemId], params)
        .pipe(tap(liStruct => this.lineitem = liStruct.lineitem)).toPromise()
        .then(_ => {
            this.liLocked =
              this.lineitem.state().match(/on-order|received|cancelled/);
        })
        .then(_ => this.fetchFormulas())
        .then(_ => this.applyCount());
    }

    ngAfterViewInit() {
        setTimeout(() => {
            const node = document.getElementById('copy-count-input');
            if (node) { (node as HTMLInputElement).select(); }
        });
    }

    applyCount() {
        const copies = this.lineitem.lineitem_details();
        while (copies.length < this.copyCount) {
            const copy = this.idl.create('acqlid');
            copy.id(LineitemCopiesComponent.newCopyId--);
            copy.isnew(true);
            copy.lineitem(this.lineitem.id());
            copies.push(copy);
        }

        if (copies.length > this.copyCount) {
            this.copyCount = copies.length;
        }
    }

    applyFormula(id: number) {

        const copies = this.lineitem.lineitem_details();
        if (this.formulaOffset >= copies.length) {
            // We have already applied a formula entry to every item.
            return;
        }

        this.formulaValues = {};

        this.pcrud.retrieve('acqdf', id,
            {flesh: 1, flesh_fields: {acqdf: ['entries']}})
        .subscribe(formula => {

            formula.entries(
                formula.entries().sort((e1, e2) =>
                    e1.position() < e2.position() ? -1 : 1));

            let rowIdx = this.formulaOffset - 1;

            while (++rowIdx < copies.length) {
                this.formulateOneCopy(formula, rowIdx, true);
            }

            // No new values will be applied
            if (!Object.keys(this.formulaValues)) { return; }

            this.fetchFormulaValues().then(_ => {

                let applied = 0;
                let rowIdx2 = this.formulaOffset - 1;

                while (++rowIdx2 < copies.length) {
                    applied += this.formulateOneCopy(formula, rowIdx2);
                }

                if (applied) {
                    this.formulaOffset += applied;
                    this.saveAppliedFormula(formula);
                }
            });
        });
    }

    saveAppliedFormula(formula: IdlObject) {
        const app = this.idl.create('acqdfa');
        app.lineitem(this.lineitem.id());
        app.creator(this.auth.user().id());
        app.formula(formula.id());

        this.pcrud.create(app).toPromise().then(a => {
            a.creator(this.auth.user());
            a.formula(formula);
            this.lineitem.distribution_formulas().push(a);
        });
    }

    // Grab values applied by distribution formulas and cache them before
    // applying them to their target copies, so the comboboxes, etc.
    // are not required to go fetch them en masse / en duplicato.
    fetchFormulaValues(): Promise<any> {

        let funds = [];
        if (this.formulaValues.fund) {
            funds = Object.keys(this.formulaValues.fund).map(id => Number(id));
        }

        let locs = [];
        if (this.formulaValues.location) {
            locs = Object.keys(this.formulaValues.location).map(id => Number(id));
        }

        const mods = this.formulaValues.circ_modifier ?
            Object.keys(this.formulaValues.circ_modifier) : [];

        return this.liService.fetchFunds(funds)
            .then(_ => this.liService.fetchLocations(locs))
            .then(_ => this.liService.fetchCircMods(mods));
    }

    // Apply a formula entry to a single copy.
    // extracOnly means we are only collecting the new values we wish to
    // apply from the formula w/o applying them to the copy in question.
    formulateOneCopy(formula: IdlObject,
        rowIdx: number, extractOnly?: boolean): number {

        let targetEntry = null;
        let entryIdx = this.formulaOffset;
        const copy = this.lineitem.lineitem_details()[rowIdx];

        // Find the correct entry for the current copy.
        formula.entries().forEach(entry => {
            if (!targetEntry) {
                entryIdx += entry.item_count();
                if (entryIdx > rowIdx) {
                    targetEntry = entry;
                }
            }
        });

        // We ran out of copies.
        if (!targetEntry) { return 0; }

        FORMULA_FIELDS.forEach(field => {
            const val = targetEntry[field]();
            if (val === undefined || val === null) { return; }

            if (extractOnly) {
                if (!this.formulaValues[field]) {
                    this.formulaValues[field] = {};
                }
                this.formulaValues[field][val] = true;

            } else {
                copy[field](val);
            }
        });

        return 1;
    }

    save() {

        // Ignore double-clicks, etc.
        if (this.saving) { return; }

        this.saving = true;
        this.progressMax = null;
        this.progressValue = 0;

        this.liService.updateLiDetails(this.lineitem).subscribe(
            struct => {
                this.progressMax = struct.total;
                this.progressValue++;
            },
            err => {},
            () => this.load({toCache: true}).then(_ => {
                this.liService.activateStateChange.emit(this.lineitem.id());
                this.saving = false;
            })
        );
    }

    deleteFormula(formula: IdlObject) {
        this.pcrud.remove(formula).subscribe(_ => {
            this.lineitem.distribution_formulas(
                this.lineitem.distribution_formulas()
                .filter(f => f.id() !== formula.id())
            );
        });
    }


    displayAttr(name: string): string {
        const attrs = this.liService.getAttributes(
            this.lineitem, name, 'lineitem_marc_attr_definition');

        if (attrs.length > 0) {
            return attrs[0].attr_value();
        }

        return '';
    }
}


