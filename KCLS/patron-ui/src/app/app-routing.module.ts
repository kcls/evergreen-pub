import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';

const routes: Routes = [{
  path: 'requests',
  loadChildren: () =>
    import('./requests/requests.module').then(m => m.RequestsModule)
}, {
  path: 'self-register',
  loadChildren: () =>
    import('./self-register/register.module').then(m => m.SelfRegisterModule)
}];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
