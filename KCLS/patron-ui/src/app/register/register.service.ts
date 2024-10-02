import {Injectable, EventEmitter} from '@angular/core';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';
import {KioskService} from '../kiosk.service';

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

    // Kiosk mode is app-wide; delegate to the shared service.  The setter
    // preserves the existing register.component assignment: kiosk mode is
    // sticky, so setting false is a no-op.
    get inKioskMode(): boolean {
        return this.kiosk.active;
    }

    set inKioskMode(value: boolean) {
        if (value) { this.kiosk.activate(); }
    }

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
        private gateway: Gateway,
        private kiosk: KioskService) {
    }
}

