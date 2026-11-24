import {Pipe, PipeTransform} from '@angular/core';
import {IdlObject} from './idl.service';

// Returns the name part (e.g. 'family_name') a user goes by: the
// preferred value when there is one, otherwise the base (legal) value.
export function userNamePart(user: IdlObject, part: string): string {
    if (!user) { return ''; }
    return user['pref_' + part]() || user[part]() || '';
}

// {{user | egUserName:'family_name'}} => name part the user goes by
// {{user | egUserName}} => "Family, First Second"
//
// Impure because IdlObject's are modified in place, e.g. by an editor.
@Pipe({name: 'egUserName', pure: false})
export class UserNamePipe implements PipeTransform {
    transform(user: IdlObject, part?: string): string {
        if (part) { return userNamePart(user, part); }
        if (!user) { return ''; }

        const given = [
            userNamePart(user, 'first_given_name'),
            userNamePart(user, 'second_given_name')
        ].filter(n => n).join(' ');

        return [userNamePart(user, 'family_name'), given]
            .filter(n => n).join(', ');
    }
}
