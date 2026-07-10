import {Injectable} from '@angular/core';
import {Observable, from} from 'rxjs';
import {map, switchMap, toArray} from 'rxjs/operators';
import {Gateway, Hash} from '../gateway.service';
import {AppService} from '../app.service';
import {CaptchaSessionService} from '../captcha-session.service';

const MAIN_DISTRICT_OF_RESIDENCE = ' KCLS'; // space is intentional

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

    constructor(
        private gateway: Gateway,
        private app: AppService,
        private captcha: CaptchaSessionService,
    ) {
        // Warm the CAPTCHA session so the first autocomplete doesn't wait on
        // the challenge, and the org tree so home-library names resolve.
        this.captcha.getToken().catch(() => {});
        this.app.getOrgTree();
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
        return true; // prototype: later steps are placeholders
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
        this.accountType = null;
    }

    // Verify the selected address (with the given unit) via the address
    // service, then resolve the home library and district from its geocode.
    private verify(secondary: string): Promise<string | null> {
        const addr = this.address;
        if (!addr) { return Promise.resolve(null); }

        this.resetResolution();
        this.verifying = true;

        return this.requestOne('kcls.address.lookup', {
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
                this.requestOne('kcls.address.home-org', latitude, longitude),
                this.requestOne('kcls.address.district-of-residence', latitude, longitude),
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
                this.accountType = 'full';
            }
        }
    }

    // --- address APIs (session token injected) -------------------------------

    autocomplete(term: string): Observable<AddressSuggestion[]> {
        return this.request('kcls.address.autocomplete', {
            'state_filter': 'WA',
            'search': term.toLowerCase(),
            // Residential: a residence can't be commercial or a PO box; the
            // base address of a multi-unit building isn't selectable.
            'exclude': 'base-address,commercial,po-box',
            'exclude_ofc': true,
        }).pipe(
            map(s => s as AddressSuggestion),
            toArray()
        );
    }

    private request(method: string, ...params: unknown[]): Observable<unknown> {
        return from(this.captcha.getToken()).pipe(
            switchMap(token =>
                this.gateway.request('kcls.address', method, token, ...params))
        );
    }

    private requestOne(method: string, ...params: unknown[]): Promise<unknown> {
        return this.captcha.getToken().then(token =>
            this.gateway.requestOne('kcls.address', method, token, ...params));
    }
}
