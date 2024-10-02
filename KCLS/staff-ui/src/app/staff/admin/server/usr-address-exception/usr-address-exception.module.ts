import {NgModule} from '@angular/core';
import {AdminCommonModule} from '@eg/staff/admin/common.module';
import {UsrAddressExceptionComponent} from './usr-address-exception.component';
import {UsrAddressExceptionRoutingModule} from './usr-address-exception-routing.module';

@NgModule({
  declarations: [
    UsrAddressExceptionComponent
  ],
  imports: [
    AdminCommonModule,
    UsrAddressExceptionRoutingModule
  ],
  exports: [
  ],
  providers: [
  ]
})

export class UsrAddressExceptionModule {
}
