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
        format: new FormControl('')
    };

    constructor(
        private router: Router,
        private gateway: Gateway,
        public app: AppService,
        public requests: RequestsService,
    ) {}

    ngOnInit() {
        this.tab = this.router.url.split("/").pop() || 'create';

        this.router.events.subscribe((event: Event) => {
            if (event instanceof NavigationEnd) {
                this.tab = event.url.split("/").pop() || 'create';
            }
        });

        this.controls.format.valueChanges.subscribe(format => {
            this.requests.selectedFormat = format;
            // Changing the format means starting a new request.
            // Route to the create page.
            if (this.tab !== 'create') {
                this.router.navigate(['/requests/create']);
            }
        });

        this.gateway.authSessionEnded.subscribe(() => this.reset());
    }

    reset() {
        this.tab = 'create';
        this.requests.reset();
        this.controls.format.reset();
    }

    typeCanBeRequested(): boolean {
        return (
            this.controls.format.value !== '' &&
            this.controls.format.value !== null &&
            this.controls.format.value !== 'ebook' &&
            this.controls.format.value !== 'audiobook-download'
        );
    }
}
