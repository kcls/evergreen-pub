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

    constructor(public state: GetacardState) {}

    ngAfterViewInit() {
        setTimeout(() => this.firstInput?.nativeElement.focus());
    }

    ctrl(name: string): AbstractControl {
        return this.state.aboutForm.get(name)!;
    }
}
