import {Component, OnInit} from '@angular/core';
import {FormControl, Validators} from '@angular/forms';
import {Gateway, Hash} from './gateway.service';
import {AppService} from './app.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
    loginFailed = false;
    session: Hash | null = null;
    initDone = false;

    controls: {[field: string]: FormControl} = {
        identifier: new FormControl('', [Validators.required]),
        password: new FormControl('', [Validators.required])
    }

    constructor(
        private gateway: Gateway,
        public app: AppService
    ) {}

    ngOnInit() {
        // Fetch the session if we can.
        this.gateway.authSessionEnded.subscribe(() => this.resetForm());
        this.app.fetchAuthSession().then(() => this.initDone = true)
    }

    disableSubmit(): boolean {
        return (
            this.app.getAuthSession() !== null
            || this.controls.identifier.errors != null
            || this.controls.password.errors != null
        );
    }

    login(): boolean {
        this.loginFailed = false;
        this.app.setAuthtoken(null);

        this.gateway.requestOne(
            'open-ils.auth',
            'open-ils.auth.login', {
                identifier: this.controls.identifier.value,
                password: this.controls.password.value,
                type: 'opac'
            }
        ).then((r: unknown) => {
            if (r) {
                const evt = r as Hash;
                if (evt.textcode === 'SUCCESS') {
                    this.app.setAuthtoken((evt.payload as Hash).authtoken as string);
                    this.app.fetchAuthSession().then(() => this.resetForm());
                    return;
                }
            }

            this.loginFailed = true;
            this.app.setAuthtoken(null);
            // Leave the usrname intact for follow up login attempt.
            this.resetForm(true)
        });

        return false;
    }

    resetForm(passOnly?: boolean) {
        setTimeout(() => {
            if (!passOnly) {
                this.controls.identifier.reset();
                this.controls.identifier.markAsPristine();
                this.controls.identifier.markAsUntouched();
            }
            this.controls.password.reset();
            this.controls.password.markAsPristine();
            this.controls.password.markAsUntouched();
        });
    }

    logout() {
        this.app.clearAuth();
        this.resetForm();
    }
}

