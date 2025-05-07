import {Component, OnInit} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {IdlObject} from '@eg/core/idl.service';

@Component({
  templateUrl: 'receive.component.html'
})
export class ReceiveComponent implements OnInit {

    lineitemId: number;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
    ) {}

    ngOnInit() {
        this.route.paramMap.subscribe((params: ParamMap) => {
            this.lineitemId = +params.get('lineitemId') || null;

            setTimeout(() => {
                const node = document.getElementById('id-search-input') as HTMLInputElement;
                if (node) { node.select(); }
            });
        });
    }

    isBasePage(): boolean {
        return !this.route.firstChild ||
            this.route.firstChild.snapshot.url.length === 0;
    }

    findLineitem() {
        if (!this.lineitemId) { return; }
        this.router.navigate(
            [`/staff/acq/receive-lineitems/${this.lineitemId}`]);
    }
}

