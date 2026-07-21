import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';

const routes: Routes = [{
  path: 'requests',
  loadChildren: () =>
    import('./requests/requests.module').then(m => m.RequestsModule)
}, {
  path: 'getacard',
  loadChildren: () =>
    import('./getacard/getacard.module').then(m => m.GetacardModule)
}];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
