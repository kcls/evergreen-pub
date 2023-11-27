import {Injectable, EventEmitter} from '@angular/core';
import {OrgService} from '@eg/core/org.service';
import {AuthService} from '@eg/core/auth.service';

/* Behavior common to staff users */

@Injectable()
export class StaffService {

    constructor(
        private org: OrgService,
        private auth: AuthService
    ) {}

    // TODO: shared dat service?
    dateAsYmd(date?: Date) {
        if (!date) { date = new Date(); }

        return date.getFullYear()
        + '-' +
        String(date.getMonth() + 1).padStart(2, '0')
        + '-' +
        String(date.getDate()).padStart(2, '0');
    }



    // Append date-stamped initials to a note
    appendInitials(note: string, initials: string): string {
        return note +
            ' [ ' +
            initials
            + ' ' +
            this.dateAsYmd()
            + ' @ ' +
            this.org.get(this.auth.user().ws_ou()).shortname()
            + ' ]';
    }
}


