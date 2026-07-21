import {Directive, HostListener} from '@angular/core';

// Automatically inserts "-" separators as the user types a phone number,
// producing the form 111-222-3333.
@Directive({ selector: 'input[autoPhoneDash]' })
export class AutoPhoneDashDirective {

    @HostListener('input', ['$event'])
    onInput(event: InputEvent): void {
        if (event.inputType?.startsWith('delete')) { return; }

        const input = event.target as HTMLInputElement;
        const raw = input.value;
        const cursorPos = input.selectionStart ?? 0;

        const digits = raw.replace(/\D/g, '').substring(0, 10);

        let formatted = digits.substring(0, 3);
        if (digits.length >= 3) { formatted += '-'; }
        if (digits.length > 3)  { formatted += digits.substring(3, 6); }
        if (digits.length >= 6) { formatted += '-'; }
        if (digits.length > 6)  { formatted += digits.substring(6, 10); }

        if (input.value === formatted) { return; }

        input.value = formatted;

        if (cursorPos === raw.length) {
            input.setSelectionRange(formatted.length, formatted.length);
        } else {
            const dashesBefore = (raw.substring(0, cursorPos).match(/-/g) ?? []).length;
            const rawPos = cursorPos - dashesBefore;
            let newPos = rawPos;
            if (rawPos >= 3) { newPos++; }
            if (rawPos >= 6) { newPos++; }
            input.setSelectionRange(newPos, newPos);
        }

        input.dispatchEvent(new Event('input', {bubbles: true}));
    }
}
