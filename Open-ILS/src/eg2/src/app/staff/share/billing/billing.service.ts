import {Injectable} from '@angular/core';
import {Observable, empty, from} from 'rxjs';
import {map, concatMap, mergeMap} from 'rxjs/operators';
import {IdlObject} from '@eg/core/idl.service';
import {NetService} from '@eg/core/net.service';
import {OrgService} from '@eg/core/org.service';
import {PcrudService} from '@eg/core/pcrud.service';
import {EventService, EgEvent} from '@eg/core/event.service';
import {AuthService} from '@eg/core/auth.service';
import {BibRecordService, BibRecordSummary} from '@eg/share/catalog/bib-record.service';
import {AudioService} from '@eg/share/util/audio.service';

export interface CreditCardPaymentParams {
    where_process?: 0 | 1;
    approval_code?: string;
    expire_month?: number;
    expire_year?: number;
    billing_first?: string;
    billing_last?: string;
    billing_address?: string;
    billing_city?: string;
    billing_state?: string;
    billing_zip?: string;
    note?: string;
    processor?: string;
}

interface PaymentResponse {
    payments: number[];
    last_xact_id: string;
}

export interface RefundablePaymentArgs {
    secondary_auth_key: string;
    transactions?: number[];
}

@Injectable()
export class BillingService {
    billingTypes: IdlObject[];
    userBillingTypes: IdlObject[];

    constructor(
        private evt: EventService,
        private org: OrgService,
        private net: NetService,
        private pcrud: PcrudService,
        private auth: AuthService
    ) {}

    // Returns billing types owned "here", excluding system types
    getUserBillingTypes(): Promise<IdlObject[]> {
        if (this.userBillingTypes) {
            return Promise.resolve(this.userBillingTypes);
        }

        return this.pcrud.search('cbt',
            {   id: {'>': 100},
                owner: this.org.fullPath(this.auth.user().ws_ou(), true)
            },
            {order_by: {cbt: 'name'}},
            {atomic: true}
        ).toPromise().then(types => this.userBillingTypes = types);
    }

    // Returns billing types owned "here", including system types
    getBillingTypes(): Promise<IdlObject[]> {
        if (this.billingTypes) {
            return Promise.resolve(this.billingTypes);
        }

        return this.pcrud.search('cbt',
            {owner: this.org.fullPath(this.auth.user().ws_ou(), true)},
            {order_by: {cbt: 'name'}},
            {atomic: true}
        ).toPromise().then(types => this.billingTypes = types);
    }

    applyPayment(
        patronId: number,
        patronLastXactId: string,
        paymentType: string,
        payments: Array<Array<number>>,
        paymentNote?: string,
        checkNumber?: string,
        creditCardParams?: CreditCardPaymentParams,
        addPatronCredit?: number,
        refundableArgs?: RefundablePaymentArgs
    ): Promise<PaymentResponse> {

       return this.net.request(
            'open-ils.circ',
            'open-ils.circ.money.payment',
            this.auth.token(), {
                userid: patronId,
                note: paymentNote || '',
                payment_type: paymentType,
                check_number: checkNumber,
                payments: payments,
                patron_credit: addPatronCredit,
                cc_args: creditCardParams,
                refundable_args: refundableArgs,
                // Clone the 2ndry auth key onto the top-level payment
                // object for registerIsActive() payments which may or may
                // not include LOST item payments.
                secondary_auth_key: refundableArgs ?
                    refundableArgs.secondary_auth_key : null,
            }, patronLastXactId).toPromise()

        .then(response => {

            const evt = this.evt.parse(response);
            if (evt) {
                console.error(evt);
                return Promise.reject(evt);
            }

            return response;
        });
    }

    getLdapAuthKey(username: string, password: string): Promise<string> {

        return this.net.request(
            'open-ils.circ',
            'open-ils.circ.staff.secondary_auth.ldap',
            this.auth.token(), username, password).toPromise()
        .then(result => {
            const evt = this.evt.parse(result);
            console.debug('2nd auth returned', result);

            if (evt) {
                if (evt.textcode === 'LDAP_AUTH_FAILED') {
                    console.warn('Secondary auth failed for ' + username);
                } else {
                    alert(evt);
                }
            } else if (typeof result === 'string') {
                console.debug('Secondary auth succeeded with ' + result);
                return result;
            }

            return null;
        });
    }
}

