import {Component, OnInit, OnDestroy} from '@angular/core';
import {ActivatedRoute, ParamMap} from '@angular/router';
import {Subscription} from 'rxjs';
import {CatalogService} from '@eg/share/catalog/catalog.service';
import {CatalogUrlService} from '@eg/share/catalog/catalog-url.service';
import {CatalogSearchContext, CatalogSearchState} from '@eg/share/catalog/search-context';
import {StaffCatalogService} from '../catalog.service';
import {ServerStoreService} from '@eg/core/server-store.service';

@Component({
  selector: 'eg-catalog-browse-results',
  templateUrl: 'results.component.html',
  styleUrls: ['results.component.css']
})
export class BrowseResultsComponent implements OnInit, OnDestroy {

    searchContext: CatalogSearchContext;
    results: any[];
    routeSub: Subscription;
    defaultRecordSort: string;

    constructor(
        private route: ActivatedRoute,
        private store: ServerStoreService,
        private cat: CatalogService,
        private catUrl: CatalogUrlService,
        private staffCat: StaffCatalogService
    ) {}

    ngOnInit() {
        this.searchContext = this.staffCat.searchContext;
        this.routeSub = this.route.queryParamMap.subscribe(
            (params: ParamMap) => this.browseByUrl(params)
        );

        this.store.getItem('eg.search.browse_sort_default')
        .then(val => this.defaultRecordSort = val);
    }

    ngOnDestroy() {
        this.routeSub.unsubscribe();
    }

    browseByUrl(params: ParamMap): void {
        this.catUrl.applyUrlParams(this.searchContext, params);
        const bs = this.searchContext.browseSearch;

        // SearchContext applies a default fieldClass value of 'keyword'.
        // Replace with 'title', since there is no 'keyword' browse.
        if (bs.fieldClass === 'keyword') {
            bs.fieldClass = 'title';
        }

        if (bs.isSearchable()) {
            this.results = [];
            this.cat.browse(this.searchContext)
                .subscribe(result => this.addResult(result));
        }
    }

    addResult(result: any) {

        result.compiledHeadings = [];

        // Avoid dupe headings per see
        const seen: any = {};

        result.sees.forEach(sees => {
            if (!sees.control_set) { return; }

            sees.headings.forEach(headingStruct => {
                const fieldId = Object.keys(headingStruct)[0];
                const heading = headingStruct[fieldId][0];

                const inList = result.list_authorities.filter(
                    id => Number(id) === Number(heading.target))[0];

                if (   heading.target
                    && heading.main_entry
                    && heading.target_count
                    && !inList
                    && !seen[heading.target]) {

                    seen[heading.target] = true;

                    heading.seeNotes = sees.notes;

                    result.compiledHeadings.push(heading);
                }
            });
        });

        result.authorities.forEach(auth => {
            if (auth.notes && auth.notes.length) {
                result.authNotes = auth.notes;
            }
        });

        this.results.push(result);
    }

    browseIsDone(): boolean {
        return this.searchContext.searchState === CatalogSearchState.COMPLETE;
    }

    browseIsActive(): boolean {
        return this.searchContext.searchState === CatalogSearchState.SEARCHING;
    }

    browseHasResults(): boolean {
        return this.browseIsDone() && this.results.length > 0;
    }

    prevPage() {
        const firstResult = this.results[0];
        if (firstResult) {
            this.searchContext.browseSearch.pivot = firstResult.pivot_point;
            this.staffCat.browse();
        }
    }

    nextPage() {
        const lastResult = this.results[this.results.length - 1];
        if (lastResult) {
            this.searchContext.browseSearch.pivot = lastResult.pivot_point;
            this.staffCat.browse();
        }
    }

    searchByBrowseEntryParams(result) {
        const ctx = this.searchContext.clone();
        ctx.termSearch.hasBrowseEntry = result.browse_entry + ',' + result.fields;
        if (this.defaultRecordSort) {
            ctx.sort = this.defaultRecordSort;
        }
        return this.catUrl.toUrlParams(ctx);
    }

    // NOTE: to test unauthorized heading display in concerto
    // browse for author = kab
    newBrowseFromHeadingParams(heading) {
        const ctx = this.searchContext.clone();
        ctx.browseSearch.value = heading.heading;
        return this.catUrl.toUrlParams(ctx);
    }
}


