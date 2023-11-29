import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AppCommonModule} from '../common.module';
import {RequestsRoutingModule} from './routing.module';
import {RequestsService} from './requests.service';
import {RequestsComponent} from './requests.component';
import {CreateRequestComponent} from './create.component';
import {RequestListComponent} from './list.component';

@NgModule({
  declarations: [
    RequestsComponent,
    CreateRequestComponent,
    RequestListComponent
  ],
  imports: [
    CommonModule,
    AppCommonModule,
    RequestsRoutingModule
  ],
  providers: [RequestsService]
})
export class RequestsModule { }
