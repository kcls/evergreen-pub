import {Component, OnInit, Input, ViewChild, HostListener} from '@angular/core';
import {DomSanitizer, SafeResourceUrl} from '@angular/platform-browser';
import {BibRecordService, BibRecordSummary} from '@eg/share/catalog/bib-record.service';
import {CatalogService} from '@eg/share/catalog/catalog.service';
import {StaffCatalogService} from '../catalog.service';
import {BibSummaryComponent} from '@eg/staff/share/bib-summary/bib-summary.component';
import {NgbPanelChangeEvent} from '@ng-bootstrap/ng-bootstrap';
import {ServerStoreService} from '@eg/core/server-store.service';

declare var novSelect;

@Component({
  selector: 'eg-added-content',
  templateUrl: 'added-content.component.html'
})
export class AddedContentComponent implements OnInit {

    _summary: BibRecordSummary;
    @Input() set summary(s: BibRecordSummary) {
        this._summary = s;
        if (s) { this.setValues(); }
    }

    get summary(): BibRecordSummary {
        return this._summary;
    }

    isbn: string;
    upc: string;

    summaryUrl: SafeResourceUrl;

    novSelectUsername: string;
    novSelectPassword: string;

    constructor(
        private sanitizer: DomSanitizer,
        private serverStore: ServerStoreService,
        private cat: CatalogService,
        private staffCat: StaffCatalogService
    ) {}

    ngOnInit() {

        this.serverStore.getItem('opac.ac.novelist.username')
        .then(v => this.novSelectUsername = v);

        this.serverStore.getItem('opac.ac.novelist.password')
        .then(v => this.novSelectPassword = v);
    }

    panelChange(evt: NgbPanelChangeEvent) {

        if (evt.panelId === 'similar-items' && this.novSelectUsername) {

            const ident = this.isbn || this.upc;

            let found = false;
            if (ident) {
                setTimeout(() => {
                    novSelect.loadContentForQuery(
                        {   ClientIdentifier: ident,
                            ISBN: this.isbn,
                            version : '2.1'
                        },
                        this.novSelectUsername,
                        this.novSelectPassword,
                        d => {
                            // This only gets called when data successfully loads?
                            found = true;
                            const node = document.getElementById('novelist-loading');
                            if (node) { node.innerHTML = ''; }
                        }
                    );
                });
            }

            setTimeout(() => {
                if (!found) {
                    const node = document.getElementById('novelist-loading');
                    if (node) { node.innerHTML = ''; }
                }
            }, 4000);
        }
    }

    bibSubjects(): string[] {
        if (!this.summary) { return []; }
        return this.summary.display.subject.sort();
    }

    setValues() {

        if (Array.isArray(this.summary.display.isbn)) {
            this.summary.display.isbn.some(val => {
                val = val.replace(/\s+.*/, '');
                if (val) {
                    this.isbn = val.trim();
                    return true;
                }
                return false;
            });
        }

        if (Array.isArray(this.summary.display.upc)) {
            this.summary.display.upc.some(val => {
                val = val.replace(/\s+.*/, '');
                if (val) {
                    this.upc = val.trim();
                    return true;
                }
                return false;
            });
        }

        const url = 'https://syndetics.com/index.aspx?isbn=' +
            `${encodeURIComponent(this.isbn)}/index.html&upc=${encodeURIComponent(this.upc)}&client=kclsp&type=rn12`;

        this.summaryUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    }
}

