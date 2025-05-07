import {NgModule} from '@angular/core';
import {RouterModule, Routes} from '@angular/router';
import {ReceiveComponent} from './receive.component';
import {LineitemListComponent} from '../lineitem/lineitem-list.component';
import {LineitemDetailComponent} from '../lineitem/detail.component';
import {LineitemCopiesComponent} from '../lineitem/copies.component';
import {LineitemHistoryComponent} from '../lineitem/history.component';
import {LineitemWorksheetComponent} from '../lineitem/worksheet.component';

const routes: Routes = [{
  path: '',
  component: ReceiveComponent,
}, {
  path: ':lineitemId',
  component: ReceiveComponent,
  children : [{
    path: '',
    component: LineitemListComponent
  }, {
    path: 'lineitem/:lineitemId/detail',
    component: LineitemDetailComponent
  }, {
    path: 'lineitem/:lineitemId/history',
    component: LineitemHistoryComponent
  }, {
    path: 'lineitem/:lineitemId/items',
    component: LineitemCopiesComponent
  }, {
    path: 'lineitem/:lineitemId/worksheet',
    component: LineitemWorksheetComponent
  }]
}];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
  providers: []
})

export class ReceiveRoutingModule {}
