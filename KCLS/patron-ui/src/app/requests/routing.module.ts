import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RequestsComponent } from './requests.component';
import { CreateRequestComponent } from './create.component';
import { RequestListComponent } from './list.component';

const routes: Routes = [{
  path: '',
  component: RequestsComponent,
  children: [{
    path: 'create',
    component: CreateRequestComponent
  }, {
    path: 'list',
    component: RequestListComponent
  }]
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RequestsRoutingModule { }
