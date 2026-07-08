import {AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {Router, ActivatedRoute} from '@angular/router';
import {MatStepper} from '@angular/material/stepper';
import {StepperSelectionEvent} from '@angular/cdk/stepper';
import {FormBuilder, FormControl, Validators, FormRecord} from '@angular/forms';
import {EMPTY, Observable, from, of} from 'rxjs';
import {toArray, debounceTime, distinctUntilChanged, catchError} from 'rxjs/operators';
import {tap} from 'rxjs/operators';
import {map, startWith, switchMap} from 'rxjs/operators';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';
import {RegisterService} from './register.service';
import {CaptchaSessionService} from '../captcha-session.service';
//import {MatStepper} from '@angular/material/stepper';

const JUV_AGE = 18; // years
const DEFAULT_STATE = 'WA';
const POST_CODE_REGEX = /\d{5}/;
const PHONE_REGEX = /\d{3}-\d{3}-\d{4}/;

const STAT_CAT_LIB_NEWS = 3;
const STAT_CAT_FOUNDATION_NEWS = 4;
const STAT_CAT_CARD_STYLE = 10;
const STAT_CAT_DISTRICT_OF_RESIDENCE = 12;

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
    requested_account_type: AccountTypeSelection,
    address_exception_id: number | null,
    user: Hash,
    billing_address: Hash,
    mailing_address:  Hash,
    settings: Hash[],
    stat_cats: Hash[],
}

interface ApiResponse {
    success: number, // Perl
    barcode: string | null,
}

interface AddressSuggestion {
    street_line: string,
    // Unit / apartment designator (e.g. "Apt 4") returned by the address API.
    secondary: string,
    city: string,
    state: string,
    zipcode: string,
    // Number of secondary (unit/apartment) addresses within this primary
    // address.  When > 1 the suggestion is an expandable group.
    entries: number,
    // v2 autocomplete: entry_id identifies an expandable secondary group
    // (entries > 1) and is passed as 'selected' to expand it; smarty_key
    // identifies a single (non-expandable) address.
    entry_id?: string,
    smarty_key?: string,
    full_string?: string,
    home_ou?: number,
    is_exception?: boolean,
    exception_id?: number,
    is_allowed?: boolean,
    district_of_residence?: string,
    is_viable_mailing?: boolean,
    is_viable_residential?: boolean,
}


const MAIN_DISTRICT_OF_RESIDENCE = ' KCLS'; // space is intentional

type AccountTypeSelection = 'ecard' | 'full';

export enum AccountTypeOption {
    Either,
    None,
    Ecard,
    AllAccess
}

@Component({
  templateUrl: './create.component.html',
  styleUrls: ['./create.component.scss']
})
export class RegisterCreateComponent implements OnInit, AfterViewInit {

    @ViewChild('stepper') stepper!: MatStepper;

    // The Address Line 2 (unit) input; focused when it appears for a
    // multi-unit building.
    @ViewChild('resStreet2Input') resStreet2Input?: ElementRef<HTMLInputElement>;

    // Ordered URL slug for each stepper section.  Tracks the section
    // currently reflected in the URL so we can avoid redundant navigation.
    currentSlug = 'your-information';

    minDob = new Date("1900-01-01");
    maxDob = new Date();

    isJuvenile = false;
    juvMinDob: Date;

    formNeedsWork = false;
    pickupLibs: Hash[] = [];
    districtOfResidence: null | string = null;

    calculatedHomeOrg: number | null = null;
    addressExceptionId: number | null = null;

    reportedLatitude: string | number | null = null;
    reportedLongitude: string | number | null = null;

    // Make the enum visible in the template
    AccountTypeOption = AccountTypeOption;

    accountTypeSelection: AccountTypeSelection | null = null;
    accountTypeOption = AccountTypeOption.None;

    emailSettings: UserSettingType[] = [];
    phoneSettings: UserSettingType[] = [];
    textSettings: UserSettingType[] = [];
    printSettings: UserSettingType[] = [];

    resAddressSuggestions: AddressSuggestion[] = [];
    selectedResAddress = '';

    // Residential address selection state.  Suggestions populate from the
    // street field (debounced) and appear as a dropdown; choosing one fills
    // the structured (read-only) fields and resolves the home library.
    addressSelected = false;
    resLookupNotFound = false;
    resLookupLoading = false;

    // Entry count of the chosen residential address.  When > 1 the address is
    // a multi-unit building and Address Line 2 (unit) becomes required.
    selectedResEntries = 0;

    // Result of validating an entered unit against the address service:
    // null = not checked, true = matched (show a check), false = no match.
    resUnitValid: boolean | null = null;

    // Set when the chosen residential address is not usable as a residence
    // (e.g. a commercial address, PO box, or mail-receiving agency).
    resAddressNotViable = false;

    mailAddressSuggestions: AddressSuggestion[] = [];
    selectedMailAddress = '';

    // Mailing address selection state (mirrors the residential fields).
    mailAddressSelected = false;
    mailLookupNotFound = false;
    mailLookupLoading = false;

    // Set when the chosen mailing address is not usable for mail delivery.
    mailAddressNotViable = false;

    maybeDupeAccount: boolean | null = null;

    cardOptions = [
        '2025-Barry-Johnson',
        '2025-Bethany-Fackrell',
        '2025-Invisible-Creature',
        '2025-Hernan-Paganini',
        '2025-Marisol-Ortega',
        '2025-Stacy-Nguyen',
        '2025-Stevie-Shao',
    ];

    cardDescriptions: {[key: string]: string} = {
        '2025-Barry-Johnson': $localize`A portrait of everyday Black life, illustrated by Barry Johnson`,
        '2025-Bethany-Fackrell': $localize`Salmon rendered in Coast Salish formline art, illustrated by Bethany Fackrell`,
        '2025-Invisible-Creature': $localize`A Pacific Northwest legend brought to life, illustrated by Don Clark`,
        '2025-Hernan-Paganini': $localize`An abstract multicultural flow, illustrated by Hernan Paganini`,
        '2025-Marisol-Ortega': $localize`Tile patterns inspired by Michoacán, Mexico, illustrated by Marisol Ortega`,
        '2025-Stacy-Nguyen': $localize`A joyful outdoor gathering of community (and dogs!), illustrated by Stacy Nguyen`,
        '2025-Stevie-Shao': $localize`Folk art wildlife nodding to environmental stewardship, illustrated by Stevie Shao`,
    };

    formGroup = this.formBuilder.record({
        design: ['', Validators.required],
        delivery: ['Mail', Validators.required],
        first: ['', {
            validators: [Validators.required],
            updateOn: 'blur'
        }],
        middle: '',
        last: ['', {
            validators: [Validators.required],
            updateOn: 'blur'
        }],
        legalIsSame: true,
        legalFirst: ['', {updateOn: 'blur'}],
        legalMiddle: '',
        legalLast: ['', {updateOn: 'blur'}],
        dob: ['', {
            validators: [Validators.required],
            updateOn: 'blur'
        }],
        guardian: '',
        phone: ['', [Validators.required, Validators.pattern(PHONE_REGEX)]],
        email: ['', Validators.email],
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
        pickupLib: 0,
        smsNumber: [{value: '', disabled: true}],
        smsIsSame: true,
        selectedAccountType: '',
    });

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
        private route: ActivatedRoute,
        private gateway: Gateway,
        private formBuilder: FormBuilder,
        private app: AppService,
        private settings: Settings,
        public register: RegisterService,
        private cdRef: ChangeDetectorRef,
        private captcha: CaptchaSessionService,
    ) {
        this.juvMinDob = new Date();
        this.juvMinDob.setFullYear(new Date().getFullYear() - JUV_AGE);
    }

    // All kcls.address.* calls require a CAPTCHA-minted session token as
    // their first parameter.  These helpers inject the current token
    // (minting one on demand) so call sites don't repeat the plumbing.
    private addressRequest(method: string, ...params: unknown[]): Observable<unknown> {
        return from(this.captcha.getToken()).pipe(
            switchMap(token => this.gateway.request('kcls.address', method, token, ...params))
        );
    }

    private addressRequestOne(method: string, ...params: unknown[]): Promise<unknown> {
        return this.captcha.getToken().then(token =>
            this.gateway.requestOne('kcls.address', method, token, ...params));
    }

    ngAfterViewInit() {
        // The stepper isn't available while ngOnInit handles the initial
        // route, so apply the section requested by the URL here.
        const index = this.stepSlugs.indexOf(this.currentSlug);
        if (index > 0) {
            this.stepper.selectedIndex = index;
        }
        this.cdRef.detectChanges();
    }

    // URL slugs for each rendered stepper section, in order.  The
    // "My Library Card" section only exists for all-access applicants,
    // mirroring the *ngIf on that mat-step so slug<->index stays aligned.
    get stepSlugs(): string[] {
        const slugs = ['your-information', 'eligibility', 'communication-preferences'];
        if (this.wantsAllAccess()) { slugs.push('my-library-card'); }
        slugs.push('review');
        return slugs;
    }

    // Stepper -> URL: navigate when the active section changes (Back /
    // Continue buttons, review-page Edit buttons, or step-header clicks).
    onStepChange(event: StepperSelectionEvent) {
        const slug = this.stepSlugs[event.selectedIndex];
        if (slug && slug !== this.currentSlug) {
            this.router.navigate(['/register/create', slug]);
        }
    }

    // The Your Information pane can't be left until the residential address
    // resolves a home library and, when the mailing address differs, a
    // mailing address has been chosen too.  (Other panes are unrestricted.)
    canContinue(): boolean {
        if (this.stepper?.selectedIndex !== 0) { return true; }

        const mailingOk =
            !!this.formGroup.controls.mailingIsSame.value ||
            (!!this.selectedMailAddress && !this.mailAddressNotViable);

        // Multi-unit buildings require an Address Line 2 (unit) value.
        const street2Ok =
            this.selectedResEntries <= 1 || !!this.formGroup.controls.street2.value;

        return this.calculatedHomeOrg != null && mailingOk && street2Ok;
    }

    ngOnInit() {

        // Mint a CAPTCHA session token up front so the first address lookup
        // doesn't wait on the challenge.  Errors surface when a call needs it.
        this.captcha.getToken().catch(() => {});

        // URL -> stepper: keep the active section in sync with the route
        // so deep links and the browser back/forward buttons work.
        this.route.paramMap.subscribe(params => {
            const slug = params.get('step') || 'your-information';
            const index = this.stepSlugs.indexOf(slug);

            if (index < 0) {
                // Unknown or currently-unavailable section; reset to the start.
                this.router.navigate(
                    ['/register/create', 'your-information'], {replaceUrl: true});
                return;
            }

            // The residential street address drives eligibility and the
            // home-library lookup, so don't allow advancing past the first
            // section until it's provided.
            if (slug !== 'your-information' && !this.formGroup.controls.street1.value) {
                this.router.navigate(
                    ['/register/create', 'your-information'], {replaceUrl: true});
                return;
            }

            this.currentSlug = slug;

            // During the initial navigation the stepper view isn't ready
            // yet; ngAfterViewInit applies the starting section instead.
            if (this.stepper && this.stepper.selectedIndex !== index) {
                this.stepper.selectedIndex = index;
            }
        });

        this.loadPickupLibs();

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

        // Fire the duplicate account checker
        // street1 is handled in populateResAddrFromSuggestion()
        this.formGroup.controls.first.valueChanges.subscribe(val => this.checkForExistingAccount());
        this.formGroup.controls.last.valueChanges.subscribe(val => this.checkForExistingAccount());
        this.formGroup.controls.legalFirst.valueChanges.subscribe(val => this.checkForExistingAccount());
        this.formGroup.controls.legalLast.valueChanges.subscribe(val => this.checkForExistingAccount());
        this.formGroup.controls.dob.valueChanges.subscribe(val => this.checkForExistingAccount());

        this.formGroup.controls.allEmailNotices.valueChanges.subscribe(val => {
            this.emailSettings.forEach(set => {
                this.formGroup.controls[set.name].setValue(val);
            });
            this.checkContactInfoRequired();
        });

        this.formGroup.controls.allTextNotices.valueChanges.subscribe(val => {
            this.textSettings.forEach(set => {
                this.formGroup.controls[set.name].setValue(val);
            });
            this.checkContactInfoRequired();
        });

        this.formGroup.controls.allPhoneNotices.valueChanges.subscribe(val => {
            this.phoneSettings.forEach(set => {
                this.formGroup.controls[set.name].setValue(val);
            });
            this.checkContactInfoRequired();
        });

        this.formGroup.controls.email.valueChanges.subscribe(val => {
            this.checkContactInfoRequired();
        });

        this.formGroup.controls.phone.valueChanges.subscribe(val => {
            // When the SMS number mirrors the phone number, keep it in sync.
            if (this.formGroup.controls.smsIsSame.value) {
                this.formGroup.controls.smsNumber.setValue(val, {emitEvent: false});
            }
            this.checkContactInfoRequired();
        });

        // "Same for text/SMS": mirror the phone number into the SMS field
        // when checked; clear it so the user can supply a different number
        // when unchecked.
        this.formGroup.controls.smsIsSame.valueChanges.subscribe(isSame => {
            const phone = this.formGroup.controls.phone.value;
            this.formGroup.controls.smsNumber.setValue(isSame ? phone : '', {emitEvent: false});
            if (isSame) {
                this.formGroup.controls.smsNumber.disable();
            } else {
                this.formGroup.controls.smsNumber.enable();
            }
        });

        this.formGroup.controls.selectedAccountType.valueChanges.subscribe(val => {
            this.checkContactInfoRequired();

            // Card design is not required for ecards
            const design = this.formGroup.controls.design;
            if (this.wantsEcard()) {
                design.clearValidators();
            } else if (!design.hasValidator(Validators.required)) {
                design.addValidators(Validators.required);
            }

            design.updateValueAndValidity();
        });

        // Editing the street after an address was chosen invalidates that
        // choice: de-select it and clear the values it applied.  Fires
        // immediately (no debounce); programmatic writes use emitEvent:false
        // so applying a selection doesn't trip this.
        this.formGroup.controls.street1.valueChanges.subscribe(() => {
            if (this.selectedResAddress) {
                this.deselectResAddress();
            }
        });

        // Street Address is the only address field shown; its value drives
        // the suggestion lookup (debounced).  Choosing a suggestion is what
        // resolves the home library / district and fills in the hidden
        // city/state/zip controls.
        this.formGroup.controls.street1.valueChanges.pipe(
            startWith(''),
            debounceTime(500),
            map(() => this.resSearchValue()),
            distinctUntilChanged(),
            switchMap(value => {
                this.resAddressSuggestions = [];
                this.resLookupNotFound = false;

                if (value.length < 5) {
                    this.resLookupLoading = false;
                    return of([] as string[]);
                }

                this.resLookupLoading = true;
                // catchError keeps the stream alive (and clears the spinner)
                // if the address API fails.
                return this.addrStreet1Fitler(value, this.resAddressSuggestions).pipe(
                    catchError(() => of([] as string[]))
                );
            }),
        ).subscribe(() => {
            this.resLookupLoading = false;
            this.resLookupNotFound =
                this.resAddressSuggestions.length === 0 && this.resSearchValue().length >= 5;
        });

        // Entering/editing the unit (Address Line 2) re-runs the lookup with
        // that secondary value to confirm the final form of the address
        // (viability, coordinates, home library, district).  Programmatic
        // writes use emitEvent:false so they don't trip this.
        this.formGroup.controls.street2.valueChanges.pipe(
            debounceTime(500),
            distinctUntilChanged(),
        ).subscribe(() => {
            if (this.addressSelected) {
                this.confirmResUnit();
            }
        });

        // Mailing address uses the same single-field + suggestion pattern as
        // the residential address (minus the home-library lookup).
        this.formGroup.controls.mailingStreet1.valueChanges.subscribe(() => {
            if (this.selectedMailAddress) {
                this.deselectMailAddress();
            }
        });

        this.formGroup.controls.mailingStreet1.valueChanges.pipe(
            startWith(''),
            debounceTime(500),
            map(() => this.mailSearchValue()),
            distinctUntilChanged(),
            switchMap(value => {
                this.mailAddressSuggestions = [];
                this.mailLookupNotFound = false;

                if (value.length < 5) {
                    this.mailLookupLoading = false;
                    return of([] as string[]);
                }

                this.mailLookupLoading = true;
                return this.addrStreet1Fitler(value, this.mailAddressSuggestions).pipe(
                    catchError(() => of([] as string[]))
                );
            }),
        ).subscribe(() => {
            this.mailLookupLoading = false;
            this.mailLookupNotFound =
                this.mailAddressSuggestions.length === 0 && this.mailSearchValue().length >= 5;
        });
    }

    checkForExistingAccount() {
        let controls = this.formGroup.controls;

        if (   !controls.first.value
            || !controls.last.value
            || !controls.dob.value
            || !controls.street1.value) {
            return;
        }

        this.captcha.getToken().then(token => {
            this.gateway.requestOne(
                'open-ils.actor',
                'open-ils.actor.register.has_account',
                token, {
                    first_given_name: controls.first.value,
                    family_name: controls.last.value,
                    dob: controls.dob.value,
                    street1: controls.street1.value
                }
            ).then(resp => {

                if (Number(resp) === 1) {
                    console.debug('Possible existing account found');
                    this.maybeDupeAccount = true;
                    return;
                }

                this.maybeDupeAccount = false;

                // If the user has legal name values, do a secondary lookup
                // on the legal names.
                if (controls.legalFirst.value || controls.legalLast.value) {

                    let first = controls.first.value || controls.legalFirst.value;
                    let last = controls.last.value || controls.legalLast.value;

                    this.gateway.requestOne(
                        'open-ils.actor',
                        'open-ils.actor.register.has_account',
                        token, {
                            first_given_name: first,
                            family_name: last,
                            dob: controls.dob.value,
                            street1: controls.street1.value
                        }
                    ).then(resp => {
                        this.maybeDupeAccount = Number(resp) === 1;
                        if (this.maybeDupeAccount) {
                            console.debug('Possible existing account found');
                        }
                    });
                }
            });
        });
    }

    loadPickupLibs(): Promise<Hash[]> {
        if (this.pickupLibs.length > 0) {
            return Promise.resolve(this.pickupLibs);
        }

        // Users are allowed to select a hold pickup lib from the set of
        // org units where the opac.holds.org_unit_not_pickup_lib setting
        // is false/unset and the org unit is "can have vols"
        return this.app.getOrgTree().then(tree => {
            return this.settings.settingValueForOrgs('opac.holds.org_unit_not_pickup_lib')
            .then((list: Hash[]) => {
                list.forEach(setting => {
                    if (!(setting.summary as Hash).value) {
                        let org = this.app.getOrgUnit(setting.org_unit as number);
                        if (org && (org.ou_type as Hash).can_have_vols === 't') {
                            org.id = Number(org.id);
                            this.pickupLibs.push(org);
                        }
                    }
                });

                this.pickupLibs = this.pickupLibs.sort((a: Hash, b: Hash) =>
                    (a.name as string) < (b.name as string) ? -1 : 1);

                return this.pickupLibs;
            });
        });
    }

    populateResAddrFromSuggestion(addr: AddressSuggestion) {
        const c = this.formGroup.controls;

        // Suppress value-change events so writing these fields doesn't
        // re-trigger the suggestion lookup (which would clear the selection).
        c.street1.setValue(addr.street_line, {emitEvent: false});

        // Multi-unit buildings: the user supplies the unit in Address Line 2.
        // A specific result carries its own secondary (unit) designator.
        const street2 = addr.entries > 1 ? '' : (addr.secondary || '');
        c.street2.setValue(street2, {emitEvent: false});

        c.city.setValue(addr.city, {emitEvent: false});
        c.state.setValue(addr.state, {emitEvent: false});
        c.zipCode.setValue(addr.zipcode, {emitEvent: false});

        // Now that we have an address, run the dupe checker again.
        this.checkForExistingAccount();

        this.applyHomeOrgFromAddr(addr);
    }

    // Look up the normalized details for a chosen address.  The response
    // carries the geocode (metadata.latitude/longitude) plus viability flags
    // (is_viable_residential / is_viable_mailing).
    lookupAddress(addr: AddressSuggestion): Promise<any> {
        return this.addressRequestOne('kcls.address.lookup', {
            street: addr.street_line,
            secondary: addr.secondary,
            city: addr.city,
            state: addr.state,
            zipcode: addr.zipcode,
        });
    }

    applyHomeOrgFromAddr(addr: AddressSuggestion): Promise<any> {
        this.calculatedHomeOrg = null;
        this.districtOfResidence = null;
        this.reportedLatitude = null;
        this.reportedLongitude = null;
        this.addressExceptionId = null;
        this.resAddressNotViable = false;
        this.resUnitValid = null;

        if (addr.is_exception) {
            // Address exceptions contain the calcualted home org and
            // district of residence values.  For blocked exception
            // addresses, no value will be present, and that's intentional.
            console.log('Found address exception: ', addr);
            this.addressExceptionId = Number(addr.exception_id);

            if (addr.is_allowed) {
                this.applyOrgAndDistrictValues(addr.home_ou || null, addr.district_of_residence || null);
                return Promise.resolve();

            } else {
                // For blocked addressed, apply a home org value so the
                // user can continue to the next page, where they'll
                // be told the address is not in the service area, since
                // it does not have a district of residence.
                return this.app.getOrgTree().then(root => this.calculatedHomeOrg = Number(root.id));
            }
        }

        // In theory the tested address should return a single result
        // since the address provided is a normalized value returned
        // from the address API.
        return this.lookupAddress(addr).then(found => {
            if (!found) { return; }

            console.debug('Address lookup returned', found);

            if ((found as any).is_viable_residential === false) {
                // Not usable as a residence; surface a message and skip the
                // home-org / district lookups, which don't apply.  With no
                // home org resolved the user cannot continue.
                this.resAddressNotViable = true;
                return;
            }

            // Addresses that require a secondary (multi-unit buildings) must
            // resolve to a valid unit before we set the home library etc.
            // The service reports has_valid_secondary once the supplied unit
            // matches; until then leave the home org unresolved so the user
            // can't continue (they must enter a valid Address Line 2).
            const hasValidSecondary = !!(found as any).has_valid_secondary;
            const requiresSecondary = this.selectedResEntries > 1;
            const enteredUnit = ('' + (this.formGroup.controls.street2.value ?? '')).trim();

            // Once a unit has been entered, flag whether it matched so the UI
            // can show a check (valid) or a "no match" message (invalid).
            if (requiresSecondary) {
                this.resUnitValid = enteredUnit ? hasValidSecondary : null;
            }

            if (requiresSecondary && !hasValidSecondary) {
                return;
            }

            // With a validated unit, reflect the service's normalized secondary
            // (e.g. "Apt AA1001") back into Address Line 2.  emitEvent:false so
            // this doesn't re-trigger the unit lookup.
            const comp = (found as any).components || {};
            if ((found as any).has_valid_secondary && comp.secondary_number) {
                const unit = [comp.secondary_designator, comp.secondary_number]
                    .filter(Boolean).join(' ');
                this.formGroup.controls.street2.setValue(unit, {emitEvent: false});
            }

            const latitude = (found as any).metadata.latitude;
            const longitude = (found as any).metadata.longitude;

            // Debugging
            this.reportedLatitude = latitude;
            this.reportedLongitude = longitude;

            return Promise.all([
                this.addressRequestOne('kcls.address.home-org', latitude, longitude),
                this.addressRequestOne('kcls.address.district-of-residence', latitude, longitude)
            ]).then(([homeOrg, district]) => {
                this.applyOrgAndDistrictValues(homeOrg as number, district as string);
            });
        });
    }

    applyOrgAndDistrictValues(homeOrg: number | null, district: string | null) {
        console.debug('Home org unit reported as', homeOrg);
        console.debug('District of Residence reported as "' + district + '"');

        if (homeOrg) {
            this.calculatedHomeOrg = Number(homeOrg);

            if (!this.formGroup.controls.pickupLib.value) {
                console.debug('Applying default pickup lib', this.calculatedHomeOrg);
                this.formGroup.controls.pickupLib.setValue(this.calculatedHomeOrg);
            }
        }

        if (district) {
            this.districtOfResidence = district as string;
            if (district === MAIN_DISTRICT_OF_RESIDENCE) {
                this.accountTypeOption = AccountTypeOption.Either;
            } else {
                this.accountTypeOption = AccountTypeOption.AllAccess;
            }
        }
    }

    wantsEcard(): boolean {
        return this.formGroup.controls.selectedAccountType.value == AccountTypeOption.Ecard;
    }

    wantsAllAccess(): boolean {
        return this.formGroup.controls.selectedAccountType.value == AccountTypeOption.AllAccess;
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

        // Suppress events so applying a selection doesn't re-trigger the
        // lookup / immediate de-select (see residential equivalent).
        this.formGroup.controls.mailingStreet1.setValue(addr.street_line, {emitEvent: false});
        this.formGroup.controls.mailingStreet2.setValue(addr.secondary || '', {emitEvent: false});
        this.formGroup.controls.mailingCity.setValue(addr.city, {emitEvent: false});
        this.formGroup.controls.mailingState.setValue(addr.state, {emitEvent: false});
        this.formGroup.controls.mailingZipCode.setValue(addr.zipcode, {emitEvent: false});
    }

    // Search string for the mailing address lookup.
    mailSearchValue(): string {
        return ('' + (this.formGroup.controls.mailingStreet1.value ?? '')).trim();
    }

    // Choose a mailing suggestion.  A building with multiple entries is
    // drilled into via a second autocomplete; otherwise the address is
    // applied and the chooser collapses.
    selectMailAddress(addr: AddressSuggestion) {
        if (addr.entries > 1) {
            this.refineMailAddress(addr);
            return;
        }

        this.selectedMailAddress = addr.full_string || '';
        this.populateMailAddrFromSuggestion();
        this.mailAddressSelected = true;
        this.checkMailingViability(addr);
    }

    // Verify the chosen mailing address is usable for mail delivery.
    checkMailingViability(addr: AddressSuggestion): Promise<any> {
        this.mailAddressNotViable = false;

        return this.lookupAddress(addr).then(found => {
            if (!found) { return; }
            if ((found as any).is_viable_mailing === false) {
                this.mailAddressNotViable = true;
            }
        });
    }

    // Mailing equivalent of refineResAddress: drill into the unit/apartment
    // entries of a multi-entry address via the API's secondary expansion.
    refineMailAddress(addr: AddressSuggestion) {
        const search = `${addr.street_line} ${addr.secondary} `;
        const selected =
            `${addr.street_line} ${addr.secondary} (${addr.entries}) `
            + `${addr.city} ${addr.state} ${addr.zipcode}`;

        // Keep the chooser open (no final selection yet) and show progress.
        this.selectedMailAddress = '';
        this.mailAddressSelected = false;
        this.mailLookupNotFound = false;
        this.mailLookupLoading = true;
        this.mailAddressSuggestions = [];

        this.addrStreet1Fitler(search, this.mailAddressSuggestions, selected).pipe(
            catchError(() => of([] as string[]))
        ).subscribe(() => {
            this.mailLookupLoading = false;
            this.mailLookupNotFound = this.mailAddressSuggestions.length === 0;
        });
    }

    changeMailAddress() {
        this.mailAddressSelected = false;
    }

    deselectMailAddress() {
        this.mailAddressSelected = false;
        this.selectedMailAddress = '';
        this.mailAddressNotViable = false;

        const c = this.formGroup.controls;
        c.mailingStreet2.setValue('', {emitEvent: false});
        c.mailingCity.setValue('', {emitEvent: false});
        c.mailingState.setValue(DEFAULT_STATE, {emitEvent: false});
        c.mailingZipCode.setValue('', {emitEvent: false});
    }

    // Search string for the residential address lookup.  Street Address is
    // the only address field the user enters directly.
    resSearchValue(): string {
        return ('' + (this.formGroup.controls.street1.value ?? '')).trim();
    }

    // The suggestion dropdown is visible while searching, or when results
    // exist, and no address has been chosen yet.  Once an address is selected
    // the dropdown collapses; editing the street field re-opens it.
    showResSuggestions(): boolean {
        return !this.addressSelected &&
            (this.resLookupLoading || this.resAddressSuggestions.length > 0);
    }

    // Choose a suggestion: fill the structured fields and resolve the home
    // library / district.  A multi-unit building (entries > 1) is applied as
    // its base address; the user then supplies the unit in Address Line 2.
    selectResAddress(addr: AddressSuggestion) {
        this.selectedResAddress = addr.full_string || '';
        this.selectedResEntries = addr.entries || 0;
        this.populateResAddrFromSuggestion(addr);
        this.applyResStreet2Validator();
        this.addressSelected = true;

        // A required unit needs entry; focus Address Line 2 once it renders.
        if (this.selectedResEntries > 1) {
            setTimeout(() => this.resStreet2Input?.nativeElement.focus());
        }
    }

    // Address Line 2 (unit) is required when the chosen address is a
    // multi-unit building.
    applyResStreet2Validator() {
        const s2 = this.formGroup.controls.street2;
        if (this.selectedResEntries > 1) {
            s2.setValidators(Validators.required);
        } else {
            s2.clearValidators();
        }
        s2.updateValueAndValidity({emitEvent: false});
    }

    // Address Line 2 is shown for multi-unit buildings (where a unit is
    // required) and whenever the selected address already carries a
    // secondary (unit) value.
    showResStreet2(): boolean {
        return this.addressSelected &&
            (this.selectedResEntries > 1 || !!this.formGroup.controls.street2.value);
    }

    // Re-run the address lookup using the entered unit (Address Line 2) as the
    // secondary value, confirming the final form of the selected address.
    confirmResUnit() {
        const c = this.formGroup.controls;
        const str = (v: unknown): string => '' + (v ?? '');
        const addr: AddressSuggestion = {
            street_line: str(c.street1.value),
            secondary: str(c.street2.value),
            city: str(c.city.value),
            state: str(c.state.value),
            zipcode: str(c.zipCode.value),
            entries: 0,
        };
        this.applyHomeOrgFromAddr(addr);
    }

    // Drop a previously chosen address and clear everything derived from it.
    // Called when the user edits the street again after a selection.
    deselectResAddress() {
        this.addressSelected = false;
        this.selectedResAddress = '';
        this.selectedResEntries = 0;
        this.resAddressNotViable = false;
        this.resUnitValid = null;
        this.calculatedHomeOrg = null;
        this.districtOfResidence = null;
        this.reportedLatitude = null;
        this.reportedLongitude = null;
        this.accountTypeOption = AccountTypeOption.None;

        const c = this.formGroup.controls;
        c.street2.setValue('', {emitEvent: false});
        c.street2.clearValidators();
        c.street2.updateValueAndValidity({emitEvent: false});
        c.city.setValue('', {emitEvent: false});
        c.state.setValue(DEFAULT_STATE, {emitEvent: false});
        c.zipCode.setValue('', {emitEvent: false});
    }

    private addrStreet1Fitler(
        value: string, suggestions: AddressSuggestion[],
        selected?: string): Observable<string[]> {
        const filterValue = value.toLowerCase();

        if (!value || value.length < 5) { return EMPTY; }

        // NOTE: do not clear residential-only state (calculatedHomeOrg,
        // district, lat/long) here — this helper is shared by the mailing
        // lookup too.  The residential edit path clears it via
        // deselectResAddress().

        // No result limit is sent; we use the API default and cap the
        // display to the first 10 in the template.
        const search: Hash = {
            "state_filter": "WA",
            "search": filterValue,
            // base-address prevents the base address of a multi-unit location
            // (apts, etc.) from being included.  It has not value to us.
            // Direct pass-thru to Smarty.
            "exclude": "base-address",
            // We don't want to see entries for the office address of a
            // multi-unit address.
            "exclude_ofc": true
        };

        // 'selected' drives the API's secondary (unit/apartment) expansion.
        if (selected) { search['selected'] = selected; }

        return this.addressRequest('kcls.address.autocomplete', search).pipe(
            map(suggestion => {
                // console.debug('Found matching address', suggestion);
                let addr: AddressSuggestion = suggestion as AddressSuggestion;

                if (addr.entries > 1) {
                    // A building with multiple unit/apartment entries.  Show
                    // the entry count so the user knows to refine further.
                    addr.full_string =
                        `${addr.street_line} ${addr.secondary} (${addr.entries}) `
                        + `${addr.city}, ${addr.state} ${addr.zipcode}`;
                } else {
                    const secondary = addr.secondary ? `${addr.secondary} ` : '';
                    addr.full_string =
                        `${addr.street_line} ${secondary}${addr.city}, ${addr.state} ${addr.zipcode}`;
                }

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

            this.formGroup.addControl(name, new FormControl(false));

        })).toPromise();
    }

    wantsPhoneNotices(): boolean {
        return this.phoneSettings.some(set => this.formGroup.controls[set.name].value);
    }

    wantsEmailNotices(): boolean {
        return this.emailSettings.some(set => this.formGroup.controls[set.name].value);
    }

    wantsTextNotices(): boolean {
        return this.textSettings.some(set => this.formGroup.controls[set.name].value);
    }


    // Determines if a contact type (phone/email/etc) is required based
    // on notice and account type prerences.
    checkContactInfoRequired() {
        let emailCtl = this.formGroup.controls.email;
        let phoneCtl = this.formGroup.controls.phone;
        let smsCtl = this.formGroup.controls.smsNumber;

        let emailRequired = (
            this.wantsEcard() ||
            this.wantsEmailNotices() ||
            (this.wantsAllAccess() && !this.formGroup.controls.phone.value)
        );

        let phoneRequired = (
            this.wantsPhoneNotices() ||
            (this.wantsAllAccess() && !this.formGroup.controls.email.value)
        );

        let smsRequired = this.wantsTextNotices();

        if (emailCtl.hasValidator(Validators.required)) {
            if (!emailRequired) {
                emailCtl.clearValidators();
                emailCtl.updateValueAndValidity();
            }
        } else if (emailRequired) {
            emailCtl.addValidators(Validators.required);
            emailCtl.updateValueAndValidity();
        }

        if (phoneCtl.hasValidator(Validators.required)) {
            if (!phoneRequired) {
                phoneCtl.clearValidators();
                phoneCtl.updateValueAndValidity();
            }
        } else if (phoneRequired) {
            phoneCtl.addValidators(Validators.required);
            phoneCtl.updateValueAndValidity();
        }

        if (smsCtl.hasValidator(Validators.required)) {
            if (!smsRequired) {
                smsCtl.clearValidators();
                smsCtl.updateValueAndValidity();
            }
        } else if (smsRequired) {
            smsCtl.addValidators(Validators.required);
            smsCtl.updateValueAndValidity();
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
        this.register.registerResult.complete = false;
        this.register.registerResult.success = false;
        this.register.registerResult.barcode = null;

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
            // If the user reaches the submit page, they are allowed to
            // request at least one of these account types.
            requested_account_type: this.wantsEcard() ? 'ecard' : 'full',
            address_exception_id: this.addressExceptionId,
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
                home_ou: this.homeOrgUnit().id,
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
                {name: 'opac.default_pickup_location', value: ctls.pickupLib.value},
            ],
            stat_cats: [
                {stat_cat: STAT_CAT_LIB_NEWS,
                    value: ctls.wantsLibNews.value ? 'Y' : 'N'},
                {stat_cat: STAT_CAT_FOUNDATION_NEWS,
                    value: ctls.wantsFoundationInfo.value ? 'Y' : 'N'},
                {stat_cat: STAT_CAT_CARD_STYLE, value: ctls.design.value},
            ]
        };

        if (this.districtOfResidence) {
            payload.stat_cats.push(
                {stat_cat: STAT_CAT_DISTRICT_OF_RESIDENCE, value: this.districtOfResidence}
            );
        }

        // Propagate the notification settings
        for (const field in ctls) {
            if (field.startsWith('notification.')) {
                if (ctls[field].value === true) {
                    payload.settings.push({name: field, value: true});
                }
            }
        }

        console.debug('SEND', payload);

        return this.captcha.getToken().then(token =>
            this.gateway.requestOne(
                'open-ils.actor',
                'open-ils.actor.register',
                token,
                payload
            )
        ).then(r => {
            const response = r as ApiResponse;

            console.debug('RESPONSE', response);

            this.register.registerResult = {
                complete: true,
                success: Number(response.success) > 0,
                barcode: response.barcode || null,
                accountType: this.wantsEcard() ? 'ecard' : 'full',
                deliveryMethod: '' + ctls.delivery.value,
                homeOrgName: this.homeOrgUnit().name as string || '',
            };

            this.router.navigate(['/register/complete']);
        });
    }

    cardOptionUrl(name: string): string {
        return `/images/patron_cards/${name}.png`;
    }

    cardDescription(name: string): string {
        return this.cardDescriptions[name] ?? '';
    }

    pickupLibName(): string {
        const id = this.formGroup.controls.pickupLib.value;
        return this.pickupLibs.find(l => l['id'] === id)?.['name'] as string ?? '';
    }
}
