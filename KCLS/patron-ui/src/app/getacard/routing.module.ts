import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {GetacardShellComponent} from './shell.component';
import {GetacardCompleteComponent} from './complete.component';

const routes: Routes = [{
  // Each step has its own URL (e.g. getacard/address) so Back/Continue and
  // the browser back/forward buttons navigate between steps.
  path: '',
  redirectTo: 'address',
  pathMatch: 'full'
}, {
  path: 'complete',
  component: GetacardCompleteComponent
}, {
  path: ':step',
  component: GetacardShellComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class GetacardRoutingModule { }
