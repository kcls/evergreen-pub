import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {UpdateItemsComponent} from './update-items.component';

const routes: Routes = [{
  path: ':recordId',
  component: UpdateItemsComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
  providers: []
})

export class UpdateItemsRoutingModule {}
