import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {MaterialImportsModule} from './material.module';
import {HttpClientModule} from '@angular/common/http';
import {Gateway} from './gateway.service';
import {AppService} from './app.service';
import {LoginComponent} from './login.component';
import {AutoPhoneDashDirective} from './auto-phone-dash.directive';
import {AutoDateSlashDirective} from './auto-date-slash.directive';

@NgModule({
  declarations: [LoginComponent, AutoPhoneDashDirective, AutoDateSlashDirective],
  imports: [
    CommonModule,
    HttpClientModule,
    MaterialImportsModule
  ],
  providers: [Gateway, AppService],
  exports: [
    MaterialImportsModule,
    LoginComponent,
    AutoPhoneDashDirective,
    AutoDateSlashDirective
  ],
})
export class AppCommonModule { }
