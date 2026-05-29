import {Injectable, EventEmitter} from '@angular/core';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';

interface RegisterResult {
    complete: boolean;
    success: boolean;
    barcode: string | null;
    accountType: string;
    deliveryMethod: string;
    homeOrgName: string;
}

@Injectable()
export class RegisterService {
    inKioskMode = false;

    registerResult: RegisterResult = {
        complete: false,
        success: false,
        barcode: '',
        accountType: '',
        deliveryMethod: '',
        homeOrgName: '',
    };

    constructor(
        private app: AppService,
        private settings: Settings,
        private gateway: Gateway) {
    }
}

