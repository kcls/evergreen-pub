import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {RegisterComponent} from './register.component';
import {RegisterCreateComponent} from './create.component';
import {RegisterCompleteComponent} from './complete.component';

const routes: Routes = [{
  path: '',
  component: RegisterComponent,
  children: [{
    // Each stepper section has its own URL (e.g. create/your-information)
    // so Back/Continue and the browser back/forward buttons navigate
    // between sections instead of leaving the site.
    path: 'create',
    redirectTo: 'create/your-information',
    pathMatch: 'full'
  }, {
    path: 'create/:step',
    component: RegisterCreateComponent
  }, {
    path: 'complete',
    component: RegisterCompleteComponent
  }]
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class RegisterRoutingModule { }
