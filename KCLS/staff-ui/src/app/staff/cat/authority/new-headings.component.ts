import {Component, OnInit, ViewChild} from '@angular/core';
import {Observable, empty} from 'rxjs';
import {map, switchMap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {Pager} from '@eg/share/util/pager';
import {NetService} from '@eg/core/net.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {OrgService} from '@eg/core/org.service';
import {ComboboxEntry, ComboboxComponent} from '@eg/share/combobox/combobox.component';
import {StringComponent} from '@eg/share/string/string.component';
import {HeadingDetailComponent} from './heading-detail.component';
import {DateSelectComponent} from '@eg/share/date-select/date-select.component';
import {DateUtil} from '@eg/share/util/date';

/* New Headings Report */

// Force a minimum start date for new headings to avoid reporting on
// (practically) all headings, which occurs when the start date preceeds
// or includes the SQL deployment date, which stamps a create_date on
// every heading to NOW().  Such queries cause heavy load and eventually
// time out anyway.
// NOTE: using English dates instead of ISO dates since English
// dates tell Date.parse() to use the local time zone instead of UTC.
const MIN_START_DATE = new Date(Date.parse('December 5, 2016 00:00:00'));

// Grab and cache this many, plus the first entry of the would-be next
// batch to test whether a next batch exists.
const PRE_FETCH_COUNT = 201;

@Component({
  templateUrl: 'new-headings.component.html',
  styles: [
    `.card {border-bottom: 2px dashed grey}`,
    `.tight-card:nth-child(odd) { background-color: rgb(23,162,184,0.2); }`,
    `.tight-card { font-size: 98%; }`,
    `.mattype-list { font-size: 98%; }`,
    `.label { white-space : nowrap; }`,
    `.card-body {font-family: 'Lucida Console', Monaco, monospace; font-size: 94%}`
  ]
})
export class NewHeadingsComponent implements OnInit {

    pager: Pager;
    startDate: Date;
    endDate: Date;
    mattypes: IdlObject[] = [];
    selectedMattypes: any = {};
    loading = false;
    hasLoaded = false; // true after first search
    headings = [];
    usrId: number;
    usrCboxSource: (term: string) => Observable<ComboboxEntry>;
    usrCboxEntries: ComboboxEntry[];
    excludeUsers: ComboboxEntry[] = [];
    exclude001ODN = false;

    @ViewChild('usrCbox') usrCbox: ComboboxComponent;
    @ViewChild('startDateSelect') startDateSelect: DateSelectComponent;
    @ViewChild('endDateSelect') endDateSelect: DateSelectComponent;
    @ViewChild('detailDialog') detailDialog: HeadingDetailComponent;

    constructor(
        private net: NetService,
        private org: OrgService,
        private pcrud: PcrudService
    ) {
        this.pager = new Pager();
        this.pager.limit = 50;
    }


    ngOnInit() {

        this.usrCboxSource = term => {
            if (term.length < 2) { return empty(); }

            const filter: any = {deleted: 'f', active: 't'};
            filter.usrname = {'ilike': `%${term}%`};

            return this.pcrud.search('au', filter, {
                order_by: {au: 'usrname'},
                limit: 50 // Avoid huge lists
            }
            ).pipe(map(user => {
                return {id: user.id(), label: user.usrname()};
            }));
        };

        // seed the report with yesterday's date.
        const d = new Date();
        d.setDate(d.getDate() - 1);
        this.startDate = d;
        this.endDate = new Date(d);

        this.pcrud.search('ccvm',
            {ctype: 'mattype'}, {order_by: {ccvm: 'value'}})
        .subscribe(mt => this.mattypes.push(mt));
    }

    usrChanged(entry: ComboboxEntry) {
        if (entry && entry.id) {
            // TODO avoid double entries
            this.excludeUsers.push(entry);
            this.usrCbox.selectedId = null;
        }
    }

    removeExcludedUser(id: number) {
        let users: ComboboxEntry[] = [];
        this.excludeUsers.forEach(e => {
            if (e.id !== id) {
                users.push(e);
            }
        });
        this.excludeUsers = users;
    }

    openDetailDialog(heading: IdlObject) {

        this.detailDialog.heading = heading;
        this.detailDialog.open({size: 'lg'});
    }

    headingsByAxisForPage(axis: string): IdlObject[] {
        const subset = this.headings.slice(
            this.pager.offset, this.pager.offset + this.pager.limit);

        return subset.filter(heading => heading.browse_axis() === axis);
    }

    getHeadings(isNew?: boolean) {
        this.loading = true;

        if (isNew) {
            this.headings = [];
            this.pager.reset();
        }

        let counter = 0;
        this.pcrud.search('rcbed', this.compileQueryFilter(), {
            limit: PRE_FETCH_COUNT,
            offset: this.pager.offset
        }).subscribe(
            heading => {
                counter++;
                this.headings.push(heading);
            },
            err => {},
            () => {
                this.loading = false;
                this.hasLoaded = true;

                console.debug(`Fetched ${counter} headings`);

                if (counter < PRE_FETCH_COUNT) {
                    this.pager.resultCount = this.headings.length;

                } else {
                    // Drop the final heading since it's the first
                    // heading for the next batch.
                    this.headings.length--;  // neato
                }
            }
        );
    }

    mattypeLabel(code: string): string {
        const mattype = this.mattypes.filter(mt => mt.code() === code)[0];
        if (mattype) { return mattype.value(); }
        return '';
    }

    compileQueryFilter(): any {

        if (!this.startDate || this.startDate < MIN_START_DATE) {
            console.log('Selected start date ' + this.startDate + ' is too early. '
                + 'Using min start date ' + MIN_START_DATE + ' instead');

            // clone the date since it will get clobbered by getYMD.
            this.startDate = MIN_START_DATE;
        }

        const startDate = this.startDateSelect.currentAsYmd();
        let endDate;

        if (this.endDate) {
            // the end date has to be extended by one day, since the between
            // query cuts off at midnight (0 hour) on the end date, which
            // would miss all headings for that date created after hour 0.
            // note: setDate() will rollover to the next month when needed.
            endDate = new Date(this.endDate);
            endDate.setDate(endDate.getDate() + 1);
            endDate = DateUtil.localYmdFromDate(endDate);
        }

        const filter: any = {};

        if (startDate && endDate) {
            // use -and instead of BETWEEN so that endDate is not inclusive.
            filter['-and'] = [
                {heading_date : {'>=' : startDate}},
                {heading_date : {'<' : endDate}}
            ];
        } else if (startDate) {
            filter.heading_date = {'>=' : startDate};
        } else {
            filter.heading_date = {'<' : endDate};
        }

        const matTypes = Object.keys(this.selectedMattypes)
            .filter(m => this.selectedMattypes[m] === true);

        if (matTypes.length > 0) {
            filter.mattype = {'not in': matTypes};
        }

        if (this.excludeUsers.length > 0) {
            filter.bib_editor = {'not in': this.excludeUsers.map(e => e.id)};
        }

        if (this.exclude001ODN) {
            filter.bib_marc_001 = {'!~': '^ODN'};
        }

        return filter;
    }

    prevPage() {
       // Previous pages will always be cached.
       this.pager.decrement();
    }

    nextPage() {
        this.pager.increment();
        if (!this.headings[this.pager.offset] && this.pager.resultCount === null) {
            this.getHeadings();
        }
    }
}


