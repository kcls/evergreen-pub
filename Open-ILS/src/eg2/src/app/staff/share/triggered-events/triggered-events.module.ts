import {NgModule} from '@angular/core';
import {StaffCommonModule} from '@eg/staff/common.module';
import {TriggeredEventsComponent} from './triggered-events.component';

@NgModule({
    declarations: [
        TriggeredEventsComponent
    ],
    imports: [
        StaffCommonModule
    ],
    exports: [
        TriggeredEventsComponent
    ],
    providers: [
    ]
})

export class TriggeredEventsModule {}
