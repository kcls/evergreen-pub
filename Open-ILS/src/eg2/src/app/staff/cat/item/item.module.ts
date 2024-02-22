import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CommonWidgetsModule} from '@eg/share/common-widgets.module';
import {ItemRoutingModule} from './routing.module';
import {HoldingsModule} from '@eg/staff/share/holdings/holdings.module';
import {PatronModule} from '@eg/staff/share/patron/patron.module';
import {BillingModule} from '@eg/staff/share/billing/billing.module';
import {MarkItemMissingPiecesComponent} from './missing-pieces.component';
import {ItemStatusComponent} from './status.component';
import {BarcodesModule} from '@eg/staff/share/barcodes/barcodes.module';
import {BookingModule} from '@eg/staff/share/booking/booking.module';
import {CircModule} from '@eg/staff/share/circ/circ.module';
import {ItemSummaryComponent} from './summary.component';
import {ItemRecentHistoryComponent} from './recent-history.component';
import {ItemCircHistoryComponent} from './circ-history.component';
import {ItemHoldsTransitsComponent} from './holds.component';
import {GroupedMenuModule} from '@eg/share/grouped-menu/grouped-menu.module';
import {WorkLogModule} from '@eg/staff/share/worklog/worklog.module';
import {ItemStatusService} from './item.service';
import {HoldsModule} from '@eg/staff/share/holds/holds.module';
import {TriggeredEventsModule
  } from '@eg/staff/share/triggered-events/triggered-events.module';
import {RepairCostDialogComponent} from './repair-cost-dialog.component';
import {MarkDamagedComponent} from './mark-damaged.component';

@NgModule({
  declarations: [
    MarkItemMissingPiecesComponent,
    MarkDamagedComponent,
    ItemSummaryComponent,
    ItemStatusComponent,
    ItemRecentHistoryComponent,
    ItemHoldsTransitsComponent,
    RepairCostDialogComponent,
    ItemCircHistoryComponent
  ],
  imports: [
    StaffCommonModule,
    CommonWidgetsModule,
    ItemRoutingModule,
    HoldingsModule,
    BarcodesModule,
    CircModule,
    BookingModule,
    PatronModule,
    BillingModule,
    WorkLogModule,
    HoldsModule,
    TriggeredEventsModule,
    GroupedMenuModule
  ],
  providers: [
    ItemStatusService
  ]
})

export class ItemModule {}
