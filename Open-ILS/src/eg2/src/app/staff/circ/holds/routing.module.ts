import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {HoldsPullListComponent} from './pull-list.component';
import {HoldsShelfComponent} from './shelf.component';

const routes: Routes = [{
  path: 'pull-list',
  component: HoldsPullListComponent
}, {
  path: 'shelf',
  component: HoldsShelfComponent
}, {
  path: 'shelf/clear',
  component: HoldsShelfComponent,
  data: [{clearOnLoad: true}]
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})

export class HoldsUiRoutingModule {}
