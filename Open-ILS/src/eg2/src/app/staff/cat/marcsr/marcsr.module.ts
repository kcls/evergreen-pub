import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {CommonWidgetsModule} from '@eg/share/common-widgets.module';
import {MarcSearchReplaceRoutingModule} from './routing.module';
import {MarcDiffDialogComponent} from './diff-dialog.component';
import {MarcSearchReplaceComponent} from './marcsr.component';

@NgModule({
  declarations: [
    MarcDiffDialogComponent,
    MarcSearchReplaceComponent
  ],
  imports: [
    StaffCommonModule,
    CommonWidgetsModule,
    MarcSearchReplaceRoutingModule
  ],
  providers: [
  ]
})

export class MarcSearchReplaceModule {
}
