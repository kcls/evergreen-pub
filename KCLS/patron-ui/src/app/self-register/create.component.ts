import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {FormControl, Validators} from '@angular/forms';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {SelfRegisterService} from './register.service';

@Component({
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss']
})
export class SelfRegisterCreateComponent implements OnInit {

    controls: {[field: string]: FormControl} = {
        cardDesign: new FormControl('', [Validators.required]),
        cardDelivery: new FormControl('Mail', [Validators.required]),
    };

    constructor(
        private router: Router,
        private gateway: Gateway,
        public app: AppService,
        public requests: SelfRegisterService,
    ) {}

    ngOnInit() {
    }
}

