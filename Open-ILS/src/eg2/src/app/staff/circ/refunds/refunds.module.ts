import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CircRefundsRoutingModule} from './routing.module';
import {RefundsService} from './refunds.service';
import {RefundsComponent} from './refunds.component';
import {RefundDetailComponent} from './detail.component';

@NgModule({
  declarations: [
    RefundsComponent,
    RefundDetailComponent
  ],
  imports: [
    StaffCommonModule,
    CircRefundsRoutingModule
  ],
  providers: [
    RefundsService
  ]
})

export class CircRefundsModule {}

