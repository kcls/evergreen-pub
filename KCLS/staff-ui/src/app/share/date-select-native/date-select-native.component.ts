import {Component, OnInit, Input, Output, ViewChild, EventEmitter, forwardRef} from '@angular/core';
import {ControlValueAccessor, NG_VALUE_ACCESSOR} from '@angular/forms';
import {DateUtil} from '@eg/share/util/date';


@Component({
  selector: 'eg-date-select-native',
  templateUrl: './date-select-native.component.html',
  styleUrls: ['./date-select-native.component.css'],
  providers: [{
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DateSelectNativeComponent),
      multi: true
  }]
})
export class DateSelectNativeComponent implements OnInit, ControlValueAccessor {
    static domAutoId = 1;

    @Input() fieldName = '';
    @Input() required = false;
    @Input() disabled = false;  // Also works for readOnly
    @Input() min = '';          // YYYY-MM-DD
    @Input() max = '';          // YYYY-MM-DD
    @Input() noFuture = false;  // sets max to now
    @Input() noPast = false;    // sets min to now
    @Input() domId = 'eg-date-select-native-' + DateSelectNativeComponent.domAutoId++;

    // Emits YYYY-MM-DD on value change, null on empty.
    @Output() valueChange: EventEmitter<string> = new EventEmitter<string>();
    // Emits Date object
    @Output() valueChangeAsDate: EventEmitter<Date> = new EventEmitter<Date>();
    // Emits ISO8601 date string
    @Output() valueChangeAsIso: EventEmitter<string> = new EventEmitter<string>();

    @Output() blur: EventEmitter<void> = new EventEmitter<void>();

    // Stub functions required by ControlValueAccessor
    propagateChange = (_: any) => {};
    propagateTouch = () => {};

    constructor() { }

    ngOnInit() {
        if (this.noFuture) {
            this.max = DateUtil.localYmdFromDate();
        }

        if (this.noPast) {
            this.min = DateUtil.localYmdFromDate();
        }
    }

    input(): HTMLInputElement {
        return document.getElementById(this.domId) as HTMLInputElement;
    }

    handleBlur() {
        this.propagateTouch();
        this.blur.emit();
    }

    invalid(): boolean {
        if (!this.input()) { return false; }

        const value = this.input().value;

        if (!value) {
            if (this.required) {
                return true;
            } else {
                return false;
            }
        }

        // <input type="date"/> will prevent selection of out-of-bounds
        // dates, but it does not prevent the user from manually
        // entering such a date.
        const nowYmd = DateUtil.localYmdFromDate();

        if (this.noFuture && value > nowYmd) { return true; }

        if (this.noPast && value < nowYmd) { return true; }

        if (this.min && value < this.min) { return true; }

        if (this.max && value > this.max) { return true; }

        return false;
    }

    inputChange(evt: Event) {
        const value = this.input().value;
        this.propagateChange(value);

        if (!value) {

            this.valueChange.emit(null);
            this.valueChangeAsDate.emit(null);
            this.valueChangeAsIso.emit(null);

        } else {

            const date = DateUtil.localDateFromYmd(value);
            this.valueChange.emit(value);
            this.valueChangeAsDate.emit(date);
            this.valueChangeAsIso.emit(date.toISOString());
        }
    }

    writeValue(ymd: string) {
        if (!this.input()) { return; } // input still loading..
        if (typeof ymd === 'undefined') { return; }

        if (ymd && !ymd.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // If the caller provides a value that's not a simple YMD,
            // try to parse it as a full date string and translate it
            // into a local YMD value.
            ymd = DateUtil.localYmdFromDate(new Date(Date.parse(ymd)));
        }

        this.input().value = ymd;
    }

    registerOnChange(fn) {
        this.propagateChange = fn;
    }

    registerOnTouched(fn) {
        this.propagateTouch = fn;
    }
}


