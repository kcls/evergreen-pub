import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';

const routes: Routes = [{
  path: 'requests',
  loadChildren: () =>
    import('./requests/requests.module').then(m => m.RequestsModule)
}, {
  path: 'register',
  loadChildren: () =>
    import('./register/register.module').then(m => m.RegisterModule)
}];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
