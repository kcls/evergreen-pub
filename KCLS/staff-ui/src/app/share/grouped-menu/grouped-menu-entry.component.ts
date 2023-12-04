import {Component, Input, Output, EventEmitter, OnInit, Host} from '@angular/core';
import {GroupedMenuComponent, GroupedMenuEntry} from './grouped-menu.component';

@Component({
  selector: 'eg-grouped-menu-entry',
  template: '<ng-container></ng-container>'
})

export class GroupedMenuEntryComponent implements OnInit {

    @Input() label: string;
    @Input() group: string;
    @Input() disabled: boolean;
    @Input() isSeparator: boolean;
    @Input() newTab: boolean;
    @Input() routerLink: string;
    @Input() href: string;
    @Output() entryClicked: EventEmitter<GroupedMenuEntry> =
        new EventEmitter<GroupedMenuEntry>();

    menu: GroupedMenuComponent;

    constructor(@Host() menu: GroupedMenuComponent) {
        this.menu = menu;
    }

    ngOnInit() {
        const entry = new GroupedMenuEntry();
        entry.label = this.label;
        entry.group = this.group;
        entry.disabled = this.disabled;
        entry.newTab = this.newTab;
        entry.routerLink = this.routerLink;
        entry.href = this.href;
        entry.isSeparator = this.isSeparator;
        entry.entryClicked = this.entryClicked;
        this.menu.menuEntries.push(entry);
    }
}


