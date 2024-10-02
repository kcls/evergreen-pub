import {AfterViewInit, Component, ElementRef, ViewChild} from '@angular/core';
import {AbstractControl} from '@angular/forms';
import {GetacardState} from './state.service';

/**
 * "About you" — names, legal name, birth date, and (for juveniles) a
 * parent/guardian.  The form itself lives in GetacardState so values
 * survive step navigation; validation rules (required guardian for
 * juveniles) and the existing-account check are applied there too.
 */
@Component({
  selector: 'gac-about-step',
  templateUrl: './about-step.component.html',
  styleUrls: ['./about-step.component.scss']
})
export class AboutStepComponent implements AfterViewInit {

    @ViewChild('firstInput') firstInput?: ElementRef<HTMLInputElement>;
    @ViewChild('dobInput') dobInput?: ElementRef<HTMLInputElement>;

    constructor(public state: GetacardState) {}

    ngAfterViewInit() {
        setTimeout(() => this.firstInput?.nativeElement.focus());

        // Let the juvenile check see the raw birth-date text so it can wait
        // for a complete (4-digit-year) date before showing the guardian
        // field.
        this.state.dobRawText = () => this.dobInput?.nativeElement.value ?? '';
    }

    ctrl(name: string): AbstractControl {
        return this.state.aboutForm.get(name)!;
    }

    // Leaving the birth-date field completes a partially-typed year in the
    // display text (e.g. "20" -> "2020") without a value change; re-check
    // the juvenile rules once that reformat has settled.
    dobBlur() {
        setTimeout(() => this.state.refreshJuvenileRules());
    }
}
