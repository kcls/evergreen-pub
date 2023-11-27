import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CommonWidgetsModule} from '@eg/share/common-widgets.module';
import {IllRoutingModule} from './routing.module';
import {TrackIllComponent} from './track.component';
import {PatronModule} from '@eg/staff/share/patron/patron.module';
import {HoldingsModule} from '@eg/staff/share/holdings/holdings.module';


@NgModule({
  declarations: [
    TrackIllComponent,
  ],
  imports: [
    StaffCommonModule,
    CommonWidgetsModule,
    PatronModule,
    HoldingsModule,
    IllRoutingModule,
  ],
  providers: [
  ]
})

export class IllModule {}
