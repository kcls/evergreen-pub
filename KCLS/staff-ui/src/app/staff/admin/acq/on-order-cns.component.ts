import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {NetService} from '@eg/core/net.service';
import {AuthService} from '@eg/core/auth.service';
import {PermService} from '@eg/core/perm.service';
import {OrgService} from '@eg/core/org.service';
import {EventService} from '@eg/core/event.service';

const SETTING = 'acq.on_order.call_numbers';
const PERM = 'MANAGE_ON_ORDER_CALL_NUMBERS';

@Component({
    templateUrl: './on-order-cns.component.html'
})
export class OnOrderCnsComponent implements OnInit {

    callNumbers: Array<string> = [];
    hasPerm = false;
    selected: any = {};
    newCn = '';

    constructor(
        private net: NetService,
        private org: OrgService,
        private evt: EventService,
        private auth: AuthService,
        private perms: PermService
    ) {}

    ngOnInit() {
        this.load();
    }

    load(): Promise<any> {
        this.selected = {};
        this.callNumbers = [];
        this.newCn = '';

        return this.perms.hasWorkPermHere(PERM).then(perms => {
            this.hasPerm = perms[PERM];

        }).then(_ => {

            // Manage this setting directly via the org setting
            // API so we can bypass any caching, etc. issues.
            return this.net.request(
                'open-ils.actor',
                'open-ils.actor.ou_setting.ancestor_default',
                this.auth.user().ws_ou(),
                SETTING,
                this.auth.token()
            ).toPromise().then(settings => {
                // This is a global setting for KCLS.
                if (settings) {
                    this.callNumbers = settings.value.sort();
                }
            });
        });
    }

    makeUpper() {
        this.newCn = (this.newCn || '').toUpperCase();
    }

    update(): Promise<any> {
        let settings: any = {};
        settings[SETTING] = this.callNumbers;

        return this.net.request(
            'open-ils.actor',
            'open-ils.actor.org_unit.settings.update',
            this.auth.token(),
            this.org.root().id(),
            settings
        ).toPromise().then(res => {
            let e = this.evt.parse(res);
            if (e) {
                console.error(e);
                alert(e);
            } else {
                return this.load();
            }
        });
    }

    add(): Promise<any> {
        if (!this.newCn) { return Promise.resolve(); }
        this.callNumbers.push(this.newCn);
        return this.update();
    }

    deleteSelected(): Promise<any> {
        let keepCns = [];
        this.callNumbers.forEach(cn => {
            if (!this.selected[cn]) {
                keepCns.push(cn);
            }
        });
        if (keepCns.length === this.callNumbers.length) {
            return Promise.resolve();
        }
        this.callNumbers = keepCns;
        return this.update();
    }
}
