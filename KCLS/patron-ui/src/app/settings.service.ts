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
}
