import {Component, OnInit, Input, Output, ViewChild, EventEmitter} from '@angular/core';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {ComboboxEntry} from '@eg/share/combobox/combobox.component';
import {HoldsService} from './holds.service';
import {DateUtil} from '@eg/share/util/date';

/** Edit holds in single or batch mode. */

@Component({
  selector: 'eg-hold-manage',
  templateUrl: 'manage.component.html'
})
export class HoldManageComponent implements OnInit {

    // One holds ID means standard edit mode.
    // >1 hold IDs means batch edit mode.
    @Input() holdIds: number[];

    hold: IdlObject;
    smsEnabled: boolean;
    smsCarriers: ComboboxEntry[];
    activeFields: {[key: string]: boolean};
    hasInvalidValues = false;

    // Emits true if changes were applied to the hold.
    @Output() onComplete: EventEmitter<boolean>;

    constructor(
        private idl: IdlService,
        private org: OrgService,
        private pcrud: PcrudService,
        private holds: HoldsService
    ) {
        this.onComplete = new EventEmitter<boolean>();
        this.smsCarriers = [];
        this.holdIds = [];
        this.activeFields = {};
    }

    ngOnInit() {
        this.org.settings('sms.enable').then(sets => {
            this.smsEnabled = sets['sms.enable'];
            if (!this.smsEnabled) { return; }

            this.pcrud.search('csc', {active: 't'}, {order_by: {csc: 'name'}})
            .subscribe(carrier => {
                this.smsCarriers.push({
                    id: carrier.id(),
                    label: carrier.name()
                });
            });
        });

        this.fetchHold();
    }

    fetchHold() {
        this.hold = null;

        if (this.holdIds.length === 0) {
            return;

        } else if (this.isBatch()) {
            // Use a dummy hold to store form values.
            this.hold = this.idl.create('ahr');

            // Set all boolean fields to false on startup so they are
            // not sent to the server as null when saving.
            this.idl.classes.ahr.fields
                .filter(f => f.datatype === 'bool')
                .forEach(f => this.hold[f.name]('f'));

        } else {
            // Form values are stored in the one hold we're editing.
            this.pcrud.retrieve('ahr', this.holdIds[0])
            .subscribe(hold => {
                this.hold = hold;
                setTimeout(() => this.checkInvalidValues());
            });
        }
    }

    isBatch(): boolean {
        return this.holdIds.length > 1;
    }

    pickupLibChanged(org: IdlObject) {
        if (org) {
            this.hold.pickup_lib(org.id());
        }
    }

    checkInvalidValues() {
        this.hasInvalidValues =
            document.querySelector('.eg-date-select-native.ng-invalid') !== null;
    }

    applyDateValue(field: string, ymd: string) {
        this.hold[field](ymd);
        setTimeout(() => this.checkInvalidValues());
    }

    save() {
        if (this.hasInvalidValues) { return; }

        let ymd = this.hold.shelf_expire_time();
        if (ymd && ymd.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // Date locally changed.  Append a time component so we can
            // bump the expire time out to the end of the day.
            const d: Date = DateUtil.localDateFromYmd(ymd);
            d.setHours(23, 59, 59);
            this.hold.shelf_expire_time(d.toISOString());
        }

        if (this.isBatch()) {

            // Fields with edit-active checkboxes
            const fields = Object.keys(this.activeFields)
                .filter(field => this.activeFields[field]);

            const holds: IdlObject[] = [];
            this.pcrud.search('ahr', {id: this.holdIds})
            .subscribe(
                hold => {
                    // Copy form fields to each hold to update.
                    fields.forEach(field => hold[field](this.hold[field]()));

                    // Clear thaw date for active holds.
                    if (hold.frozen() === 'f') { hold.thaw_date(null); }
                    if (!hold.shelf_time()) { hold.shelf_expire_time(null); }
                    holds.push(hold);
                },
                err => {},
                ()  => {
                    this.saveBatch(holds);
                }
            );
        } else {
            // Clear thaw date for active holds.
            if (this.hold.frozen() === 'f') { this.hold.thaw_date(null); }
            this.saveBatch([this.hold]);
        }
    }

    saveBatch(holds: IdlObject[]) {
        let successCount = 0;
        this.holds.updateHolds(holds)
        .subscribe(
            res  => {
                if (Number(res) > 0) {
                    successCount++;
                    console.debug('hold update succeeded with ', res);
                } else {
                    // TODO: toast?
                }
            },
            err => console.error('hold update failed with ', err),
            ()  => {
                if (successCount === holds.length) {
                    this.onComplete.emit(true);
                } else {
                    // TODO: toast?
                    console.error('Some holds failed to update');
                }
            }
        );
    }

    exit() {
        this.onComplete.emit(false);
    }

    setExp(value) {
        this.hold.expire_time(value);
    }
}


