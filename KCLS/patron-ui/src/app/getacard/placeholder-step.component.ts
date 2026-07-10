import {Component, Input} from '@angular/core';

/** Stand-in for the steps not yet built in the getacard prototype. */
@Component({
  selector: 'gac-placeholder-step',
  template: `
    <div [ngSwitch]="slug">
      <p *ngSwitchCase="'contact'" i18n>
        Phone, email, notice preferences, and the mailing address will live here.
      </p>
      <p *ngSwitchCase="'card'" i18n>
        The card design gallery and delivery options will live here.
      </p>
      <p *ngSwitchCase="'review'" i18n>
        The review &amp; submit summary will live here.
      </p>
    </div>
    <p class="gac-ph-note" i18n>
      (Prototype placeholder &#8212; this step isn't built yet.)
    </p>
  `,
  styles: [`
    :host { color: var(--gac-ink, #1a1a1a); }
    .gac-ph-note {
      color: var(--gac-muted, #5f6b76);
      font-size: 0.9rem;
      margin-top: 16px;
    }
  `]
})
export class PlaceholderStepComponent {
    @Input() slug = '';
}
