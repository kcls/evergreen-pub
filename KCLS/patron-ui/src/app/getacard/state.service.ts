import {Injectable} from '@angular/core';
import {AbstractControl, FormBuilder, FormRecord, Validators} from '@angular/forms';
import {Observable, from} from 'rxjs';
import {debounceTime, distinctUntilChanged, map, switchMap, toArray} from 'rxjs/operators';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';
import {CaptchaSessionService} from '../captcha-session.service';

const MAIN_DISTRICT_OF_RESIDENCE = ' KCLS'; // space is intentional
const JUV_AGE = 18; // years
const PHONE_REGEX = /\d{3}-\d{3}-\d{4}/;

const STAT_CAT_LIB_NEWS = 3;
const STAT_CAT_FOUNDATION_NEWS = 4;
const STAT_CAT_CARD_STYLE = 10;
const STAT_CAT_DISTRICT_OF_RESIDENCE = 12;

export interface UserSettingType {
    name: string;
    label: string;
    grp: string;
}

export interface GacRegisterResult {
    complete: boolean;
    success: boolean;
    barcode: string | null;
    accountType: string;
    deliveryMethod: string;
    homeOrgName: string;
}

// What the address makes the patron eligible for.
export type AccountTypeOption = 'either' | 'all-access' | null;

// The account type requested, matching the register API's values.
export type AccountType = 'ecard' | 'full' | null;

export interface AddressSuggestion {
    street_line: string;
    secondary: string;
    city: string;
    state: string;
    zipcode: string;
    entries: number;
    entry_id?: string;
    smarty_key?: string;
    is_exception?: boolean;
    exception_id?: number;
    is_allowed?: boolean;
    home_ou?: number;
    district_of_residence?: string;
}

export interface GacStep {
    slug: string;
    label: string;
}

// The registration flow, one decision per step.  The address comes first
// because it gates everything else (eligibility, account types, card step).
export const GAC_STEPS: GacStep[] = [
    {slug: 'address', label: $localize`Where do you live?`},
    {slug: 'account', label: $localize`Choose your account`},
    {slug: 'about-you', label: $localize`About you`},
    {slug: 'contact', label: $localize`Stay in touch`},
    {slug: 'card', label: $localize`My Library Card`},
    {slug: 'review', label: $localize`Review & submit`},
];

/**
 * Cross-step registration state plus the token-injected address API calls.
 * Step components hold only their transient UI state; anything another step
 * (or the final payload) needs lives here.
 */
@Injectable()
export class GetacardState {

    // Set from the ?kiosk query param; drives shorter idle timeouts (and,
    // eventually, kiosk-specific display tweaks).
    inKioskMode = false;

    // --- Where do you live? ------------------------------------------------

    // The chosen suggestion; null while still searching.
    address: AddressSuggestion | null = null;
    addressSelected = false;

    // Unit/apartment handling for multi-unit buildings.
    unitRequired = false;
    unitValid: boolean | null = null;
    street2 = '';

    // Async + outcome state for the verification lookup.
    verifying = false;
    notViable = false;
    blocked = false;

    // Resolved eligibility values.
    homeOrgId: number | null = null;
    homeOrgName = '';
    district: string | null = null;
    accountTypeOption: AccountTypeOption = null;
    exceptionId: number | null = null;

    // --- Choose your account -----------------------------------------------

    // The requested account type.  Chosen by the user when the address
    // allows either kind; set automatically when only one kind is offered.
    accountType: AccountType = null;

    // --- About you -----------------------------------------------------------

    aboutForm: FormRecord;

    minDob = new Date('1900-01-01');
    maxDob = new Date();
    juvMinDob: Date;

    // Anyone under 18 must supply a parent/guardian.
    isJuvenile = false;

    // Supplied by the About You step: the birth-date input's raw text.
    // A partially-typed year (e.g. "12/05/20" on the way to 2001) parses
    // to a spurious Date, so the juvenile check waits for a complete date.
    dobRawText: (() => string) | null = null;

    // Result of the existing-account (dupe) check; null = not checked.
    maybeDupeAccount: boolean | null = null;

    // --- Stay in touch --------------------------------------------------------

    contactForm: FormRecord;

    // Notice opt-in setting types, grouped by delivery mechanism; the
    // checkboxes only render for groups that have settings.
    emailSettings: UserSettingType[] = [];
    phoneSettings: UserSettingType[] = [];
    textSettings: UserSettingType[] = [];
    printSettings: UserSettingType[] = [];

    // Orgs eligible as a hold pickup library.
    pickupLibs: Hash[] = [];

    // Mailing address selection (when it differs from residential).
    mailingAddress: AddressSuggestion | null = null;
    mailingSelected = false;
    mailingNotViable = false;
    mailingVerifying = false;

    // Unit/apartment handling for multi-unit mailing addresses; mirrors the
    // residential unitRequired / unitValid flow.
    mailingUnitRequired = false;
    mailingUnitValid: boolean | null = null;

    // --- My Library Card -------------------------------------------------------

    // Selected card design (all-access only) and how to receive the card.
    // Neither has a default; the patron must choose.
    cardDesign: string | null = null;
    delivery: 'Pick up' | 'Mail' | null = null;

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

    cardOptionUrl(name: string): string {
        return `/images/patron_cards/${name}.png`;
    }

    cardDescription(name: string): string {
        return this.cardDescriptions[name] ?? '';
    }

    // --- Review & submit ---------------------------------------------------------

    reviewForm: FormRecord;
    submitting = false;

    registerResult: GacRegisterResult = {
        complete: false,
        success: false,
        barcode: null,
        accountType: '',
        deliveryMethod: '',
        homeOrgName: '',
    };

    constructor(
        private gateway: Gateway,
        private app: AppService,
        private settings: Settings,
        private captcha: CaptchaSessionService,
        formBuilder: FormBuilder,
    ) {
        // Warm the CAPTCHA session so the first autocomplete doesn't wait on
        // the challenge, and the org tree so home-library names resolve.
        this.captcha.getToken().catch(() => {});
        this.app.getOrgTree();

        this.juvMinDob = new Date();
        this.juvMinDob.setFullYear(this.juvMinDob.getFullYear() - JUV_AGE);

        this.aboutForm = formBuilder.record({
            first: ['', Validators.required],
            middle: '',
            last: ['', Validators.required],
            legalIsSame: true,
            legalFirst: '',
            legalMiddle: '',
            legalLast: '',
            dob: ['', Validators.required],
            guardian: '',
        });

        // A juvenile birth date makes the parent/guardian field required.
        // Debounced: while a date is being typed, the datepicker parses the
        // partial text (e.g. "05/04/20" -> year 2020) and the guardian field
        // would otherwise flicker in and out with each keystroke.
        this.aboutForm.get('dob')!.valueChanges.pipe(
            debounceTime(700),
        ).subscribe(() => this.applyJuvenileRules());

        // Re-run the existing-account check as identifying values settle.
        this.aboutForm.valueChanges.pipe(debounceTime(500)).subscribe(
            () => this.checkForExistingAccount());

        this.contactForm = formBuilder.record({
            email: ['', Validators.email],
            phone: ['', Validators.pattern(PHONE_REGEX)],
            smsIsSame: true,
            smsNumber: [{value: '', disabled: true}, Validators.pattern(PHONE_REGEX)],
            allEmailNotices: false,
            allTextNotices: false,
            allPhoneNotices: false,
            pickupLib: 0,
            mailingIsSame: true,
            mailingStreet2: '',
        });

        const cf = this.contactForm;

        cf.get('email')!.valueChanges.subscribe(() => this.applyContactRules());

        cf.get('phone')!.valueChanges.subscribe(val => {
            // When the SMS number mirrors the phone number, keep it in sync.
            if (cf.get('smsIsSame')!.value) {
                cf.get('smsNumber')!.setValue(val, {emitEvent: false});
            }
            this.applyContactRules();
        });

        // "Same for text/SMS": mirror the phone number into the SMS field
        // when checked; clear it so the user can supply a different number
        // when unchecked.
        cf.get('smsIsSame')!.valueChanges.subscribe(isSame => {
            const sms = cf.get('smsNumber')!;
            sms.setValue(isSame ? cf.get('phone')!.value : '', {emitEvent: false});
            if (isSame) {
                sms.disable({emitEvent: false});
            } else {
                sms.enable({emitEvent: false});
            }
        });

        ['allEmailNotices', 'allTextNotices', 'allPhoneNotices'].forEach(name =>
            cf.get(name)!.valueChanges.subscribe(() => this.applyContactRules()));

        cf.get('mailingIsSame')!.valueChanges.subscribe(isSame => {
            if (isSame) { this.clearMailing(); }
        });

        // Entering / editing the mailing unit re-verifies the address, as
        // with the residential unit.  Programmatic writes use emitEvent:false
        // so they don't re-trigger this.
        cf.get('mailingStreet2')!.valueChanges.pipe(
            debounceTime(400),
            distinctUntilChanged(),
        ).subscribe(() => {
            if (!this.mailingSelected) { return; }
            const unit = ('' + (cf.get('mailingStreet2')!.value ?? '')).trim();
            this.confirmMailingUnit(unit).then(normalized => {
                if (normalized) {
                    cf.get('mailingStreet2')!.setValue(normalized, {emitEvent: false});
                }
            });
        });

        this.reviewForm = formBuilder.record({
            wantsLibNews: false,
            wantsFoundationInfo: false,
            termsOfService: false,
        });

        this.loadOptInSettings();
        this.loadPickupLibs();
    }

    // --- step gating ---------------------------------------------------------

    // The active steps: e-card holders skip the physical-card step.
    get steps(): GacStep[] {
        return GAC_STEPS.filter(
            s => s.slug !== 'card' || this.accountType !== 'ecard');
    }

    stepComplete(slug: string): boolean {
        if (slug === 'address') {
            // Both the residential and (when different) mailing addresses
            // are collected on this step.  An address outside the service
            // area (no district of residence) is a dead end.
            const mailingOk = !!this.contactForm.get('mailingIsSame')!.value
                || (this.mailingSelected
                    && !this.mailingNotViable
                    && (!this.mailingUnitRequired || this.mailingUnitValid === true));
            return this.addressComplete && this.district != null && mailingOk;
        }
        if (slug === 'account') { return this.accountType != null; }
        if (slug === 'about-you') { return this.aboutForm.valid; }
        if (slug === 'contact') { return this.contactForm.valid; }
        if (slug === 'card') {
            return this.cardDesign != null && this.delivery != null;
        }
        if (slug === 'review') {
            return !!this.reviewForm.get('termsOfService')!.value && !this.submitting;
        }
        return true;
    }

    // Record the requested account type and re-derive the contact rules
    // that depend on it (e.g. e-cards require an email address).
    setAccountType(type: AccountType) {
        this.accountType = type;
        this.applyContactRules();
    }

    get addressComplete(): boolean {
        return this.homeOrgId != null
            && (!this.unitRequired || this.unitValid === true);
    }

    // --- address selection ---------------------------------------------------

    selectAddress(addr: AddressSuggestion): Promise<string | null> {
        this.resetResolution();
        this.address = addr;
        this.addressSelected = true;
        this.unitRequired = (addr.entries || 0) > 1;
        this.street2 = this.unitRequired ? '' : (addr.secondary || '');

        if (addr.is_exception) {
            // Allowed exceptions carry their own home org / district; blocked
            // ones shouldn't appear in autocomplete, but be defensive.
            this.exceptionId = Number(addr.exception_id);
            if (addr.is_allowed) {
                this.applyOrgAndDistrict(
                    addr.home_ou || null, addr.district_of_residence || null);
            } else {
                this.blocked = true;
            }
            return Promise.resolve(null);
        }

        if (this.unitRequired) {
            // Wait for the user to supply a unit before verifying.
            return Promise.resolve(null);
        }

        return this.verify(this.street2);
    }

    /**
     * Re-verify the selected address with the entered unit.  Resolves to the
     * service's normalized unit string (e.g. "Apt 4") when available.
     */
    confirmUnit(unit: string): Promise<string | null> {
        this.street2 = unit;
        if (!this.addressSelected) { return Promise.resolve(null); }
        return this.verify(unit);
    }

    clearSelection() {
        this.resetResolution();
        this.address = null;
        this.addressSelected = false;
        this.unitRequired = false;
        this.street2 = '';
    }

    private resetResolution() {
        this.unitValid = null;
        this.verifying = false;
        this.notViable = false;
        this.blocked = false;
        this.homeOrgId = null;
        this.homeOrgName = '';
        this.district = null;
        this.accountTypeOption = null;
        this.exceptionId = null;
        // A different address can change what's offered.
        this.setAccountType(null);
    }

    // Verify the selected address (with the given unit) via the address
    // service, then resolve the home library and district from its geocode.
    private verify(secondary: string): Promise<string | null> {
        const addr = this.address;
        if (!addr) { return Promise.resolve(null); }

        this.resetResolution();
        this.verifying = true;

        return this.requestOne('kcls.address', 'kcls.address.lookup', {
            street: addr.street_line,
            secondary: secondary,
            city: addr.city,
            state: addr.state,
            zipcode: addr.zipcode,
        }).then(found => {
            this.verifying = false;

            const f = found as Hash | null;
            if (!f) {
                if (this.unitRequired && secondary) {
                    this.unitValid = false;
                } else {
                    this.notViable = true;
                }
                return null;
            }

            if (f['is_viable_residential'] === false) {
                // A blocked address exception is valid but ineligible;
                // distinguish it from a generally non-viable address.
                if (f['is_exception']) {
                    this.blocked = true;
                } else {
                    this.notViable = true;
                }
                return null;
            }

            const hasValidSecondary = !!f['has_valid_secondary'];
            if (this.unitRequired) {
                this.unitValid = secondary ? hasValidSecondary : null;
                if (!hasValidSecondary) { return null; }
            }

            // Reflect the service's normalized unit (e.g. "Apt 4").
            let normalized: string | null = null;
            const comp = (f['components'] || {}) as Hash;
            if (hasValidSecondary && comp['secondary_number']) {
                normalized = [comp['secondary_designator'], comp['secondary_number']]
                    .filter(Boolean).join(' ');
                this.street2 = normalized;
            }

            const meta = (f['metadata'] || {}) as Hash;
            const latitude = meta['latitude'];
            const longitude = meta['longitude'];
            if (latitude == null || longitude == null) { return normalized; }

            return Promise.all([
                this.requestOne('kcls.address', 'kcls.address.home-org',
                    latitude, longitude),
                this.requestOne('kcls.address', 'kcls.address.district-of-residence',
                    latitude, longitude),
            ]).then(([homeOrg, district]) => {
                this.applyOrgAndDistrict(
                    homeOrg as number | null, district as string | null);
                return normalized;
            });

        }).catch(err => {
            this.verifying = false;
            console.error('Address verification failed', err);
            return null;
        });
    }

    private applyOrgAndDistrict(homeOrg: number | null, district: string | null) {
        if (homeOrg) {
            this.homeOrgId = Number(homeOrg);
            this.app.getOrgTree().then(() => {
                const org = this.app.getOrgUnit(this.homeOrgId ?? 0);
                this.homeOrgName = org ? ('' + (org['name'] ?? '')) : '';
            });
        }

        if (district) {
            this.district = district;
            this.accountTypeOption =
                district === MAIN_DISTRICT_OF_RESIDENCE ? 'either' : 'all-access';

            // Only one kind offered: no choice to make.
            if (this.accountTypeOption === 'all-access') {
                this.setAccountType('full');
            }
        }

        // Default the hold pickup library to the home library.
        if (this.homeOrgId && !this.contactForm.get('pickupLib')!.value) {
            this.contactForm.get('pickupLib')!.setValue(this.homeOrgId);
        }
    }

    // --- About you rules ------------------------------------------------------

    // Re-evaluate the juvenile/guardian rules outside a dob value change --
    // e.g. on blur, when the datepicker completes a partial year in the
    // display text without altering the (already parsed) control value.
    refreshJuvenileRules() {
        this.applyJuvenileRules();
    }

    private applyJuvenileRules() {
        const dob = this.aboutForm.get('dob')!.value as Date | null;

        // Only evaluate once the typed date is complete (4-digit year); the
        // calendar picker always writes a complete date.  Without a raw-text
        // source, fall back to trusting the parsed value.
        const raw = this.dobRawText ? this.dobRawText() : null;
        const complete = raw == null || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw.trim());

        this.isJuvenile = complete && !!dob && dob > this.juvMinDob;

        const guardian = this.aboutForm.get('guardian')!;
        if (this.isJuvenile) {
            guardian.setValidators(Validators.required);
        } else {
            guardian.clearValidators();
        }
        guardian.updateValueAndValidity({emitEvent: false});
    }

    // See if the provided identity values match an existing account so the
    // patron can be pointed at the login page instead.
    private checkForExistingAccount() {
        const v = this.aboutForm.value as Hash;
        const street1 = this.address?.street_line;

        if (!v['first'] || !v['last'] || !v['dob'] || !street1) {
            this.maybeDupeAccount = null;
            return;
        }

        this.requestOne('open-ils.actor', 'open-ils.actor.register.has_account', {
            first_given_name: v['first'],
            family_name: v['last'],
            dob: v['dob'],
            street1: street1,
        }).then(resp => {

            if (Number(resp) === 1) {
                this.maybeDupeAccount = true;
                return;
            }

            this.maybeDupeAccount = false;

            // If the user has legal name values, do a secondary lookup
            // on the legal names.
            if (!v['legalFirst'] && !v['legalLast']) { return; }

            const first = v['first'] || v['legalFirst'];
            const last = v['last'] || v['legalLast'];

            return this.requestOne('open-ils.actor', 'open-ils.actor.register.has_account', {
                first_given_name: first,
                family_name: last,
                dob: v['dob'],
                street1: street1,
            }).then(resp2 => {
                this.maybeDupeAccount = Number(resp2) === 1;
            });

        }).catch(err => console.error('Existing account check failed', err));
    }

    // --- Stay in touch rules ---------------------------------------------------

    wantsEmailNotices(): boolean {
        return this.emailSettings.length > 0
            && !!this.contactForm.get('allEmailNotices')!.value;
    }

    wantsPhoneNotices(): boolean {
        return this.phoneSettings.length > 0
            && !!this.contactForm.get('allPhoneNotices')!.value;
    }

    wantsTextNotices(): boolean {
        return this.textSettings.length > 0
            && !!this.contactForm.get('allTextNotices')!.value;
    }

    // Determines if a contact type (phone/email/etc) is required based
    // on notice and account type preferences.  Only the required validator
    // is toggled; the format validators always apply.
    private applyContactRules() {
        const cf = this.contactForm;
        const email = cf.get('email')!;
        const phone = cf.get('phone')!;
        const sms = cf.get('smsNumber')!;

        const emailRequired =
            this.accountType === 'ecard' ||
            this.wantsEmailNotices() ||
            (this.accountType === 'full' && !phone.value);

        const phoneRequired =
            this.wantsPhoneNotices() ||
            (this.accountType === 'full' && !email.value);

        const smsRequired = this.wantsTextNotices();

        this.setRequired(email, emailRequired);
        this.setRequired(phone, phoneRequired);
        this.setRequired(sms, smsRequired);
    }

    private setRequired(ctl: AbstractControl, required: boolean) {
        if (required === ctl.hasValidator(Validators.required)) { return; }
        if (required) {
            ctl.addValidators(Validators.required);
        } else {
            ctl.removeValidators(Validators.required);
        }
        ctl.updateValueAndValidity({emitEvent: false});
    }

    private loadOptInSettings() {
        this.gateway.request(
            'open-ils.actor',
            'open-ils.actor.event_def.opt_in.settings.opac_visible'
        ).subscribe(setting => {
            const set = setting as UserSettingType;
            const grp = set.grp || '';

            if (grp.match(/email/)) {
                this.emailSettings.push(set);
            } else if (grp.match(/phone/)) {
                this.phoneSettings.push(set);
            } else if (grp.match(/text/)) {
                this.textSettings.push(set);
            } else if (grp.match(/print/)) {
                this.printSettings.push(set);
            }
        });
    }

    // Orgs where holds may be picked up: the org unit type can hold volumes
    // and the org is not flagged as not-a-pickup-lib.
    private loadPickupLibs() {
        this.app.getOrgTree().then(() =>
            this.settings.settingValueForOrgs('opac.holds.org_unit_not_pickup_lib')
        ).then((list: Hash[]) => {
            const libs: Hash[] = [];

            list.forEach(setting => {
                if (!(setting['summary'] as Hash)['value']) {
                    const org = this.app.getOrgUnit(setting['org_unit'] as number);
                    if (org && (org['ou_type'] as Hash)['can_have_vols'] === 't') {
                        org['id'] = Number(org['id']);
                        libs.push(org);
                    }
                }
            });

            this.pickupLibs = libs.sort((a, b) =>
                (a['name'] as string) < (b['name'] as string) ? -1 : 1);
        });
    }

    // --- mailing address --------------------------------------------------------

    // Apply a chosen mailing address and confirm it's usable for mail
    // delivery.  Multi-unit buildings wait for a unit (Apt/Suite/etc)
    // before verifying, as with the residential address.  (Unlike
    // residential, no home-org/district resolution applies.)
    selectMailing(addr: AddressSuggestion): Promise<string | null> {
        this.mailingAddress = addr;
        this.mailingSelected = true;
        this.mailingNotViable = false;
        this.mailingUnitRequired = (addr.entries || 0) > 1;
        this.mailingUnitValid = null;

        const unit = this.mailingUnitRequired ? '' : (addr.secondary || '');
        this.contactForm.get('mailingStreet2')!.setValue(unit, {emitEvent: false});

        if (this.mailingUnitRequired) {
            // Wait for the user to supply a unit before verifying.
            return Promise.resolve(null);
        }

        return this.verifyMailing(unit);
    }

    /**
     * Re-verify the selected mailing address with the entered unit.
     * Resolves to the service's normalized unit string when available.
     */
    confirmMailingUnit(unit: string): Promise<string | null> {
        if (!this.mailingSelected) { return Promise.resolve(null); }
        return this.verifyMailing(unit);
    }

    private verifyMailing(secondary: string): Promise<string | null> {
        const addr = this.mailingAddress;
        if (!addr) { return Promise.resolve(null); }

        this.mailingNotViable = false;
        this.mailingUnitValid = null;
        this.mailingVerifying = true;

        return this.requestOne('kcls.address', 'kcls.address.lookup', {
            street: addr.street_line,
            secondary: secondary,
            city: addr.city,
            state: addr.state,
            zipcode: addr.zipcode,
        }).then(found => {
            this.mailingVerifying = false;

            const f = found as Hash | null;
            if (!f) {
                if (this.mailingUnitRequired && secondary) {
                    this.mailingUnitValid = false;
                } else {
                    this.mailingNotViable = true;
                }
                return null;
            }

            if (f['is_viable_mailing'] === false) {
                this.mailingNotViable = true;
                return null;
            }

            const hasValidSecondary = !!f['has_valid_secondary'];
            if (this.mailingUnitRequired) {
                this.mailingUnitValid = secondary ? hasValidSecondary : null;
                if (!hasValidSecondary) { return null; }
            }

            // Reflect the service's normalized unit (e.g. "Apt 4").
            const comp = (f['components'] || {}) as Hash;
            if (hasValidSecondary && comp['secondary_number']) {
                return [comp['secondary_designator'], comp['secondary_number']]
                    .filter(Boolean).join(' ');
            }

            return null;
        }).catch(err => {
            this.mailingVerifying = false;
            console.error('Mailing address verification failed', err);
            return null;
        });
    }

    clearMailing() {
        this.mailingAddress = null;
        this.mailingSelected = false;
        this.mailingNotViable = false;
        this.mailingVerifying = false;
        this.mailingUnitRequired = false;
        this.mailingUnitValid = null;
        this.contactForm.get('mailingStreet2')!.setValue('', {emitEvent: false});
    }

    // --- submit -------------------------------------------------------------------

    // Map the collected values to what the API needs and post them.  The
    // outcome lands in registerResult for the completion page.
    submit(): Promise<void> {
        this.registerResult.complete = false;
        this.registerResult.success = false;
        this.registerResult.barcode = null;

        this.submitting = true;

        const about = this.aboutForm.value as Hash;
        const cf = this.contactForm;
        const review = this.reviewForm.value as Hash;
        const addr = this.address;

        // DOB is just the date, but still needs to be in ISO format.
        const dob = new Date(about['dob'] as string);
        const dobstr =
            dob.getFullYear() + '-' +
            ((dob.getMonth() + 1) + '').padStart(2, '0') + '-' +
            (dob.getDate() + '').padStart(2, '0');

        const mailingIsSame = !!cf.get('mailingIsSame')!.value;
        const mailing = this.mailingAddress;

        // Reminder that KCLS uses pref_* fields for the legal name
        // when it differs from chosen name.
        const payload: Hash = {
            requested_account_type: this.accountType,
            address_exception_id: this.exceptionId,
            user: {
                // Unset for e-cards (their flow skips the card step);
                // ignored server-side either way.
                delivery_method: this.delivery ?? '',
                first_given_name: about['first'],
                second_given_name: about['middle'],
                family_name: about['last'],
                pref_first_given_name: about['legalFirst'],
                pref_second_given_name: about['legalMiddle'],
                pref_family_name: about['legalLast'],
                dob: dobstr,
                day_phone: cf.get('phone')!.value,
                email: cf.get('email')!.value,
                home_ou: this.homeOrgId,
                ident_value2: about['guardian'], // KCLS
            },
            billing_address: {
                street1: addr?.street_line || '',
                street2: this.street2,
                city: addr?.city || '',
                state: addr?.state || '',
                post_code: addr?.zipcode || '',
            },
            mailing_address: {
                street1: mailingIsSame ? '' : (mailing?.street_line || ''),
                street2: mailingIsSame ? '' : ('' + (cf.get('mailingStreet2')!.value ?? '')),
                city: mailingIsSame ? '' : (mailing?.city || ''),
                state: mailingIsSame ? '' : (mailing?.state || ''),
                post_code: mailingIsSame ? '' : (mailing?.zipcode || ''),
            },
            settings: [],
            stat_cats: [],
        };

        const settings = payload['settings'] as Hash[];
        settings.push(
            {name: 'opac.default_sms_notify', value: cf.get('smsNumber')!.value},
            {name: 'opac.default_pickup_location', value: cf.get('pickupLib')!.value},
        );

        // Propagate the individual notice opt-in settings for each
        // requested notice mechanism.
        const optIns: Array<[string, UserSettingType[]]> = [
            ['allEmailNotices', this.emailSettings],
            ['allTextNotices', this.textSettings],
            ['allPhoneNotices', this.phoneSettings],
        ];

        optIns.forEach(([control, sets]) => {
            if (cf.get(control)!.value === true) {
                sets.forEach(set => settings.push({name: set.name, value: true}));
            }
        });

        const statCats = payload['stat_cats'] as Hash[];
        statCats.push(
            {stat_cat: STAT_CAT_LIB_NEWS,
                value: review['wantsLibNews'] ? 'Y' : 'N'},
            {stat_cat: STAT_CAT_FOUNDATION_NEWS,
                value: review['wantsFoundationInfo'] ? 'Y' : 'N'},
            {stat_cat: STAT_CAT_CARD_STYLE, value: this.cardDesign ?? ''},
        );

        if (this.district) {
            statCats.push(
                {stat_cat: STAT_CAT_DISTRICT_OF_RESIDENCE, value: this.district});
        }

        console.debug('SEND', payload);

        return this.requestOne(
            'open-ils.actor', 'open-ils.actor.register', payload
        ).then(resp => {
            const r = (resp || {}) as Hash;

            console.debug('RESPONSE', r);

            this.registerResult = {
                complete: true,
                success: Number(r['success']) > 0,
                barcode: (r['barcode'] as string) || null,
                accountType: this.accountType || '',
                deliveryMethod: this.delivery ?? '',
                homeOrgName: this.homeOrgName,
            };

        }).catch(err => {
            console.error('Registration failed', err);
            this.registerResult = {
                complete: true,
                success: false,
                barcode: null,
                accountType: this.accountType || '',
                deliveryMethod: this.delivery ?? '',
                homeOrgName: this.homeOrgName,
            };
        }).then(() => {
            this.submitting = false;
        });
    }

    // --- backend APIs (session token injected) --------------------------------

    autocomplete(
        term: string,
        kind: 'residential' | 'mailing' = 'residential'
    ): Observable<AddressSuggestion[]> {

        // A residence can't be commercial or a PO box; mailing addresses can
        // be either.  The base address of a multi-unit building is never
        // selectable.
        const exclude = kind === 'residential'
            ? 'base-address,commercial,po-box'
            : 'base-address';

        return this.request('kcls.address', 'kcls.address.autocomplete', {
            'state_filter': 'WA',
            'search': term.toLowerCase(),
            'exclude': exclude,
            'exclude_ofc': true,
        }).pipe(
            map(s => s as AddressSuggestion),
            toArray()
        );
    }

    private request(
        service: string, method: string, ...params: unknown[]): Observable<unknown> {
        return from(this.captcha.getToken()).pipe(
            switchMap(token =>
                this.gateway.request(service, method, token, ...params))
        );
    }

    private requestOne(
        service: string, method: string, ...params: unknown[]): Promise<unknown> {
        return this.captcha.getToken().then(token =>
            this.gateway.requestOne(service, method, token, ...params));
    }
}
