import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {MarkItemMissingPiecesComponent} from './missing-pieces.component';
import {ItemStatusComponent} from './status.component';
import {MarkDamagedComponent} from './mark-damaged.component';

const routes: Routes = [{
    path: 'missing_pieces',
    component: MarkItemMissingPiecesComponent
  }, {
    path: 'missing_pieces/:id',
    component: MarkItemMissingPiecesComponent
  }, {
    path: 'damaged/:id',
    component: MarkDamagedComponent
  }, {
    path: 'list',
    component: ItemStatusComponent
  }, {
    path: 'list/:copyIdList',
    component: ItemStatusComponent
  }, {
    path: ':id/:tab',
    component: ItemStatusComponent
  }, {
    path: ':id',
    component: ItemStatusComponent
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
  providers: []
})

export class ItemRoutingModule {}

