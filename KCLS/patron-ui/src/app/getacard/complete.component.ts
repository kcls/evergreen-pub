import {Component, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {Title} from '@angular/platform-browser';
import {GetacardState} from './state.service';

/** Post-submit confirmation (or failure) page. */
@Component({
  templateUrl: './complete.component.html',
  styleUrls: ['./complete.component.scss']
})
export class GetacardCompleteComponent implements OnInit {

    constructor(
        private router: Router,
        private title: Title,
        public state: GetacardState,
    ) {}

    ngOnInit() {
        this.title.setTitle($localize`Registration Complete`);

        if (!this.state.registerResult.complete) {
            this.router.navigate(['/getacard']);
        }
    }
}
