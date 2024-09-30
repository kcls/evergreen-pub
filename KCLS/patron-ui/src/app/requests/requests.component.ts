import {Component, OnInit} from '@angular/core';
import {Router, Event, NavigationEnd} from '@angular/router';
import {AppService} from '../app.service';
import {FormControl} from '@angular/forms';
import {RequestsService} from './requests.service';
import {Gateway} from '../gateway.service';

@Component({
  templateUrl: './requests.component.html',
  styleUrls: ['./requests.component.scss']
})
export class RequestsComponent implements OnInit {
    tab = 'create';

    controls: {[field: string]: FormControl} = {
        format: new FormControl(''),
        ill_opt_out: new FormControl(false),
    };

    constructor(
        private router: Router,
        private gateway: Gateway,
        public app: AppService,
        public requests: RequestsService,
    ) {}

    ngOnInit() {
        this.tab = this.router.url.split("/").pop() || 'requests';

        if (this.tab === 'requests') {
            this.router.navigate(['/requests/create'])
                .then(() => window.location.reload());
            return;
        }

        this.router.events.subscribe((event: Event) => {
            if (event instanceof NavigationEnd) {
                this.tab = event.url.split("/").pop() || 'create';
                if (this.tab !== 'list') {
                    this.tab = 'create';
                }
            }
        });

        this.controls.format.valueChanges.subscribe(format => {
            this.requests.selectedFormat = format;
            this.requests.formatChanged.emit();
            // Changing the format means starting a new request.
            // Route to the create page.
            if (this.tab !== 'create') {
                this.router.navigate(['/requests/create']);
            }
        });

        this.controls.ill_opt_out.valueChanges.subscribe(opt => this.requests.illOptOut = opt);

        this.gateway.authSessionEnded.subscribe(() => this.reset());
        this.requests.formResetRequested.subscribe(() => this.resetForm());
    }

    resetForm() {
        for (const field in this.controls) {
            this.controls[field].reset();
            this.controls[field].markAsPristine();
            this.controls[field].markAsUntouched();
        }
    }

    reset() {
        this.tab = 'create';
        this.requests.reset();
        this.controls.format.reset();
        this.router.navigate(['/requests/create']); // in case
    }

    typeCanBeRequested(): boolean {
        return (
            this.controls.format.value !== '' &&
            this.controls.format.value !== null &&
            this.controls.format.value !== 'ebook-eaudio'
        );
    }
}
