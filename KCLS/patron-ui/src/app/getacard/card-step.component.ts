import {Component} from '@angular/core';
import {GetacardState} from './state.service';

/**
 * "My Library Card" — the card design gallery and how to receive the card.
 * Shown for all-access cards only (the step drops out of the flow for
 * e-cards).  The design catalog lives in GetacardState so the review step
 * can render the selection.
 */
@Component({
  selector: 'gac-card-step',
  templateUrl: './card-step.component.html',
  styleUrls: ['./card-step.component.scss']
})
export class CardStepComponent {

    constructor(public state: GetacardState) {}

    chooseDesign(card: string) {
        this.state.cardDesign = card;
    }

    chooseDelivery(method: 'Pick up' | 'Mail') {
        this.state.delivery = method;
    }
}
