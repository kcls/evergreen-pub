import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {CheckinComponent} from './checkin.component';
import {CheckinLostPaidComponent} from './lostpaid.component';

const routes: Routes = [{
    path: '',
    component: CheckinComponent
  }, {
    path: 'capture',
    component: CheckinComponent,
    data: {capture: true}
  }, {
    path: 'lostpaid/:itemId',
    component: CheckinLostPaidComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})

export class CheckinRoutingModule {}
