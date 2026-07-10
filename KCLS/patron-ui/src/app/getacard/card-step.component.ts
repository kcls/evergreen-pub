import {Component} from '@angular/core';
import {GetacardState} from './state.service';

/**
 * "My Library Card" — the card design gallery and how to receive the card.
 * Shown for all-access cards only (the step drops out of the flow for
 * e-cards).
 */
@Component({
  selector: 'gac-card-step',
  templateUrl: './card-step.component.html',
  styleUrls: ['./card-step.component.scss']
})
export class CardStepComponent {

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

    constructor(public state: GetacardState) {}

    cardOptionUrl(name: string): string {
        return `/images/patron_cards/${name}.png`;
    }

    cardDescription(name: string): string {
        return this.cardDescriptions[name] ?? '';
    }

    chooseDesign(card: string) {
        this.state.cardDesign = card;
    }

    chooseDelivery(method: 'Pick up' | 'Mail') {
        this.state.delivery = method;
    }
}
