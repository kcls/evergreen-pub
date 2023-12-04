import {Component, OnInit, Input, Output, EventEmitter} from '@angular/core';
import {OrgService} from '@eg/core/org.service';
import {IdlObject} from '@eg/core/idl.service';

/** Manual Org Unit Selector
 */

@Component({
  selector: 'eg-org-select-manual',
  templateUrl: './org-select-manual.component.html',
})
export class OrgSelectManualComponent implements OnInit {
    static domIdGen = 0;

    value = ''; // org unit shortname

    @Input() domId = 'org-select-manual-' + OrgSelectManualComponent.domIdGen++;
    @Input() required = false;
    @Input() disabled = false
    @Input() placeholder = '';

    @Input() set applyOrgId(id: number) {
        // Ignore null values since a bogus org unit shortname may
        // be entered, resulting in a null value for the user of
        // the selector, however that doesn't mean we want to clear
        // the text value entered by the user.
        if (id === null || id === undefined) { return; }

        const org = this.org.list().filter(o => o.id() === Number(id))[0];
        if (org) { this.value = org.shortname(); }
    }

    @Output() valueChange = new EventEmitter<IdlObject>();

    // Emitted when (keyup.enter) is fired on the input.
    @Output() keyUpEnter: EventEmitter<void> = new EventEmitter<void>();

    constructor(private org: OrgService) { }

    ngOnInit() {
    }

    clear() {
        this.value = null;
    }

    changed(value: string) {
        if (this.value) { this.value = this.value.toUpperCase(); };
        this.valueChange.emit(this.getSelectedOrg());
    }

    getSelectedOrg(): IdlObject {
        return this.org.list().filter(o => o.shortname() === this.value)[0] || null;
    }

    isValid(): boolean {
        if (this.getSelectedOrg()) { return true; }
        if (this.required) { return false; }    // empty, but required
        if (this.value) { return false; }       // non-empty and bogus
        return true;                            // empty, but OK
    }
}

