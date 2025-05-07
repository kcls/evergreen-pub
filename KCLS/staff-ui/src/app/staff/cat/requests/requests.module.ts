import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CommonWidgetsModule} from '@eg/share/common-widgets.module';
import {ItemRequestRoutingModule} from './routing.module';
import {ItemRequestComponent} from './list.component';
import {ItemRequestDialogComponent} from './dialog.component';

@NgModule({
  declarations: [
    ItemRequestComponent,
    ItemRequestDialogComponent
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
