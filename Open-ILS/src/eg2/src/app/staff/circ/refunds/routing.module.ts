import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {RefundsComponent} from './refunds.component';
import {RefundDetailComponent} from './detail.component';


const routes: Routes = [{
  path: '',
  component: RefundsComponent,
}, {
  path: ':id',
  component: RefundDetailComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CircRefundsRoutingModule {}
