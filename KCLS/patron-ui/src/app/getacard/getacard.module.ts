import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AppCommonModule} from '../common.module';
import {GetacardRoutingModule} from './routing.module';
import {GetacardState} from './state.service';
import {GacIdleTimeoutService} from './idle-timeout.service';
import {GetacardShellComponent} from './shell.component';
import {AddressSearchComponent} from './address-search.component';
import {AddressStepComponent} from './address-step.component';
import {AccountStepComponent} from './account-step.component';
import {AboutStepComponent} from './about-step.component';
import {ContactStepComponent} from './contact-step.component';
import {CardStepComponent} from './card-step.component';
import {ReviewStepComponent} from './review-step.component';
import {GetacardCompleteComponent} from './complete.component';

@NgModule({
  declarations: [
    GetacardShellComponent,
    AddressSearchComponent,
    AddressStepComponent,
    AccountStepComponent,
    AboutStepComponent,
    ContactStepComponent,
    CardStepComponent,
    ReviewStepComponent,
    GetacardCompleteComponent,
  ],
  imports: [
    CommonModule,
    AppCommonModule,
    GetacardRoutingModule,
  ],
  providers: [GetacardState, GacIdleTimeoutService]
})
export class GetacardModule { }
