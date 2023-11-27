import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CircWorkLogRoutingModule} from './routing.module';
import {CircWorkLogComponent} from './worklog.component';
import {WorkLogModule} from '@eg/staff/share/worklog/worklog.module';

@NgModule({
  declarations: [
    CircWorkLogComponent
  ],
  imports: [
    StaffCommonModule,
    CircWorkLogRoutingModule,
    WorkLogModule
  ],
  providers: [
  ]
})

export class CircWorkLogModule {}

