import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {HttpClientModule} from '@angular/common/http';
import {CatalogCommonModule} from '@eg/share/catalog/catalog-common.module';
import {LineitemModule} from '@eg/staff/acq/lineitem/lineitem.module';
import {HoldingsModule} from '@eg/staff/share/holdings/holdings.module';
import {RelatedRoutingModule} from './routing.module';
import {RelatedComponent} from './related.component';
import {PoService} from '../po/po.service';

@NgModule({
  declarations: [
    RelatedComponent
  ],
  imports: [
    StaffCommonModule,
    CatalogCommonModule,
    LineitemModule,
    HoldingsModule,
    RelatedRoutingModule
  ],
  providers: [
    // Needed for the lineite-list bits
    PoService
  ]
})

export class RelatedModule {
}
