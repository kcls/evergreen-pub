import {ErrorHandler, NgModule} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {AppRoutingModule} from './app-routing.module';
import {AppComponent} from './app.component';
import {AppCommonModule} from './common.module';
import {ChunkErrorHandler} from './chunk-error-handler';


@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    AppRoutingModule,
    BrowserAnimationsModule,
    AppCommonModule
  ],
  providers: [
    {provide: ErrorHandler, useClass: ChunkErrorHandler}
  ],
  exports: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
