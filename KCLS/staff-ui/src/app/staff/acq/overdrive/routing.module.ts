import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {OverdriveComponent} from './overdrive.component';
import {ImportComponent} from './import.component';

const routes: Routes = [{
  path: '',
  component: OverdriveComponent,
  children: [{
    path: '',
    pathMatch: 'full',
    redirectTo: 'import'
  }, {
    path: 'import',
    component: ImportComponent
  }]
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
  providers: []
})

export class OverdriveRoutingModule {}
