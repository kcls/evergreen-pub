import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CatalogCommonModule} from '@eg/share/catalog/catalog-common.module';
import {HoldingsModule} from '@eg/staff/share/holdings/holdings.module';
import {UpdateItemsRoutingModule} from './routing.module';
import {UpdateItemsComponent} from './update-items.component';

@NgModule({
  declarations: [
    UpdateItemsComponent,
  ],
  imports: [
    StaffCommonModule,
    CatalogCommonModule,
    HoldingsModule,
    UpdateItemsRoutingModule
  ],
  providers: []
})

export class UpdateItemsModule {}
