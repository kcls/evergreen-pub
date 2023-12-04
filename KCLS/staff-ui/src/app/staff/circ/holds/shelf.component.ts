import {Component, OnInit, Input, ViewChild, HostListener} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {PcrudService} from '@eg/core/pcrud.service';
import {IdlObject} from '@eg/core/idl.service';
import {AuthService} from '@eg/core/auth.service';
import {StoreService} from '@eg/core/store.service';

@Component({
  selector: 'eg-holds-shelf',
  templateUrl: 'shelf.component.html'
})
export class HoldsShelfComponent implements OnInit {

    clearOnLoad = false; // Really translates to showClearable.

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private pcrud: PcrudService,
        private auth: AuthService,
        private store: StoreService
    ) {}

    ngOnInit() {
        const data = this.route.snapshot.data;
        if (data && data[0] && data[0].clearOnLoad) {
            this.clearOnLoad = true;
        }
    }

    targetOrg(): number {
        return this.auth.user().ws_ou();
    }

    hidePrint(): boolean {
        return (
            !this.clearOnLoad &&
            this.auth.user().usrname() !== 'admin'
        );
    }
}

