import {Injectable} from '@angular/core';
import {Gateway, Hash} from './gateway.service';
import {AppService} from './app.service';

@Injectable({providedIn: 'root'})
export class Settings {

    constructor(
        private gateway: Gateway,
        public app: AppService
    ) {}

    getServerSetting(name: string): Promise<any> {
        return this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.settings.retrieve',
            [name],
            this.app.getAuthtoken()
        ).then(summary => (summary as Hash).value);
    }

    settingValueForOrgs(name: string): Promise<Hash[]> {
        return this.gateway.requestOne(
            'open-ils.actor',
            'open-ils.actor.settings.value_for_all_orgs.atomic',
            // Authtoken is not required for publicly-visible setting values.
            this.app.getAuthtoken(),
            name,
        ).then(list => list as Hash[]);
    }
}
