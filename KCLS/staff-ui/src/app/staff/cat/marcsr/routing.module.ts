import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {MarcSearchReplaceComponent} from './marcsr.component';

const routes: Routes = [{
    path: '',
    component: MarcSearchReplaceComponent
  }, {
    path: 'bucket/:bucketId',
    component: MarcSearchReplaceComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
  providers: []
})

export class MarcSearchReplaceRoutingModule {}

