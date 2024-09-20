import {Injectable, EventEmitter} from '@angular/core';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';

@Injectable()
export class SelfRegisterService {
    constructor(
        private app: AppService,
        private settings: Settings,
        private gateway: Gateway) {
    }
}

