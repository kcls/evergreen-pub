import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AppCommonModule} from '../common.module';
import {GetacardRoutingModule} from './routing.module';
import {GetacardState} from './state.service';
import {GetacardShellComponent} from './shell.component';
import {AddressStepComponent} from './address-step.component';
import {AccountStepComponent} from './account-step.component';
import {AboutStepComponent} from './about-step.component';
import {PlaceholderStepComponent} from './placeholder-step.component';

@NgModule({
  declarations: [
    GetacardShellComponent,
    AddressStepComponent,
    AccountStepComponent,
    AboutStepComponent,
    PlaceholderStepComponent,
  ],
  imports: [
    CommonModule,
    AppCommonModule,
    GetacardRoutingModule,
  ],
  providers: [GetacardState]
})
export class GetacardModule { }
