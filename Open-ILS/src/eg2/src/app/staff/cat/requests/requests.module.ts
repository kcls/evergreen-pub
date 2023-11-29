import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CommonWidgetsModule} from '@eg/share/common-widgets.module';
import {ItemRequestRoutingModule} from './routing.module';
import {ItemRequestComponent} from './list.component';

@NgModule({
  declarations: [
    ItemRequestComponent
  ],
  imports: [
    StaffCommonModule,
    CommonWidgetsModule,
    ItemRequestRoutingModule
  ],
  providers: [
  ]
})

export class ItemRequestModule {
}
