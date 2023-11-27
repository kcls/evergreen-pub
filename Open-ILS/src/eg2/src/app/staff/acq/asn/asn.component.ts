import {Component, OnInit} from '@angular/core';
import {Router, ActivatedRoute, ParamMap} from '@angular/router';
import {IdlObject} from '@eg/core/idl.service';

@Component({
  templateUrl: 'asn.component.html'
})
export class AsnComponent implements OnInit {

    constructor(
        private route: ActivatedRoute,
    ) {}

    ngOnInit() {
    }
}

