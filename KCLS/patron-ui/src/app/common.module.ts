import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialImportsModule } from './material.module';
import { HttpClientModule } from '@angular/common/http';
import { Gateway } from './gateway.service';
import { AppService } from './app.service';
import { LoginComponent } from './login.component';

@NgModule({
  declarations: [LoginComponent],
  imports: [
    CommonModule,
    HttpClientModule,
    MaterialImportsModule
  ],
  providers: [Gateway, AppService],
  exports: [
    MaterialImportsModule,
    LoginComponent
  ],
})
export class AppCommonModule { }
