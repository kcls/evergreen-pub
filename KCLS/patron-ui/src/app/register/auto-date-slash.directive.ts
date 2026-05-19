import {Directive, HostListener} from '@angular/core';

// Automatically inserts "/" separators as the user types a date in MM/DD/YYYY format.
// When the user manually types a "/" after a single digit, pads the preceding
// component with a leading zero (e.g. "1/" → "01/", "01/5/" → "01/05/").
@Directive({ selector: 'input[autoDateSlash]' })
export class AutoDateSlashDirective {

    @HostListener('input', ['$event'])
    onInput(event: InputEvent): void {
        if (event.inputType?.startsWith('delete')) { return; }

        const input = event.target as HTMLInputElement;
        const raw = input.value;
        const cursorPos = input.selectionStart ?? 0;

        let digits: string;

        if (raw.includes('/')) {
            // Split on separators (user-typed or auto-inserted) and pad any
            // single-digit month/day component that is already committed.
            const parts = raw.split('/');
            const monthRaw = parts[0].replace(/\D/g, '');
            const dayRaw   = (parts[1] ?? '').replace(/\D/g, '');
            const yearRaw  = (parts[2] ?? '').replace(/\D/g, '');

            const month = parts.length > 1 && monthRaw.length === 1
                ? '0' + monthRaw : monthRaw.substring(0, 2);
            const day = parts.length > 2 && dayRaw.length === 1
                ? '0' + dayRaw : dayRaw.substring(0, 2);

            digits = month + day + yearRaw.substring(0, 4);
        } else {
            digits = raw.replace(/\D/g, '').substring(0, 8);
        }

        let formatted = digits.substring(0, 2);
        if (digits.length >= 2) { formatted += '/'; }
        if (digits.length > 2)  { formatted += digits.substring(2, 4); }
        if (digits.length >= 4) { formatted += '/'; }
        if (digits.length > 4)  { formatted += digits.substring(4, 8); }

        if (input.value === formatted) { return; }

        input.value = formatted;

        // If cursor was at end of raw input keep it at end of formatted output
        // (covers normal typing and paste). Otherwise map digit-only position.
        if (cursorPos === raw.length) {
            input.setSelectionRange(formatted.length, formatted.length);
        } else {
            const slashesBefore = (raw.substring(0, cursorPos).match(/\//g) ?? []).length;
            const rawPos = cursorPos - slashesBefore;
            let newPos = rawPos;
            if (rawPos >= 2) { newPos++; }
            if (rawPos >= 4) { newPos++; }
            input.setSelectionRange(newPos, newPos);
        }

        input.dispatchEvent(new Event('input', {bubbles: true}));
    }
}
