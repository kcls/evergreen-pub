import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AppCommonModule} from '../common.module';
import {RegisterRoutingModule} from './routing.module';
import {RegisterService} from './register.service';
import {RegisterComponent} from './register.component';
import {RegisterCreateComponent} from './create.component';
import {RegisterCompleteComponent} from './complete.component';
import {AutoPhoneDashDirective} from './auto-phone-dash.directive';

@NgModule({
  declarations: [
    RegisterComponent,
    RegisterCreateComponent,
    RegisterCompleteComponent,
    AutoPhoneDashDirective,
  ],
  imports: [
    CommonModule,
    AppCommonModule,
    RegisterRoutingModule
  ],
  providers: [RegisterService]
})
export class RegisterModule { }
