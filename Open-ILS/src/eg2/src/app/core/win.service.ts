/*
 * Service for attaching a statically incrementing integer value as
 * a unique id to a Window object.
 */
import {Injectable} from '@angular/core';
import {Location} from '@angular/common';

const EG_WIN_ID = "_eg_window_id";

@Injectable({providedIn: 'root'})
export class WinService {
    static autoId = 0;

    constructor(private ngLocation: Location) {}

    // Open a new window with the specified Angular path (e.g.
    // /staff/circ/checkin) and tag the window with an auto ID.
    open(path: string): number {
        const url = this.ngLocation.prepareExternalUrl(path);
        const win = window.open(url);
        this.setId(win);
        return this.getId(win);
    }

    getId(win?: Window): number {
        if (isNaN(Number(window[EG_WIN_ID]))) {
            this.setId(win);
        }

        return window[EG_WIN_ID];
    }

    // Set an auto-generated ID on either the provided window object
    // or our current Window.
    setId(win?: Window) {
        let w = win ? win : window;
        w[EG_WIN_ID] = ++WinService.autoId;
    }
}


