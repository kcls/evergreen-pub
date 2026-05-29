import {Component, OnInit} from '@angular/core';
import {Router, ActivatedRoute, Params, ParamMap} from '@angular/router';
import {AppService} from '../app.service';
import {FormControl} from '@angular/forms';
import {Gateway} from '../gateway.service';
import {RegisterService} from './register.service';
import {Title}  from '@angular/platform-browser';

@Component({
  templateUrl: './complete.component.html',
  styleUrls: ['./complete.component.scss']
})
export class RegisterCompleteComponent implements OnInit {

    constructor(
        private title: Title,
        public register: RegisterService,
    ) {}

    ngOnInit() {

        this.title.setTitle($localize`Registration Complete`);
    }
}

