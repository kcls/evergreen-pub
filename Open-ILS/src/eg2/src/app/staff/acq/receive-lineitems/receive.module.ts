import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CatalogCommonModule} from '@eg/share/catalog/catalog-common.module';
import {LineitemModule} from '@eg/staff/acq/lineitem/lineitem.module';
import {HoldingsModule} from '@eg/staff/share/holdings/holdings.module';
import {ReceiveRoutingModule} from './routing.module';
import {ReceiveComponent} from './receive.component';
import {PoService} from '../po/po.service';

@NgModule({
  declarations: [
    ReceiveComponent
  ],
  imports: [
    StaffCommonModule,
    CatalogCommonModule,
    LineitemModule,
    HoldingsModule,
    ReceiveRoutingModule
  ],
  providers: [
    // Needed for the lineite-list bits
    PoService
  ]
})

export class ReceiveLineitemModule {
}

