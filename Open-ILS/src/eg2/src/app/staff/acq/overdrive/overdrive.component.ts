import {Component, OnInit} from '@angular/core';
import {Router, ActivatedRoute, NavigationEnd} from '@angular/router';
import {take} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';

@Component({
  templateUrl: 'overdrive.component.html'
})
export class OverdriveComponent implements OnInit {
    tab: string;

    constructor(
        private router: Router,
        private route: ActivatedRoute) {

        // As the parent component of the vandelay route tree, our
        // activated route never changes.  Instead, listen for global
        // route events, then ask for the first segement of the first
        // child, which will be the tab name.
        this.router.events.subscribe(routeEvent => {
            if (routeEvent instanceof NavigationEnd) {
                this.route.firstChild.url.pipe(take(1))
                .subscribe(segments => this.tab = segments[0].path);
            }
        });
    }

    ngOnInit() {}
}

