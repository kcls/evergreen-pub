import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {RegisterComponent} from './register.component';
import {RegisterCreateComponent} from './create.component';

const routes: Routes = [{
  path: '',
  component: RegisterComponent,
  children: [{
    path: 'create',
    component: RegisterCreateComponent
  }]
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RegisterRoutingModule { }
