import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {CircWorkLogComponent} from './worklog.component';

const routes: Routes = [{
  path: '',
  component: CircWorkLogComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CircWorkLogRoutingModule {}
