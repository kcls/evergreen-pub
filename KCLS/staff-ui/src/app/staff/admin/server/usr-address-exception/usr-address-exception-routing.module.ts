import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {UsrAddressExceptionComponent} from './usr-address-exception.component';

const routes: Routes = [{
    path: '',
    component: UsrAddressExceptionComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})

export class UsrAddressExceptionRoutingModule {}
