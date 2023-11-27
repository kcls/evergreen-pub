import {Component, Input, Output, EventEmitter, OnInit, AfterViewInit} from '@angular/core';
import {Router} from '@angular/router';
import {Location} from '@angular/common';

export class GroupedMenuEntry {
    label: string;
    group: string;
    disabled: boolean;
    isSeparator: boolean;
    isGroup: boolean;
    routerLink: string;
    newTab: boolean; // routerLink or href open a new tab
    href: string;
    entryClicked: EventEmitter<GroupedMenuEntry>;
}

@Component({
  selector: 'eg-grouped-menu',
  templateUrl: './grouped-menu.component.html'
})

export class GroupedMenuComponent implements OnInit, AfterViewInit {

    static autoId = 0;

    // Label for dropdown button
    @Input() label: string;

    @Input() domId = 'grouped-menu-' + GroupedMenuComponent.autoId++;

    // https://ng-bootstrap.github.io/#/components/dropdown/api
    @Input() placement = 'bottom-right';

    menuEntries: GroupedMenuEntry[] = [];

    constructor(
        private router: Router,
        private ngLocation: Location
    ) {}

    ngOnInit() {
    }

    ngAfterViewInit() {
        setTimeout(() => this.sortActions());
    }

    sortActions() {
        const actions = this.menuEntries;

        const unGrouped = actions.filter(a => !a.group)
        .sort((a, b) => {
            return a.label < b.label ? -1 : 1;
        });

        const grouped = actions.filter(a => Boolean(a.group))
        .sort((a, b) => {
            if (a.group === b.group) {
                return a.label < b.label ? -1 : 1;
            } else {
                return a.group < b.group ? -1 : 1;
            }
        });

        // Insert group markers for rendering
        const seen: any = {};
        const grouped2: any[] = [];
        grouped.forEach(action => {
            if (!seen[action.group]) {
                seen[action.group] = true;
                const act = new GroupedMenuEntry();
                act.label = action.group;
                act.isGroup = true;
                grouped2.push(act);
            }
            grouped2.push(action);
        });

        this.menuEntries = unGrouped.concat(grouped2);
    }

    performAction(entry: GroupedMenuEntry) {
        if (entry.isGroup || entry.isSeparator) { return; }

        // Always emit, even if no one is listening.
        entry.entryClicked.emit(entry);

        let url;
        if (entry.href) {
            url = entry.href;
        } else if (entry.routerLink) {
            if (entry.newTab) {
                url = this.ngLocation.prepareExternalUrl(entry.routerLink);
            } else {
                this.router.navigate([entry.routerLink]);
                return;
            }
        }

        if (url) {
            if (entry.newTab) {
                window.open(url);
            } else {
                location.href = url;
            }
            return;
        }
    }
}

