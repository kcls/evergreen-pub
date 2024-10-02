import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {FormBuilder, FormControl, Validators, AbstractControl,
    ValidationErrors, ValidatorFn} from '@angular/forms';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';
import {RegisterService} from './register.service';

const JUV_AGE = 18; // years
const DEFAULT_STATE = 'Washington';

export const sameEmailValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
    const email = control.get('email');
    const email2 = control.get('email2');

    if (email &&
        email2 &&
        email.value &&
        (email2.touched || email2.dirty) &&
        email.value !== email2.value
    ) {
        return {sameEmailValidator: true};
    }

    return null;
};

@Component({
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss']
})
export class RegisterCreateComponent implements OnInit {

    minDob = new Date("1900-01-01");
    maxDob = new Date();

    isJuvenile = false;
    juvMinDob: Date;

    formNeedsWork = false;
    homeOrgs: Hash[] = [];

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
        homeOrg: ['', Validators.required],
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
    }, {validators: sameEmailValidator});

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
        private app: AppService,
        private settings: Settings,
        public register: RegisterService,
    ) {
        this.juvMinDob = new Date();
        this.juvMinDob.setFullYear(new Date().getFullYear() - JUV_AGE);
    }

    ngOnInit() {

        // Users are allowed to select a home lib from the set of
        // org units where the opac.allow_pending_user setting is true.
        this.app.getOrgTree().then(tree => {
            this.settings.settingValueForOrgs('opac.allow_pending_user')
            .then((list: Hash[]) => {
                list.forEach(setting => {
                    if ((setting.summary as Hash).value) {
                        let org = this.app.getOrgUnit(setting.org_unit as number);
                        if (org) {
                            this.homeOrgs.push(org);
                        }
                    }
                });

                this.homeOrgs = this.homeOrgs.sort((a: Hash, b: Hash) =>
                    (a.name as string) < (b.name as string) ? -1 : 1);
            });
        });

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

            if (this.formGroup.errors) {
                this.formNeedsWork = true;
                return;
            }
        }

        // if state == DEFAULT_STATE => WA
    }
}
