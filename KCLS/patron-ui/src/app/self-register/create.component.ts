import {Component, OnInit} from '@angular/core';
import {Router, Event, NavigationEnd} from '@angular/router';
import {AppService} from '../app.service';
import {FormControl} from '@angular/forms';
import {Gateway} from '../gateway.service';
import {SelfRegisterService} from './register.service';

@Component({
  templateUrl: './create.component.html'
  //styleUrls: ['./create.component.scss']
})
export class SelfRegisterCreateComponent implements OnInit {
    constructor(
        private router: Router,
        private gateway: Gateway,
        public app: AppService,
        public requests: SelfRegisterService,
    ) {}

    ngOnInit() {
    }
}

