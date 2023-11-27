import {Component, OnInit, Input, ViewChild} from '@angular/core';
import {Observable} from 'rxjs';
import {switchMap} from 'rxjs/operators';
import {IdlObject, IdlService} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {EventService} from '@eg/core/event.service';
import {ToastService} from '@eg/share/toast/toast.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {AuthService} from '@eg/core/auth.service';
import {OrgService} from '@eg/core/org.service';
import {ServerStoreService} from '@eg/core/server-store.service';
import {DialogComponent} from '@eg/share/dialog/dialog.component';
import {NgbModal, NgbModalOptions} from '@ng-bootstrap/ng-bootstrap';
import {StringComponent} from '@eg/share/string/string.component';
import {ComboboxEntry, ComboboxComponent} from '@eg/share/combobox/combobox.component';
import {BillingService, CreditCardPaymentParams} from './billing.service';

/* Dialog for collecting LDAP username and password */

@Component({
  selector: 'eg-ldap-auth-dialog',
  templateUrl: 'ldap-auth-dialog.component.html'
})

export class LdapAuthDialogComponent
    extends DialogComponent implements OnInit {

    args = {
        username: '',
        password: ''
    };

    constructor(
        private modal: NgbModal) {
        super(modal);
    }

    ngOnInit() {

    }
}

