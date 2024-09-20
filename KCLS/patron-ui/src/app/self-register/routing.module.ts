import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {SelfRegisterComponent} from './register.component';
import {SelfRegisterCreateComponent} from './create.component';

const routes: Routes = [{
  path: '',
  component: SelfRegisterComponent,
  children: [{
    path: 'create',
    component: SelfRegisterCreateComponent
  }]
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class SelfRegisterRoutingModule { }
