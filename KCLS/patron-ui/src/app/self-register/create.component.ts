import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {FormBuilder, FormControl, Validators} from '@angular/forms';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {SelfRegisterService} from './register.service';

@Component({
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss']
})
export class SelfRegisterCreateComponent implements OnInit {

    cardDesignGroup = this.formBuilder.group({
        design: ['', Validators.required],
    });

    cardDeliveryGroup = this.formBuilder.group({
        delivery: ['Mail', Validators.required],
    });

    nameGroup = this.formBuilder.group({
        first: ['', Validators.required],
        middle: '',
        last: ['', Validators.required],
        legal_first: '',
        legal_middle: '',
        legal_last: '',
    });

    constructor(
        private router: Router,
        private gateway: Gateway,
        private formBuilder: FormBuilder,
        public app: AppService,
        public requests: SelfRegisterService,
    ) {}

    ngOnInit() {
    }
}

