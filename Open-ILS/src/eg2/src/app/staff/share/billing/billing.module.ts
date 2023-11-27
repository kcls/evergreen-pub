import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {BillingService} from './billing.service';
import {AddBillingDialogComponent} from './billing-dialog.component';
import {CreditCardDialogComponent} from './credit-card-dialog.component';
import {LdapAuthDialogComponent} from './ldap-auth-dialog.component';

@NgModule({
    declarations: [
        CreditCardDialogComponent,
        AddBillingDialogComponent,
        LdapAuthDialogComponent
    ],
    imports: [
        StaffCommonModule
    ],
    exports: [
        AddBillingDialogComponent,
        CreditCardDialogComponent,
        LdapAuthDialogComponent
    ],
    providers: [
        BillingService
    ]
})

export class BillingModule {}
