import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {HttpClientModule} from '@angular/common/http';
import {OverdriveRoutingModule} from './routing.module';
import {OverdriveComponent} from './overdrive.component';
import {ImportComponent} from './import.component';

@NgModule({
  declarations: [
    OverdriveComponent,
    ImportComponent
  ],
  imports: [
    StaffCommonModule,
    OverdriveRoutingModule,
    HttpClientModule
  ],
  providers: [
  ]
})

export class OverdriveModule {
}
