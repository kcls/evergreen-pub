import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {FormBuilder, FormControl, Validators} from '@angular/forms';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {SelfRegisterService} from './register.service';

const JUV_AGE = 18; // years
const DEFAULT_STATE = 'Washington';

@Component({
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss']
})
export class SelfRegisterCreateComponent implements OnInit {

    minDob = new Date("1900-01-01");
    maxDob = new Date();

    isJuvenile = false;
    juvMinDob: Date;

    formNeedsWork = false;

    formGroup = this.formBuilder.group({
        design: ['', Validators.required],
        delivery: ['Mail', Validators.required],
        first: ['', Validators.required],
        middle: '',
        last: ['', Validators.required],
        legalIsSame: true,
        legalFirst: '',
        legalMiddle: '',
        legalLast: '',
        dob: ['', Validators.required],
        guardian: '',
        phone: ['', [Validators.required, Validators.pattern(/\d{3}-\d{3}-\d{4}/)]],
        email: ['', Validators.email],
        email2: ['', Validators.email],
        wantsLibNews: false,
        wantsFoundationInfo: false,
        street1: ['', Validators.required],
        street2: '',
        city: ['', Validators.required],
        state: [DEFAULT_STATE, Validators.required],
        zipCode: ['', [Validators.required, Validators.pattern(/\d{5}/)]],
        mailingIsSame: true,
        mailingStreet1: '',
        mailingStreet2: '',
        mailingCity: '',
        mailingState: DEFAULT_STATE,
        mailingZipCode: '',
        termsOfService: false,
    });

    states = [
        $localize`Alabama`,
        $localize`Alaska`,
        $localize`Arizona`,
        $localize`Arkansas`,
        $localize`California`,
        $localize`Colorado`,
        $localize`Connecticut`,
        $localize`Delaware`,
        $localize`District of Columbia`,
        $localize`Florida`,
        $localize`Georgia`,
        $localize`Hawaii`,
        $localize`Idaho`,
        $localize`Illinois`,
        $localize`Indiana`,
        $localize`Iowa`,
        $localize`Kansas`,
        $localize`Kentucky`,
        $localize`Louisiana`,
        $localize`Maine`,
        $localize`Maryland`,
        $localize`Massachusetts`,
        $localize`Michigan`,
        $localize`Minnesota`,
        $localize`Mississippi`,
        $localize`Missouri`,
        $localize`Montana`,
        $localize`Nebraska`,
        $localize`Nevada`,
        $localize`New Hampshire`,
        $localize`New Jersey`,
        $localize`New Mexico`,
        $localize`New York`,
        $localize`North Carolina`,
        $localize`North Dakota`,
        $localize`Ohio`,
        $localize`Oklahoma`,
        $localize`Oregon`,
        $localize`Pennsylvania`,
        $localize`Rhode Island`,
        $localize`South Carolina`,
        $localize`South Dakota`,
        $localize`Tennessee`,
        $localize`Texas`,
        $localize`Utah`,
        $localize`Vermont`,
        $localize`Virginia`,
        $localize`Washington`,
        $localize`West Virginia`,
        $localize`Wisconsin`,
        $localize`Wyoming`,
        $localize`Armed Forces Americas`,
        $localize`Armed Forces Europe`,
        $localize`Armed Forces Pacific`
    ];

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

        this.formGroup.controls.dob.valueChanges.subscribe((dob: unknown) => {
            if ((dob as Date) > this.juvMinDob) {
                this.isJuvenile = true;
                this.formGroup.controls.guardian.setValidators(Validators.required);
            } else {
                this.isJuvenile = false;
                this.formGroup.controls.guardian.clearValidators();
            }
        });

        this.formGroup.controls.mailingIsSame.valueChanges.subscribe(isSame => {
            if (isSame) {
                this.formGroup.controls.mailingStreet1.clearValidators();
                this.formGroup.controls.mailingCity.clearValidators();
                this.formGroup.controls.mailingState.clearValidators();
                this.formGroup.controls.mailingZipCode.clearValidators();
            } else {
                this.formGroup.controls.mailingStreet1.setValidators(Validators.required);
                this.formGroup.controls.mailingCity.setValidators(Validators.required);
                this.formGroup.controls.mailingState.setValidators(Validators.required);
                this.formGroup.controls.mailingZipCode.setValidators([Validators.required, Validators.pattern(/\d{5/)]);
            }
        });
    }

    // Avoid disabling the submit button for missing values.
    // See submit() for why.
    canSubmit(): boolean {
        if (!this.formGroup.controls.termsOfService.value) {
            return false;
        }

        return true;
    }

    cancel() {
        window.location.reload();
    }

    submit() {
        this.formNeedsWork = false;

        for (const field in this.formGroup.controls) {

            // Set all form fields to "touched" so that empty+required
            // fields will appear as errors in the form.
            (this.formGroup.controls as any)[field].markAsTouched();

            if ((this.formGroup.controls as any)[field].errors) {
                this.formNeedsWork = true;
                return;
            }
        }

        // if state == DEFAULT_STATE => WA
    }
}

