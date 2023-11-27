import {Component, Input, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {StoreService} from '@eg/core/store.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {AuthService} from '@eg/core/auth.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {EventService} from '@eg/core/event.service';
import {PatronService} from '@eg/staff/share/patron/patron.service';
import {ComboboxComponent, ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {HoldingsService} from '@eg/staff/share/holdings/holdings.service';


const STUB_MARC = `
<record
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.loc.gov/MARC21/slim http://www.loc.gov/standards/marcxml/schema/MARC21slim.xsd"
    xmlns="http://www.loc.gov/MARC21/slim">
  <leader>00620cam a2200205Ka 4500</leader>
  <controlfield tag="008">070101s                            eng d</controlfield>
  <datafield tag="245" ind1=" " ind2=" ">
    <subfield code="a"></subfield>
  </datafield>
</record>
`;

@Component({
  templateUrl: 'track.component.html'
})

export class TrackIllComponent implements OnInit {
    title = 'ILL TITLE - ';
    callnumber = '';
    itemBarcode = '';
    patronBarcode = '';
    creating = false;
    lenderAddress = '';

    noPatron = '';
    marcDoc: XMLDocument;
    newRecordId: number;
    copyTemplates: any = {};
    copyTemplateNames: ComboboxEntry[] = [];

    @ViewChild('copyTemplateCbox') private copyTemplateCbox: ComboboxComponent;

    constructor(
        private router: Router,
        private store: StoreService,
        private serverStore: ServerStoreService,
        private idl: IdlService,
        private pcrud: PcrudService,
        private auth: AuthService,
        private net: NetService,
        private evt: EventService,
        private holdings: HoldingsService,
        private patrons: PatronService
    ) { }

    ngOnInit() {
        this.marcDoc = new DOMParser().parseFromString(STUB_MARC, "text/xml");

        this.serverStore.getItem('cat.copy.templates')
        .then(templates => {
            this.copyTemplates = templates || {};
            this.copyTemplateNames = Object.keys(this.copyTemplates)
                .sort((n1, n2) => n1 < n2 ? -1 : 1)
                .map(name => ({id: name, label: name}));

            let prevTemplate = this.store.getLocalItem('cat.copy.last_ill_template');
            this.copyTemplateCbox.selectedId = prevTemplate;
        });

        setTimeout(() => {
            let node = document.getElementById('title-input');
            if (node) { node.focus(); }
        })
    }

    patronBarcodePasted(evt: any) {
        // setTimeout() here forces Angular to re-check the disabled
        // state of the submit button.  Without this, the submit button
        // may sit disabled until the user tabs out / clicks away,
        // which is kind of annoying.
        setTimeout(() => {
            console.debug('patron barcode pasted');
        });
    }

    // Aggressively clear the no-barcode warning on any change.
    patronBarcodeChange(evt?: any) {
        let bc = '';
        if (evt) {
            bc = evt.target.value;
        } else {
            bc = this.patronBarcode;
        }
        if (!bc || bc != this.noPatron) {
            setTimeout(() => this.noPatron = '');
        }
    }

    canCreate(): boolean {
        return (
            !this.noPatron
            && !this.creating
            && document.querySelector('.ng-invalid') == null
        );
    }

    create(): Promise<any> {
        this.creating = true;
        this.noPatron = '';
        this.newRecordId = null;

        return this.verifyPatron()
        .then(_ => this.createBibRecord())
        .then(_ => this.createItem())
        .catch(_ => this.creating = false);
    }

    createItem(): Promise<any> {

        let vol = this.holdings.createStubVol(this.newRecordId, this.auth.user().ws_ou());
        vol.id(-1);
        vol.label(this.callnumber);

        let copy = this.holdings.createStubCopy(vol);
        copy.id(-1);
        copy.barcode(this.itemBarcode);

        this.applyCopyTemplate(copy);

        // API wants vols fleshed with copies
        vol.copies().push(copy);

        return this.net.request(
            'open-ils.cat',
            'open-ils.cat.asset.volume.fleshed.batch.update',
            this.auth.token(), [vol], null, {return_copy_ids: true})
        .toPromise()
        .then(copyIds => {
            let evt = this.evt.parse(copyIds);
            if (evt) {
                alert(evt);
                return Promise.reject(evt);
            }
            return copyIds[0];
        })
        .then(copyId => {
            console.debug('Created ILL item ', copyId);

            // TODO This is hacky.  Create an asset.lender_address
            // table for tracking these.  Revisit me.

            const note = this.idl.create('acpn');
            note.owning_copy(copyId);
            note.creator(this.auth.user().id());
            note.title('ILL Lender Address');
            note.value(this.lenderAddress);

            return this.pcrud.create(note).toPromise();
        })
        .then(_ => {
            return this.router.navigate(
                ['staff', 'catalog', 'hold', 'T'],
                {queryParams: {
                    target: this.newRecordId,
                    holdForBarcode: this.patronBarcode
                }}
            );
        });
    }

    // NOTE this implements only a subset of the copy template logic
    // from the volcopy interface.  Copy-level fields only.
    applyCopyTemplate(copy) {
        const templateName = this.copyTemplateCbox.selectedId;
        const template = this.copyTemplates[templateName];

        if (template) {
            this.store.setLocalItem('cat.copy.last_ill_template', templateName);
        } else {
            this.store.removeLocalItem('cat.copy.last_ill_template');
            return;
        }

        console.debug("Applying copy template", templateName);

        Object.keys(template).forEach(field => {
            let value = template[field];
            if (value === null || value === undefined) { return; }

            if (field === 'circ_modifier') {
                // KCLS circ modifiers have numeric codes, which sometimes
                // come across as numbers.  We want strings;
                value = '' + value;
            }

            // Since this is a minimal copy template implementation,
            // enforce some sanity checks.
            if (field === 'statcats' || field === 'copy_alerts') {
                return;
            }
            if (typeof copy[field] !== 'function') {
                return;
            }

            copy[field](value);
        });
    }

    /// Returns the bib record ID on success
    createBibRecord(): Promise<IdlObject> {

        // Insert the title string into the MARC XML document.
        this.marcDoc.querySelector('[code=a]').textContent = this.title;

        const marcXml = new XMLSerializer().serializeToString(this.marcDoc.documentElement);

        return this.net.request(
            "open-ils.cat",
            "open-ils.cat.biblio.record.xml.create",
            this.auth.token(), marcXml).toPromise()
        .then(record => {

            let evt = this.evt.parse(record);
            if (evt) {
                alert(evt);
                return Promise.reject(evt);
            }

            this.newRecordId = record.id();
            console.debug("Created new record", this.newRecordId);

            return record;
        });
    }

    verifyPatron(): Promise<any> {
        return this.patrons.getByBarcode(this.patronBarcode)
        .then(patron => {
            if (!patron) {
                this.noPatron = this.patronBarcode;
                let input = document.getElementById('patron-barcode-input') as HTMLInputElement;
                input.select();
                return Promise.reject();
            }
        });
    }
}

