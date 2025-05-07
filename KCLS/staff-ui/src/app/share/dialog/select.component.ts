import {Component, Input, ViewChild, OnInit, TemplateRef} from '@angular/core';
import {DialogComponent} from '@eg/share/dialog/dialog.component';


interface SelectOption {
    label: string;
    value: string;
}

/**
 * Selectation dialog that requests user input.
 */
@Component({
  selector: 'eg-select-dialog',
  templateUrl: './select.component.html'
})
export class SelectDialogComponent extends DialogComponent implements OnInit {
    static domId = 0;

    @Input() domId = 'eg-select-dialog-' + SelectDialogComponent.domId++;

    // What question are we asking?
    @Input() public dialogBody: string;

    // Value to return to the caller
    @Input() public selectValue: string;

    @Input() public options: SelectOption[] = [];

    ngOnInit() {
        this.onOpen$.subscribe(_ => {
            const node = document.getElementById(this.domId) as HTMLInputElement;
            if (node) { node.focus(); node.select(); }
        });
    }

    closeAndClear(value?: any) {
        this.close(value);
        this.selectValue = '';
    }
}


