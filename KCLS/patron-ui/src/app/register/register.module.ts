import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AppCommonModule} from '../common.module';
import {RegisterRoutingModule} from './routing.module';
import {RegisterService} from './register.service';
import {RegisterComponent} from './register.component';
import {RegisterCreateComponent} from './create.component';

@NgModule({
  declarations: [
    RegisterComponent,
    RegisterCreateComponent,
  ],
  imports: [
    CommonModule,
    AppCommonModule,
    RegisterRoutingModule
  ],
  providers: [RegisterService]
})
export class RegisterModule { }
