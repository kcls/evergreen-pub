import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';

const routes: Routes = [{
  path: 'overdrive',
  loadChildren: () =>
    import('./overdrive/overdrive.module').then(m => m.OverdriveModule)
}, {
  path: 'update-items',
  loadChildren: () =>
    import('./update-items/update-items.module').then(m => m.UpdateItemsModule)
}, {
  path: 'search',
  loadChildren: () =>
    import('./search/acq-search.module').then(m => m.AcqSearchModule)
}, {
  path: 'provider',
  loadChildren: () =>
    import('./provider/acq-provider.module').then(m => m.AcqProviderModule)
}, {
  path: 'po',
  loadChildren: () => import('./po/po.module').then(m => m.PoModule)
}, {
  path: 'asn',
  loadChildren: () => import('./asn/asn.module').then(m => m.AsnModule)
}, {
  path: 'picklist',
  loadChildren: () =>
    import('./picklist/picklist.module').then(m => m.PicklistModule)
}, {
  path: 'receive-lineitems',
  loadChildren: () =>
    import('./receive-lineitems/receive.module').then(m => m.ReceiveLineitemModule)
}, {
  path: 'related',
  loadChildren: () =>
    import('./related/related.module').then(m => m.RelatedModule)
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})

export class AcqRoutingModule {}
