import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {FormBuilder, FormControl, Validators, AbstractControl,
    FormRecord, ValidationErrors, ValidatorFn} from '@angular/forms';
import {EMPTY, Observable, from, of} from 'rxjs';
import {toArray, debounceTime, distinctUntilChanged} from 'rxjs/operators';
import {tap} from 'rxjs/operators';
import {map, startWith, switchMap} from 'rxjs/operators';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';
import {RegisterService} from './register.service';
import {MatAutocompleteSelectedEvent} from '@angular/material/autocomplete';

const JUV_AGE = 18; // years
const DEFAULT_STATE = 'WA';
const POST_CODE_REGEX = /\d{5}/;
const PHONE_REGEX = /\d{3}-\d{3}-\d{4}/;

const STAT_CAT_LIB_NEWS = 3;
const STAT_CAT_FOUNDATION_NEWS = 4;
const STAT_CAT_CARD_STYLE = 10;

const COMMON_USER_SETTING_TYPES = [
  'circ.holds_behind_desk',
  'circ.autorenew.opt_in',
  'opac.default_pickup_location',
  'opac.default_sms_notify'
];

interface UserSettingType {
    name: string;
    label: string;
    grp: string;
}


interface ApiPayload {
    user: Hash,
    billing_address: Hash,
    mailing_address:  Hash,
    settings: Hash[],
    stat_cats: Hash[],
}

interface ApiResponse {
    success: number, // Perl
}

interface AddressSuggestion {
    street_line: string,
    city: string,
    state: string,
    zipcode: string,
    full_string?: string,
}


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

    calculatedHomeOrg: number | null = null;

    emailSettings: UserSettingType[] = [];
    phoneSettings: UserSettingType[] = [];
    textSettings: UserSettingType[] = [];
    printSettings: UserSettingType[] = [];

    filteredResAddrOptions: Observable<string[]> = EMPTY;
    resAddressSuggestions: AddressSuggestion[] = [];
    selectedResAddress = '';

    filteredMailAddrOptions: Observable<string[]> = EMPTY;
    mailAddressSuggestions: AddressSuggestion[] = [];
    selectedMailAddress = '';

    cardOptions = [
        '2025-Barry-Johnson',
        '2025-Bethany-Fackrell',
        '2025-Invisible-Creature',
        '2025-Hernan-Paganini',
        '2025-Marisol-Ortega',
        '2025-Stacy-Nguyen',
        '2025-Stevie-Shao',
    ];

    registerSuccess = false;

    formGroup = this.formBuilder.record({
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
        phone: ['', [Validators.required, Validators.pattern(PHONE_REGEX)]],
        email: ['', Validators.email],
        email2: ['', Validators.email],
        homeOrg: ['', Validators.required],
        wantsLibNews: false,
        wantsFoundationInfo: false,
        street1: ['', Validators.required],
        street2: '',
        city: ['', Validators.required],
        state: [DEFAULT_STATE, Validators.required],
        zipCode: ['', [Validators.required, Validators.pattern(POST_CODE_REGEX)]],
        mailingIsSame: true,
        mailingStreet1: '',
        mailingStreet2: '',
        mailingCity: '',
        mailingState: DEFAULT_STATE,
        mailingZipCode: '',
        termsOfService: false,
        allEmailNotices: false,
        allTextNotices: false,
        allPhoneNotices: false,
        smsNumber: '',
    }, {validators: sameEmailValidator});

    // TODO move these somewhere common
	STATES = {
	  'AL': $localize`Alabama`,
	  'AK': $localize`Alaska`,
	  'AZ': $localize`Arizona`,
	  'AR': $localize`Arkansas`,
	  'CA': $localize`California`,
	  'CO': $localize`Colorado`,
	  'CT': $localize`Connecticut`,
	  'DE': $localize`Delaware`,
	  'DC': $localize`District of Columbia`,
	  'FL': $localize`Florida`,
	  'GA': $localize`Georgia`,
	  'HI': $localize`Hawaii`,
	  'ID': $localize`Idaho`,
	  'IL': $localize`Illinois`,
	  'IN': $localize`Indiana`,
	  'IA': $localize`Iowa`,
	  'KS': $localize`Kansas`,
	  'KY': $localize`Kentucky`,
	  'LA': $localize`Louisiana`,
	  'ME': $localize`Maine`,
	  'MD': $localize`Maryland`,
	  'MA': $localize`Massachusetts`,
	  'MI': $localize`Michigan`,
	  'MN': $localize`Minnesota`,
	  'MS': $localize`Mississippi`,
	  'MO': $localize`Missouri`,
	  'MT': $localize`Montana`,
	  'NE': $localize`Nebraska`,
	  'NV': $localize`Nevada`,
	  'NH': $localize`New Hampshire`,
	  'NJ': $localize`New Jersey`,
	  'NM': $localize`New Mexico`,
	  'NY': $localize`New York`,
	  'NC': $localize`North Carolina`,
	  'ND': $localize`North Dakota`,
	  'OH': $localize`Ohio`,
	  'OK': $localize`Oklahoma`,
	  'OR': $localize`Oregon`,
	  'PA': $localize`Pennsylvania`,
	  'RI': $localize`Rhode Island`,
	  'SC': $localize`South Carolina`,
	  'SD': $localize`South Dakota`,
	  'TN': $localize`Tennessee`,
	  'TX': $localize`Texas`,
	  'UT': $localize`Utah`,
	  'VT': $localize`Vermont`,
	  'VA': $localize`Virginia`,
	  'WA': $localize`Washington`,
	  'WV': $localize`West Virginia`,
	  'WI': $localize`Wisconsin`,
	  'WY': $localize`Wyoming`,
	  'AA': $localize`Armed Forces Americas`,
	  'AE': $localize`Armed Forces Europe`,
	  'AP': $localize`Armed Forces Pacific`
	};

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

        // TODO homeOrgs needs to be pref hold pickup location

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

        this.getOptInSettings();

        this.formGroup.controls.dob.valueChanges.subscribe((dob: unknown) => {
            if ((dob as Date) > this.juvMinDob) {
                this.isJuvenile = true;
                this.formGroup.controls.guardian.setValidators(Validators.required);
            } else {
                this.isJuvenile = false;
                this.formGroup.controls.guardian.clearValidators();
            }

            this.formGroup.controls.guardian.updateValueAndValidity();
        });

        // Make mailing address fields required if they are different
        // from the billing address.
        this.formGroup.controls.mailingIsSame.valueChanges.subscribe(isSame => {
            ['mailingStreet1', 'mailingCity', 'mailingState', 'mailingZipCode'].forEach(field => {
                let control = this.formGroup.controls[field];
                if (isSame) {
                    control.clearValidators();
                } else {
                    control.setValidators(Validators.required);
                    if (field === 'mailingZipCode') {
                        control.addValidators(Validators.pattern(POST_CODE_REGEX));
                    }
                }
                control.updateValueAndValidity();
            });
        });

        this.formGroup.controls.allEmailNotices.valueChanges.subscribe(val => {
            this.emailSettings.forEach(set => {
                this.formGroup.controls[set.name].setValue(val);
            });
            this.checkNoticeRequiredFields();
        });

        this.formGroup.controls.allTextNotices.valueChanges.subscribe(val => {
            this.textSettings.forEach(set => {
                this.formGroup.controls[set.name].setValue(val);
            });
            this.checkNoticeRequiredFields();
        });

        this.formGroup.controls.allPhoneNotices.valueChanges.subscribe(val => {
            this.phoneSettings.forEach(set => {
                this.formGroup.controls[set.name].setValue(val);
            });
        });

        this.filteredResAddrOptions = this.formGroup.controls.street1.valueChanges.pipe(
            startWith(''),
			debounceTime(300), // Wait for 300ms of inactivity
			distinctUntilChanged(), // Only emit if the value has changed
            switchMap(value => this.resAddrStreet1Filter('' + value)), // Or call API here
        );

        this.filteredMailAddrOptions = this.formGroup.controls.mailingStreet1.valueChanges.pipe(
            startWith(''),
			debounceTime(300), // Wait for 300ms of inactivity
			distinctUntilChanged(), // Only emit if the value has changed
            switchMap(value => this.mailAddrStreet1Filter('' + value)), // Or call API here
        );

    }

    street1AutoSelected(event: MatAutocompleteSelectedEvent) {
        if (event) {
            if (event.option) {
                if (event.option.value) {
                    this.selectedResAddress = event.option.value;
                    return this.populateResAddrFromSuggestion();
                }
            }
        }

        this.selectedResAddress = '';
    }

    mailStreet1AutoSelected(event: MatAutocompleteSelectedEvent) {
        if (event) {
            if (event.option) {
                if (event.option.value) {
                    this.selectedMailAddress = event.option.value;
                    return this.populateMailAddrFromSuggestion();
                }
            }
        }

        this.selectedMailAddress = '';
    }

    populateResAddrFromSuggestion() {
        const addr = this.resAddressSuggestions.filter(a => a.full_string === this.selectedResAddress)[0];

        if (!addr) {
            console.error('Cannot find addr', this.selectedResAddress);
            return;
        }

        this.formGroup.controls.street1.setValue(addr.street_line);
        this.formGroup.controls.city.setValue(addr.city);
        this.formGroup.controls.state.setValue(addr.state);
        this.formGroup.controls.zipCode.setValue(addr.zipcode);

        this.applyHomeOrgFromAddr(addr);
    }

    applyHomeOrgFromAddr(addr: AddressSuggestion): Promise<void> {
        // In theory the tested address should return a single result
        // since the address provided is a normalized value returned
        // from the address API.
        return this.gateway.requestOne(
			'open-ils.rs-addrs',
            'open-ils.rs-addrs.lookup',
            'TODOTODOTODOTODO', // TODO
            {
                street: addr.street_line,
                city: addr.city,
                state: addr.state,
                zipcode: addr.zipcode,
            }
        ).then(found => {
            if (!found) { return; }

            let lat = (found as any).metadata.latitude;
            let long = (found as any).metadata.longitude;

            return this.gateway.requestOne(
                'open-ils.rs-addrs',
                'open-ils.rs-addrs.home-org',
                'TODOTODOTODO', lat, long
            );

        }).then(homeOrg => {
            console.log('Got home org', homeOrg);
            if (homeOrg) {
                this.calculatedHomeOrg = (homeOrg as any).home_ou;
            }
        });
    }

    homeOrgUnit(): Hash {
        return this.app.getOrgUnit(this.calculatedHomeOrg ?? 0) ?? {};
    }

    populateMailAddrFromSuggestion() {
        const addr = this.mailAddressSuggestions.filter(a => a.full_string === this.selectedMailAddress)[0];

        if (!addr) {
            console.error('Cannot find addr', this.selectedMailAddress);
            return;
        }

        this.formGroup.controls.mailingStreet1.setValue(addr.street_line);
        this.formGroup.controls.mailingCity.setValue(addr.city);
        this.formGroup.controls.mailingState.setValue(addr.state);
        this.formGroup.controls.mailingZipCode.setValue(addr.zipcode);
    }

	private resAddrStreet1Filter(value: string): Observable<string[]> {
        this.resAddressSuggestions = [];

        if (value === this.selectedResAddress) {
            return EMPTY;
        }

        return this.addrStreet1Fitler(value, this.resAddressSuggestions);
	}

	private mailAddrStreet1Filter(value: string): Observable<string[]> {
        this.mailAddressSuggestions = [];

        if (value === this.selectedMailAddress) {
            return EMPTY;
        }

        return this.addrStreet1Fitler(value, this.mailAddressSuggestions);
	}

	private addrStreet1Fitler(value: string, suggestions: AddressSuggestion[]): Observable<string[]> {
		const filterValue = value.toLowerCase();

        if (!value || value.length < 5) { return EMPTY; }

        return this.gateway.request(
			'open-ils.rs-addrs',
		    'open-ils.rs-addrs.autocomplete',
            'TODOTODOTODOTODO', // TODO request a session token tied to CAPTCHA
            {"state_filter": "WA", "search": filterValue}
        ).pipe(
            map(suggestion => {
                //console.debug('Found matching address', suggestion);
                let addr: AddressSuggestion = suggestion as AddressSuggestion;
                addr.full_string = `${addr.street_line} ${addr.city}, ${addr.state} ${addr.zipcode}`;
                suggestions.push(addr);
                return addr.full_string;
            }),
            toArray()
        );
	}


    // Note: we could call this after the pickup lib has changed to
    // ensure the setting types are correctly scoped to the org
    // unit.  Not necessary for KCLS at the moment.
    getOptInSettings(): Promise<any> {

        this.emailSettings = [];
        this.phoneSettings = [];
        this.textSettings = [];
        this.printSettings = [];

        // Maybe sort the contents of each grouping...
        return this.gateway.request(
            'open-ils.actor',
            'open-ils.actor.event_def.opt_in.settings.opac_visible'
        ).pipe(tap(setting => {
            let set = setting as UserSettingType;
            let grp = set.grp as string;
            let name = set.name as string;

            if (grp.match(/email/)) {
                this.emailSettings.push(set);
            } else if (grp.match(/phone/)) {
                this.phoneSettings.push(set);
            } else if (grp.match(/text/)) {
                this.textSettings.push(set);
            } else if (grp.match(/print/)) {
                this.printSettings.push(set);
            }

            //console.log('email options', this.emailSettings);

            this.formGroup.addControl(name, new FormControl(false));

        })).toPromise();
    }

    // Sets the email or sms field to required if any email/sms notices
    // are active, or not-required otherwise.
    checkNoticeRequiredFields() {
        let ctl = this.formGroup.controls.email;
        if (this.emailSettings
            .filter(set => this.formGroup.controls[set.name].value).length > 0) {
            // At least one email notice is enabled
            if (!ctl.hasValidator(Validators.required)) {
                ctl.addValidators(Validators.required);
                ctl.updateValueAndValidity();
            }
        } else {
            ctl.clearValidators();
            ctl.updateValueAndValidity();
        }

        ctl = this.formGroup.controls.smsNumber;
        if (this.textSettings
            .filter(set => this.formGroup.controls[set.name].value).length > 0) {
            // At least one text notice is enabled
            if (!ctl.hasValidator(Validators.required)) {
                ctl.addValidators(Validators.required);
                ctl.updateValueAndValidity();
            }
        } else {
            ctl.clearValidators();
            ctl.updateValueAndValidity();
        }
    }

    cancel() {
        window.location.reload();
    }

    // Avoid disabling the submit button for missing values.
    // See submit() for why.
    canSubmit(): boolean {
        if (!this.formGroup.controls.termsOfService.value) {
            return false;
        }

        return true;
    }

    // Returns true if submit can continue
    preSubmit(): boolean {
        this.formNeedsWork = false;

        for (const field in this.formGroup.controls) {

            // Set all form fields to "touched" so that empty+required
            // fields will appear as errors in the form.
            (this.formGroup.controls as any)[field].markAsTouched();

            let fieldErrs = (this.formGroup.controls as any)[field].errors;

            if (fieldErrs) {
                console.debug(field + ' errors:', fieldErrs);
                this.formNeedsWork = true;
                return false;
            }

            if (this.formGroup.errors) {
                console.debug('Form group errors: ', this.formGroup.errors);
                this.formNeedsWork = true;
                return false;
            }
        }

        return true;
    }

    // Map our values to what the API needs and post them to the API.
    submit() {
        this.registerSuccess = false;

        if (!this.preSubmit()) {
            return;
        }

        let ctls = this.formGroup.controls;

        // DOB is just the date, but still needs to be in ISO format.
        const dob = new Date(ctls.dob.value as string);
        const dobstr =
            dob.getFullYear() + '-' +
            ((dob.getMonth() + 1) + '').padStart(2, '0') + '-' +
            (dob.getDate() + '').padStart(2, '0');

        // Reminder that KCLS uses pref_* fields for the legal name
        // when it differs from chosen name.

        let payload: ApiPayload = {
            user: {
                delivery_method: '' + ctls.delivery.value,
                first_given_name: ctls.first.value,
                second_given_name: ctls.middle.value,
                family_name: ctls.last.value,
                pref_first_given_name: ctls.legalFirst.value,
                pref_second_given_name: ctls.legalMiddle.value,
                pref_family_name: ctls.legalLast.value,
                dob: dobstr,
                day_phone: ctls.phone.value,
                email: ctls.email.value,
                home_ou: ctls.homeOrg.value,
                ident_value2: ctls.guardian.value, // KCLS
            },
            billing_address: {
                street1: ctls.street1.value,
                street2: ctls.street2.value,
                city: ctls.city.value,
                state: ctls.state.value,
                post_code: ctls.zipCode.value,
            },
            mailing_address:  {
                street1: ctls.mailingStreet1.value,
                street2: ctls.mailingStreet2.value,
                city: ctls.mailingCity.value,
                state: ctls.mailingState.value,
                post_code: ctls.mailingZipCode.value,
            },
            settings: [
                {name: 'opac.default_sms_notify', value: ctls.smsNumber.value},
            ],
            stat_cats: [
                {stat_cat: STAT_CAT_LIB_NEWS,
                    value: ctls.wantsLibNews.value ? 'Y' : 'N'},
                {stat_cat: STAT_CAT_FOUNDATION_NEWS,
                    value: ctls.wantsFoundationInfo.value ? 'Y' : 'N'},
                {stat_cat: STAT_CAT_CARD_STYLE,
                    value: ctls.design.value ? 'Y' : 'N'}
            ]
        };

        // Propagate the notification settings
        for (const field in ctls) {
            if (field.startsWith('notification.')) {
                if (ctls[field].value === true) {
                    payload.settings.push({name: field, value: true});
                }
            }
        }

        console.debug('SEND', payload);

        return this.gateway.request(
            'open-ils.actor',
            'open-ils.actor.register',
            payload
        ).toPromise().then(r => {
            const response = r as ApiResponse;

            console.debug('RESPONSE', response);

            this.registerSuccess = Number(response.success) > 0;
        });
    }

    cardOptionUrl(name: string): string {
        return `/images/patron_cards/${name}.png`;
    }
}
