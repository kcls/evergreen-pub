import {Component, OnInit} from '@angular/core';
import {Router, Event, NavigationEnd} from '@angular/router';
import {AppService} from '../app.service';
import {FormControl} from '@angular/forms';
import {Gateway} from '../gateway.service';
import {SelfRegisterService} from './register.service';
import {Title}  from '@angular/platform-browser';

@Component({
  templateUrl: './register.component.html'
  //styleUrls: ['./register.component.scss']
})
export class SelfRegisterComponent implements OnInit {
    constructor(
        private router: Router,
        private title: Title,
        private gateway: Gateway,
        public app: AppService,
        public registers: SelfRegisterService,
    ) {}

    ngOnInit() {
        this.title.setTitle($localize`Get a Library Card`);
    }
}

