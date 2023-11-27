import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {AdaRequestsRoutingModule} from './routing.module';
import {AdaRequestListComponent} from './list.component';
import {AdaRequestDialogComponent} from './request.component';

@NgModule({
  declarations: [
    AdaRequestListComponent,
    AdaRequestDialogComponent
  ],
  imports: [
    StaffCommonModule,
    AdaRequestsRoutingModule
  ],
  providers: [
  ]
})

export class AdaRequestsModule {}

