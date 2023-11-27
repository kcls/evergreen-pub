import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {NgbModule} from '@ng-bootstrap/ng-bootstrap';
import {GroupedMenuComponent} from './grouped-menu.component';
import {GroupedMenuEntryComponent} from './grouped-menu-entry.component';

@NgModule({
  declarations: [
    GroupedMenuComponent,
    GroupedMenuEntryComponent
  ],
  imports: [
    CommonModule,
    NgbModule
  ],
  exports: [
    GroupedMenuComponent,
    GroupedMenuEntryComponent
  ]
})

export class GroupedMenuModule { }

