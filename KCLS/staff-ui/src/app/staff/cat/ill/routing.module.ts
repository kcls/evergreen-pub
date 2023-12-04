import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {TrackIllComponent} from './track.component';

const routes: Routes = [{
    path: 'track',
    component: TrackIllComponent,
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
  providers: []
})

export class IllRoutingModule {}

