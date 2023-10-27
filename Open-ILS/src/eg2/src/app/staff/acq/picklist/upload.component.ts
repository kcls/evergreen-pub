import {Component, AfterViewInit, Input,
    ViewChild, OnDestroy} from '@angular/core';
import {Router} from '@angular/router';
import {tap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {EventService} from '@eg/core/event.service';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';
import {StringComponent} from '@eg/share/string/string.component';
import {ToastService} from '@eg/share/toast/toast.service';
import {ComboboxComponent,
    ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {VandelayImportSelection,
  VANDELAY_UPLOAD_PATH} from '@eg/staff/cat/vandelay/vandelay.service';
import {HttpClient, HttpRequest, HttpEventType} from '@angular/common/http';
import {HttpResponse, HttpErrorResponse} from '@angular/common/http';
import {ProgressInlineComponent} from '@eg/share/dialog/progress-inline.component';
import {AlertDialogComponent} from '@eg/share/dialog/alert.component';
import {ServerStoreService} from '@eg/core/server-store.service';
import {PicklistUploadService} from './upload.service';


const TEMPLATE_SETTING_NAME = 'eg.acq.picklist.upload.templates';

const TEMPLATE_ATTRS = [
    'createPurchaseOrder',
    'activatePurchaseOrder',
    'selectedProvider',
    'orderingAgency',
    'selectedFiscalYear',
    'loadItems',
    'selectedBibSource',
    'selectedMatchSet',
    'mergeOnExact',
    'importNonMatching',
    'mergeOnBestMatch',
    'mergeOnSingleMatch',
    'selectedMergeProfile',
    'selectedFallThruMergeProfile',
    'minQualityRatio'
];

const ORG_SETTINGS = [
    'acq.upload.default.activate_po',
    'acq.upload.default.create_po',
    'acq.upload.default.provider',
    'acq.upload.default.vandelay.import_non_matching',
    'acq.upload.default.vandelay.load_item_for_imported',
    'acq.upload.default.vandelay.low_quality_fall_thru_profile',
    'acq.upload.default.vandelay.match_set',
    'acq.upload.default.vandelay.merge_on_best',
    'acq.upload.default.vandelay.merge_on_exact',
    'acq.upload.default.vandelay.merge_on_single',
    'acq.upload.default.vandelay.merge_profile',
    'acq.upload.default.vandelay.quality_ratio'
];


@Component({
  selector: 'eg-acq-upload',
  templateUrl: './upload.component.html'
})
export class UploadComponent implements AfterViewInit, OnDestroy {

    // mode can be one of
    //  upload:          actually upload and process a MARC order file
    //  getImportParams: gather import parameters to use when creating
    //                   assets for a purchase order; the invoker
    //                   would do the actual asset creation
    @Input() mode = 'upload';

    @Input() customAction: (args: any) => void;
    customActionProcessing = false;

    settings: Object = {};
    recordType: string;
    selectedQueue: ComboboxEntry;


    activeSelectionListId: number;
    activeQueueId: number;
    orderingAgency: number;
    selectedFiscalYear: number;
    selectedSelectionList: ComboboxEntry;
    selectedBibSource: number;
    selectedProvider: number;
    selectedMatchSet: number;
    importDefId: number;
    selectedMergeProfile: number;
    selectedFallThruMergeProfile: number;
    selectedFile: File;
    newPO: number;

    defaultMatchSet: string;

    createPurchaseOrder: boolean;
    activatePurchaseOrder: boolean;
    loadItems: boolean;

    importNonMatching: boolean;
    mergeOnExact: boolean;
    mergeOnSingleMatch: boolean;
    mergeOnBestMatch: boolean;
    minQualityRatio: number;

    isUploading: boolean;
    uploadProcessing: boolean;
    uploadError: boolean;
    uploadErrorCode: string;
    uploadErrorText: string;
    uploadComplete: boolean;

    // Generated by the server
    sessionKey: string;

    selectedTemplate: string;
    formTemplates: {[name: string]: any};
    newTemplateName: string;

    @ViewChild('fileSelector', { static: false }) private fileSelector;
    @ViewChild('uploadProgress', { static: true })
        private uploadProgress: ProgressInlineComponent;

    @ViewChild('formTemplateSelector', { static: true })
        private formTemplateSelector: ComboboxComponent;
    @ViewChild('bibSourceSelector', { static: true })
        private bibSourceSelector: ComboboxComponent;
    @ViewChild('providerSelector', {static: false})
        private providerSelector: ComboboxComponent;
    @ViewChild('fiscalYearSelector', { static: false })
        private fiscalYearSelector: ComboboxComponent;
    @ViewChild('selectionListSelector', { static: true })
        private selectionListSelector: ComboboxComponent;
    @ViewChild('matchSetSelector', { static: true })
        private matchSetSelector: ComboboxComponent;
    @ViewChild('mergeProfileSelector', { static: true })
        private mergeProfileSelector: ComboboxComponent;
    @ViewChild('fallThruMergeProfileSelector', { static: true })
        private fallThruMergeProfileSelector: ComboboxComponent;
    @ViewChild('dupeQueueAlert', { static: true })
        private dupeQueueAlert: AlertDialogComponent;
    @ViewChild('loadMarcOrderTemplateSavedString', { static: false })
        private loadMarcOrderTemplateSavedString: StringComponent;
    @ViewChild('loadMarcOrderTemplateDeletedString', { static: false })
        private loadMarcOrderTemplateDeletedString: StringComponent;
    @ViewChild('loadMarcOrderTemplateSetAsDefaultString', { static: false })
        private loadMarcOrderTemplateSetAsDefaultString: StringComponent;


    constructor(
        private http: HttpClient,
        private router: Router,
        private toast: ToastService,
        private evt: EventService,
        private net: NetService,
        private auth: AuthService,
        private org: OrgService,
        private store: ServerStoreService,
        private vlagent: PicklistUploadService
    ) {
        this.applyDefaults();
        this.applySettings();
    }

    applySettings(): Promise<any> {
        return this.store.getItemBatch(ORG_SETTINGS)
        .then(settings => {
            this.createPurchaseOrder = settings['acq.upload.default.create_po'];
            this.activatePurchaseOrder = settings['acq.upload.default.activate_po'];
            this.selectedProvider = Number(settings['acq.upload.default.provider']);
            this.importNonMatching = settings['acq.upload.default.vandelay.import_non_matching'];
            this.loadItems = settings['acq.upload.default.vandelay.load_item_for_imported'];
            this.selectedFallThruMergeProfile = Number(settings['acq.upload.default.vandelay.low_quality_fall_thru_profile']);
            this.selectedMatchSet = Number(settings['acq.upload.default.vandelay.match_set']);
            this.mergeOnBestMatch = settings['acq.upload.default.vandelay.merge_on_best'];
            this.mergeOnExact = settings['acq.upload.default.vandelay.merge_on_exact'];
            this.mergeOnSingleMatch = settings['acq.upload.default.vandelay.merge_on_single'];
            this.selectedMergeProfile = Number(settings['acq.upload.default.vandelay.merge_profile']);
            this.minQualityRatio = Number(settings['acq.upload.default.vandelay.quality_ratio']);
        });
    }
    applyDefaults() {
        this.minQualityRatio = 0;
        this.recordType = 'bib';
        this.formTemplates = {};
        if (this.vlagent.importSelection) {

            if (!this.vlagent.importSelection.queue) {
                // Incomplete import selection, clear it.
                this.vlagent.importSelection = null;
                return;
            }

            const queue = this.vlagent.importSelection.queue;
            this.selectedMatchSet = queue.match_set();

        }
    }

    ngAfterViewInit() {
        this.loadStartupData();
    }

    ngOnDestroy() {
        this.clearSelection();
    }

    importSelection(): VandelayImportSelection {
        return this.vlagent.importSelection;
    }

    loadStartupData(): Promise<any> {


        const promises = [
            this.vlagent.getMergeProfiles(),
            this.vlagent.getAllQueues('bib'),
            this.vlagent.getMatchSets('bib'),
            this.vlagent.getBibSources(),
            this.vlagent.getFiscalYears(this.auth.user().ws_ou()).then( years => {
                this.vlagent.getDefaultFiscalYear(this.auth.user().ws_ou()).then(y => {
                    this.selectedFiscalYear = y.id();
                    if (this.fiscalYearSelector) {
                        this.fiscalYearSelector.applyEntryId(this.selectedFiscalYear);
                    }
                });
            }),
            this.vlagent.getSelectionLists(),
            this.vlagent.getItemImportDefs(),
            this.org.settings(['vandelay.default_match_set']).then(
                s => this.defaultMatchSet = s['vandelay.default_match_set']),
            this.loadTemplates()
        ];

        return Promise.all(promises);
    }


    orgOnChange(org: IdlObject) {
        this.orderingAgency = org.id();
        this.vlagent.getFiscalYears(this.orderingAgency).then( years => {
            this.vlagent.getDefaultFiscalYear(this.orderingAgency).then(
                y => { this.selectedFiscalYear = y.id(); this.fiscalYearSelector.applyEntryId(this.selectedFiscalYear); }
            );
        });
    }

    loadTemplates() {
        this.store.getItem(TEMPLATE_SETTING_NAME).then(
            templates => {
                this.formTemplates = templates || {};

                Object.keys(this.formTemplates).forEach(name => {
                    if (this.formTemplates[name].default) {
                        this.selectedTemplate = name;
                    }
                });
            }
        );
    }

    formatTemplateEntries(): ComboboxEntry[] {
        const entries = [];

        Object.keys(this.formTemplates || {}).forEach(
            name => entries.push({id: name, label: name}));

        return entries;
    }

    formatEntries(etype: string): ComboboxEntry[] {
        const rtype = this.recordType;
        let list;

        switch (etype) {
            case 'bibSources':
                return (this.vlagent.bibSources || []).map(
                    s => {
                        return {id: s.id(), label: s.source()};
                    });

            case 'fiscalYears':
                return (this.vlagent.fiscalYears || []).map(
                    fy => {
                        return {id: fy.id(), label: fy.year()};
                       });
                break;

            case 'selectionLists':
                 list = this.vlagent.selectionLists;
                 break;

            case 'activeQueues':
                list = (this.vlagent.allQueues[rtype] || []);
                break;

            case 'matchSets':
                list = this.vlagent.matchSets['bib'];
                break;


            case 'importItemDefs':
                list = this.vlagent.importItemAttrDefs;
                break;

            case 'mergeProfiles':
                list = this.vlagent.mergeProfiles;
                break;
        }

        return (list || []).map(item => {
            return {id: item.id(), label: item.name()};
        });
    }

    selectEntry($event: ComboboxEntry, etype: string) {
        const id = $event ? $event.id : null;

        switch (etype) {
            case 'recordType':
                this.recordType = id;
                break;

            case 'bibSources':
                this.selectedBibSource = id;
                break;

            case 'fiscalYears':
                this.selectedFiscalYear = id;
                break;

            case 'selectionLists':
                this.selectedSelectionList = id;
                break;

            case 'matchSets':
                this.selectedMatchSet = id;
                break;


            case 'mergeProfiles':
                this.selectedMergeProfile = id;
                break;

            case 'FallThruMergeProfile':
                this.selectedFallThruMergeProfile = id;
                break;
        }
    }

    fileSelected($event) {
       this.selectedFile = $event.target.files[0];
    }

    hasNeededData(): boolean {
        if (this.mode === 'getImportParams') {
            return this.selectedQueue ? true : false;
        }
        return this.selectedQueue &&
        Boolean(this.selectedFile) &&
        Boolean(this.selectedFiscalYear) &&
        Boolean(this.selectedProvider) &&
        Boolean(this.orderingAgency);
    }

    upload() {
        this.sessionKey = null;
        this.isUploading = true;
        this.uploadComplete = false;
        this.resetProgressBars();

        this.resolveSelectionList(),
        this.resolveQueue()
        .then(
            queueId => {
                this.activeQueueId = queueId;
                return this.uploadFile();
            },
            err => Promise.reject('queue create failed')
        ).then(
            ok => this.processUpload(),
            err => Promise.reject('process spool failed')
        ).then(
            ok => {
                this.isUploading = false;
                this.uploadComplete = true;
            },
            err => {
                console.log('file upload failed: ', err);
                this.isUploading = false;
                this.resetProgressBars();

            }
        );
    }

    // helper method to return the year string rather than the FY ID
    // TODO: can remove this once fiscal years are better managed
    _getFiscalYearLabel(): string {
        if (this.selectedFiscalYear) {
            const found =  (this.vlagent.fiscalYears || []).find(x => x.id() === this.selectedFiscalYear);
            return found ? found.year() : '';
        } else {
            return '';
        }
    }

    performCustomAction() {

        const vandelayOptions = {
            match_set: this.selectedMatchSet,
            import_no_match: this.importNonMatching,
            auto_overlay_exact: this.mergeOnExact,
            auto_overlay_best_match: this.mergeOnBestMatch,
            auto_overlay_1match: this.mergeOnSingleMatch,
            merge_profile: this.selectedMergeProfile,
            fall_through_merge_profile: this.selectedFallThruMergeProfile,
            match_quality_ratio: this.minQualityRatio,
            bib_source: this.selectedBibSource,
            create_assets: this.loadItems,
            queue_name: this.selectedQueue.label
        };

        const args = {
            provider: this.selectedProvider,
            ordering_agency: this.orderingAgency,
            create_po: this.createPurchaseOrder,
            activate_po: this.activatePurchaseOrder,
            fiscal_year: this._getFiscalYearLabel(),
            picklist: this.activeSelectionListId,
            vandelay: vandelayOptions
        };

        this.customActionProcessing = true;
        this.customAction(args);
    }

    resetProgressBars() {
        this.uploadProgress.update({value: 0, max: 1});
    }

    resolveQueue(): Promise<number> {

        if (this.selectedQueue.freetext) {
            return this.vlagent.createQueue(
                this.selectedQueue.label,
                this.recordType,
                this.importDefId,
                this.selectedMatchSet,
            ).then(
                id => id,
                err => {
                    const evt = this.evt.parse(err);
                    if (evt) {
                        if (evt.textcode.match(/QUEUE_EXISTS/)) {
                            this.dupeQueueAlert.open();
                        } else {
                            alert(evt); // server error
                        }
                    }

                    return Promise.reject('Queue Create Failed');
                }
            );
        } else {
            return Promise.resolve(this.selectedQueue.id);
        }
    }

    resolveSelectionList(): Promise<any> {
        if (!this.selectedSelectionList) {
            return Promise.resolve();
        }
        if (this.selectedSelectionList.id) {
            this.activeSelectionListId = this.selectedSelectionList.id;
        }
        if (this.selectedSelectionList.freetext) {

            return this.vlagent.createSelectionList(
                this.selectedSelectionList.label,
                this.orderingAgency
            ).then(
                value => this.activeSelectionListId = value
            );
        }
        return Promise.resolve(this.activeSelectionListId);
    }

    uploadFile(): Promise<any> {

        if (this.vlagent.importSelection) {
            return Promise.resolve();
        }

        const formData: FormData = new FormData();

        formData.append('ses', this.auth.token());
        formData.append('marc_upload',
            this.selectedFile, this.selectedFile.name);

        if (this.selectedBibSource) {
            formData.append('bib_source', '' + this.selectedBibSource);
        }

        const req = new HttpRequest('POST', VANDELAY_UPLOAD_PATH, formData,
            {reportProgress: true, responseType: 'text'});

        return this.http.request(req).pipe(tap(
            evt => {
                if (evt.type === HttpEventType.UploadProgress) {
                    this.uploadProgress.update(
                        {value: evt.loaded, max: evt.total});

                } else if (evt instanceof HttpResponse) {
                    this.sessionKey = evt.body as string;
                    console.log(
                        'vlagent file uploaded OK with key ' + this.sessionKey);
                }
            },

            (err: HttpErrorResponse) => {
                console.error(err);
                this.toast.danger(err.error);
            }
        )).toPromise();
    }

    processUpload():  Promise<any> {

        this.uploadProcessing = true;
        this.uploadError = false;

        if (this.vlagent.importSelection) {
            return Promise.resolve();
        }

        const spoolType = this.recordType;

        const vandelayOptions = {
            match_set: this.selectedMatchSet,
            import_no_match: this.importNonMatching,
            auto_overlay_exact: this.mergeOnExact,
            auto_overlay_best_match: this.mergeOnBestMatch,
            auto_overlay_1match: this.mergeOnSingleMatch,
            merge_profile: this.selectedMergeProfile,
            fall_through_merge_profile: this.selectedFallThruMergeProfile,
            match_quality_ratio: this.minQualityRatio,
            bib_source: this.selectedBibSource,
            create_assets: this.loadItems,
            queue_name: this.selectedQueue.label
        };

        const args = {
            provider: this.selectedProvider,
            ordering_agency: this.orderingAgency,
            create_po: this.createPurchaseOrder,
            activate_po: this.activatePurchaseOrder,
            fiscal_year: this._getFiscalYearLabel(),
            picklist: this.activeSelectionListId,
            vandelay: vandelayOptions
        };

        const method = `open-ils.acq.process_upload_records`;

        return new Promise((resolve, reject) => {
            this.net.request(
                'open-ils.acq', method,
                this.auth.token(), this.sessionKey, args
            ).subscribe(
                progress => {
                    const resp = this.evt.parse(progress);
                    console.log(progress);
                    if (resp) {
                        this.uploadError = true;
                        this.uploadErrorCode = resp.textcode;
                        this.uploadErrorText = resp.payload;
                        this.uploadProcessing = false;
                        this.uploadComplete = true;
                        return reject();
                    }
                    if (progress.complete) {
                        this.uploadProcessing = false;
                        this.uploadComplete = true;
                    }
                    if (progress.purchase_order) {this.newPO = progress.purchase_order.id(); }
                }
            );
        });
    }

    clearSelection() {
        this.vlagent.importSelection = null;
        this.activeSelectionListId = null;
    }


    saveTemplate() {

        const template = {};
        TEMPLATE_ATTRS.forEach(key => template[key] = this[key]);

        this.formTemplates[this.selectedTemplate] = template;
        this.store.setItem(TEMPLATE_SETTING_NAME, this.formTemplates).then(x =>
            this.loadMarcOrderTemplateSavedString.current()
                .then(str => this.toast.success(str))
        );
    }

    markTemplateDefault() {

        Object.keys(this.formTemplates).forEach(
            name => delete this.formTemplates[name].default
        );

        this.formTemplates[this.selectedTemplate].default = true;

        this.store.setItem(TEMPLATE_SETTING_NAME, this.formTemplates).then(x =>
            this.loadMarcOrderTemplateSetAsDefaultString.current()
                .then(str => this.toast.success(str))
        );
    }

    templateSelectorChange(entry: ComboboxEntry) {

        if (!entry) {
            this.selectedTemplate = '';
            return;
        }

        this.selectedTemplate = entry.label; // label == name

        if (entry.freetext) {
            return;
        }

        const template = this.formTemplates[entry.id];

        TEMPLATE_ATTRS.forEach(key => this[key] = template[key]);

        this.bibSourceSelector.applyEntryId(this.selectedBibSource);
        this.matchSetSelector.applyEntryId(this.selectedMatchSet);
        if (this.providerSelector) {
            this.providerSelector.selectedId = this.selectedProvider;
        }
        if (this.fiscalYearSelector) {
           this.fiscalYearSelector.applyEntryId(this.selectedFiscalYear);
        }
        this.mergeProfileSelector.applyEntryId(this.selectedMergeProfile);
        this.fallThruMergeProfileSelector.applyEntryId(this.selectedFallThruMergeProfile);
    }

    deleteTemplate() {
        delete this.formTemplates[this.selectedTemplate];
        this.formTemplateSelector.selected = null;
        this.store.setItem(TEMPLATE_SETTING_NAME, this.formTemplates).then(x =>
            this.loadMarcOrderTemplateDeletedString.current()
                .then(str => this.toast.success(str))
        );
    }
}
