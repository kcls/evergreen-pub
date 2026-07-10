import {Component} from '@angular/core';
import {AccountType, GetacardState} from './state.service';

/**
 * "Choose your account" — what the resolved address makes the patron
 * eligible for.  In-district addresses choose between an all-access card
 * and a digital (e-card) card; reciprocal districts get all-access only
 * (auto-selected); addresses with no district are out of the service area.
 */
@Component({
  selector: 'gac-account-step',
  templateUrl: './account-step.component.html',
  styleUrls: ['./account-step.component.scss']
})
export class AccountStepComponent {

    constructor(public state: GetacardState) {}

    choose(type: AccountType) {
        this.state.accountType = type;
    }
}
