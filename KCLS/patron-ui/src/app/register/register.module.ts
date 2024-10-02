import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AppCommonModule} from '../common.module';
import {RegisterRoutingModule} from './routing.module';
import {RegisterService} from './register.service';
import {RegisterComponent} from './register.component';
import {RegisterCreateComponent} from './create.component';
import {RegisterCompleteComponent} from './complete.component';

// NOTE: AutoPhoneDashDirective moved to AppCommonModule so other
// features (e.g. getacard) can use it.

@NgModule({
  declarations: [
    RegisterComponent,
    RegisterCreateComponent,
    RegisterCompleteComponent,
  ],
  imports: [
    CommonModule,
    AppCommonModule,
    RegisterRoutingModule
  ],
  providers: [RegisterService]
})
export class RegisterModule { }
