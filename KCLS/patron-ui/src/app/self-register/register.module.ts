import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AppCommonModule} from '../common.module';
import {SelfRegisterRoutingModule} from './routing.module';
import {SelfRegisterService} from './register.service';
import {SelfRegisterComponent} from './register.component';

@NgModule({
  declarations: [
    SelfRegisterComponent,
  ],
  imports: [
    CommonModule,
    AppCommonModule,
    SelfRegisterRoutingModule
  ],
  providers: [SelfRegisterService]
})
export class SelfRegisterModule { }
