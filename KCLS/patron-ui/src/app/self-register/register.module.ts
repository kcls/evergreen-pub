import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AppCommonModule} from '../common.module';
import {SelfRegisterRoutingModule} from './routing.module';
import {SelfRegisterService} from './register.service';
import {SelfRegisterComponent} from './register.component';
import {SelfRegisterCreateComponent} from './create.component';

@NgModule({
  declarations: [
    SelfRegisterComponent,
    SelfRegisterCreateComponent,
  ],
  imports: [
    CommonModule,
    AppCommonModule,
    SelfRegisterRoutingModule
  ],
  providers: [SelfRegisterService]
})
export class SelfRegisterModule { }
