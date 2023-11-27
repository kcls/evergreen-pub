import {Component, OnInit, AfterViewInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute} from '@angular/router';
import {AuthService} from '@eg/core/auth.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {BarcodeSelectComponent} from '@eg/staff/share/barcodes/barcode-select.component';

@Component({
  templateUrl: 'circ-search.component.html',
})

export class CircSearchComponent implements OnInit, AfterViewInit {

    notFound = false;
    circId = '';

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private pcrud: PcrudService,
        private auth: AuthService
    ) {}

    ngOnInit() {
        this.circId = this.route.snapshot.paramMap.get('circId');
    }

    ngAfterViewInit() {
        const node = document.getElementById('circ-id-search-input');
        if (node) { node.focus(); }
        if (this.circId) { this.findCirc(); }
    }

    findCirc(): void {
        if (!this.circId) { return; }

        this.notFound = false;

        this.pcrud.retrieve('circ', this.circId).toPromise()
        .then(circ => {
            if (!circ) {
                this.notFound = true;
                return;
            }
            this.router.navigate([
                'staff', 'circ', 'patron', circ.usr(), 'bills', circ.id(), 'statement']
            );
        });
    }
}


