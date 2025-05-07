import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {ItemRequestComponent} from './list.component';

const routes: Routes = [{
    path: '',
    component: ItemRequestComponent
  }, {
    path: 'request/:requestId',
    component: ItemRequestComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
  providers: []
})

export class ItemRequestRoutingModule {}

