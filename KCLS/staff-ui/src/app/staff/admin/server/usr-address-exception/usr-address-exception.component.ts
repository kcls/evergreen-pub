import {Component, OnInit} from '@angular/core';
import {IdlService, IdlObject} from '@eg/core/idl.service';
import {AuthService} from '@eg/core/auth.service';

@Component({
    templateUrl: './usr-address-exception.component.html'
})

export class UsrAddressExceptionComponent implements OnInit {

    // Seeds default values (created_by, state, enabled) when adding a new exception.
    defaultNewRecord: IdlObject;

    constructor(
        private idl: IdlService,
        private auth: AuthService,
    ) {}

    ngOnInit() {
        this.defaultNewRecord = this.idl.create('cuae');
        this.defaultNewRecord.created_by(this.auth.user().id());
        this.defaultNewRecord.state('WA');
        this.defaultNewRecord.enabled(true);
    }
}
