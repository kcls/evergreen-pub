import {Directive, HostListener} from '@angular/core';

// Automatically inserts "/" separators as the user types a date, producing
// the form MM/DD/YYYY.  The common path is 2 digits -> auto slash ->
// 2 digits -> auto slash -> 4 digits, but a single-digit month or day
// followed by a manually typed "/" (e.g. "1/2/2015") is also honored.
@Directive({ selector: 'input[autoDateSlash]' })
export class AutoDateSlashDirective {

    @HostListener('input', ['$event'])
    onInput(event: InputEvent): void {
        if (event.inputType?.startsWith('delete')) { return; }

        const input = event.target as HTMLInputElement;
        const raw = input.value;
        const cursorPos = input.selectionStart ?? 0;

        const formatted = this.format(raw);
        if (raw === formatted) { return; }

        input.value = formatted;

        if (cursorPos === raw.length) {
            input.setSelectionRange(formatted.length, formatted.length);
        } else {
            const pos = this.mapCursor(raw, formatted, cursorPos);
            input.setSelectionRange(pos, pos);
        }

        input.dispatchEvent(new Event('input', {bubbles: true}));
    }

    // Rebuild the value segment by segment (month, day, year): a "/" is
    // appended as soon as a segment fills, a manual "/" closes a partial
    // segment, and anything beyond a 4-digit year is dropped.
    private format(raw: string): string {
        const maxLens = [2, 2, 4];
        let out = '';
        let seg = 0;
        let segLen = 0;

        for (const ch of raw) {

            if (ch === '/') {
                // Close a partially-entered month/day (e.g. "1/"); ignore
                // duplicate or leading slashes and any slash after the year.
                if (seg < 2 && segLen > 0) {
                    out += '/';
                    seg++;
                    segLen = 0;
                }
                continue;
            }

            if (ch < '0' || ch > '9') { continue; }

            if (seg === 2 && segLen === maxLens[2]) { break; }

            out += ch;
            segLen++;

            if (seg < 2 && segLen === maxLens[seg]) {
                out += '/';
                seg++;
                segLen = 0;
            }
        }

        return out;
    }

    // Re-place the cursor after the same number of non-separator characters
    // it followed in the raw value.
    private mapCursor(raw: string, formatted: string, cursorPos: number): number {
        let charsBefore = 0;
        for (let i = 0; i < cursorPos && i < raw.length; i++) {
            if (raw[i] !== '/') { charsBefore++; }
        }

        let pos = 0;
        let seen = 0;
        while (pos < formatted.length && seen < charsBefore) {
            if (formatted[pos] !== '/') { seen++; }
            pos++;
        }
        return pos;
    }
}
