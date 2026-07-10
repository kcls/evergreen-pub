import {Injectable} from '@angular/core';
import {AbstractControl, FormBuilder, FormRecord, Validators} from '@angular/forms';
import {Observable, from} from 'rxjs';
import {debounceTime, map, switchMap, toArray} from 'rxjs/operators';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {Settings} from '../settings.service';
import {CaptchaSessionService} from '../captcha-session.service';

const MAIN_DISTRICT_OF_RESIDENCE = ' KCLS'; // space is intentional
const JUV_AGE = 18; // years
const PHONE_REGEX = /\d{3}-\d{3}-\d{4}/;

export interface UserSettingType {
    name: string;
    label: string;
    grp: string;
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

    // --- My Library Card -------------------------------------------------------

    // Selected card design (all-access only) and how to receive the card.
    cardDesign: string | null = null;
    delivery: 'Pick up' | 'Mail' = 'Mail';

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
        this.aboutForm.get('dob')!.valueChanges.subscribe(
            () => this.applyJuvenileRules());

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
        if (slug === 'address') { return this.addressComplete; }
        if (slug === 'account') { return this.accountType != null; }
        if (slug === 'about-you') { return this.aboutForm.valid; }
        if (slug === 'contact') {
            const mailingOk = !!this.contactForm.get('mailingIsSame')!.value
                || (this.mailingSelected && !this.mailingNotViable);
            return this.contactForm.valid && mailingOk;
        }
        if (slug === 'card') { return this.cardDesign != null; }
        return true; // prototype: later steps are placeholders
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

    private applyJuvenileRules() {
        const dob = this.aboutForm.get('dob')!.value as Date | null;
        this.isJuvenile = !!dob && dob > this.juvMinDob;

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
    // delivery.  (Unlike the residential address, no home-org/district
    // resolution applies.)
    selectMailing(addr: AddressSuggestion): Promise<void> {
        this.mailingAddress = addr;
        this.mailingSelected = true;
        this.mailingNotViable = false;
        this.mailingVerifying = true;
        this.contactForm.get('mailingStreet2')!.setValue(
            addr.secondary || '', {emitEvent: false});

        return this.requestOne('kcls.address', 'kcls.address.lookup', {
            street: addr.street_line,
            secondary: addr.secondary,
            city: addr.city,
            state: addr.state,
            zipcode: addr.zipcode,
        }).then(found => {
            this.mailingVerifying = false;
            const f = found as Hash | null;
            if (f && f['is_viable_mailing'] === false) {
                this.mailingNotViable = true;
            }
        }).catch(err => {
            this.mailingVerifying = false;
            console.error('Mailing address verification failed', err);
        });
    }

    clearMailing() {
        this.mailingAddress = null;
        this.mailingSelected = false;
        this.mailingNotViable = false;
        this.mailingVerifying = false;
        this.contactForm.get('mailingStreet2')!.setValue('', {emitEvent: false});
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
