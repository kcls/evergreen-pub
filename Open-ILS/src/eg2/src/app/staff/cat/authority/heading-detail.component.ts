import {Component, OnInit, ViewChild} from '@angular/core';
import {IdlObject} from '@eg/core/idl.service';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {DialogComponent} from '@eg/share/dialog/dialog.component';

@Component({
  selector: 'eg-heading-detail-dialog',
  templateUrl: 'heading-detail.component.html',
  styles: [
    `td { padding:3px 8px 3px 8px; font-size: 98% }`,
    `.label {
        font-weight: bold;
        white-space : nowrap;
    }`

  ]
})
export class HeadingDetailComponent extends DialogComponent {

    heading: IdlObject;

    constructor(
        private modal: NgbModal // required for passing to parent
    ) {
        super(modal); // required for subclassing
    }
}

