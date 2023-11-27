import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';

const routes: Routes = [{
  path: 'refunds',
  loadChildren: () =>
    import('./refunds/refunds.module').then(m => m.CircRefundsModule)
}, {
  path: 'patron',
  loadChildren: () =>
    import('./patron/patron.module').then(m => m.PatronManagerModule)
}, {
    path: 'item',
    loadChildren: () =>
        import('./item/routing.module').then(m => m.CircItemRoutingModule)
}, {
  path: 'checkin',
  loadChildren: () =>
    import('./checkin/checkin.module').then(m => m.CheckinModule)
}, {
  path: 'renew',
  loadChildren: () =>
    import('./renew/renew.module').then(m => m.RenewModule)
}, {
  path: 'worklog',
  loadChildren: () =>
    import('./worklog/worklog.module').then(m => m.CircWorkLogModule)
}, {
  path: 'holds',
  loadChildren: () =>
    import('./holds/holds.module').then(m => m.HoldsUiModule)
}, {
  path: 'ada-requests',
  loadChildren: () =>
    import('./ada-requests/ada-requests.module').then(m => m.AdaRequestsModule)
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})

export class CircRoutingModule {}
