import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {FormBuilder, FormControl, Validators} from '@angular/forms';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {SelfRegisterService} from './register.service';

const JUV_AGE = 18; // years

@Component({
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss']
})
export class SelfRegisterCreateComponent implements OnInit {

    minDob = new Date("1900-01-01");
    maxDob = new Date();

    isJuvenile = false;
    juvMinDob: Date;

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
        legalIsSame: true,
        legalFirst: '',
        legalMiddle: '',
        legalLast: '',
    });

    dobGroup = this.formBuilder.group({
        dob: ['', Validators.required],
        guardian: '',
    });

    contactsGroup = this.formBuilder.group({
        phone: ['', [Validators.required, Validators.pattern(/\d{3}-\d{3}-\d{4}/)]],
        email: ['', Validators.email],
        wantsLibNews: false,
        wantsFoundationInfo: false,
    });

    addressGroup = this.formBuilder.group({

    });

    submitGroup = this.formBuilder.group({

    });

    constructor(
        private router: Router,
        private gateway: Gateway,
        private formBuilder: FormBuilder,
        public app: AppService,
        public requests: SelfRegisterService,
    ) {
        this.juvMinDob = new Date();
        this.juvMinDob.setFullYear(new Date().getFullYear() - JUV_AGE);
    }

    ngOnInit() {

        this.dobGroup.controls.dob.valueChanges.subscribe((dob: unknown) => {
            if ((dob as Date) > this.juvMinDob) {
                this.isJuvenile = true;
                this.dobGroup.controls.guardian.setValidators(Validators.required);
            } else {
                this.isJuvenile = false;
                this.dobGroup.controls.guardian.clearValidators();
            }
        });
    }
}

