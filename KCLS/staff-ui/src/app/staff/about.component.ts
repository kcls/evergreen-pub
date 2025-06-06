import {Component, OnInit} from '@angular/core';
import {NetService} from '@eg/core/net.service';

@Component({
    selector: 'eg-about',
    templateUrl: 'about.component.html'
})

export class AboutComponent implements OnInit {
    server: string;
    version: string;

    constructor(
        private net: NetService
    ) {}

    ngOnInit() {
        this.server = window.location.hostname;
        // Staff-facing generated versions are not always helpful to KCLS.
        // Just show the major version numbers
        this.version = "3.14";

        /*
        this.net.request(
            'open-ils.actor',
            'opensrf.open-ils.system.ils_version'
        ).subscribe(v => this.version = v);
        */
    }
}

