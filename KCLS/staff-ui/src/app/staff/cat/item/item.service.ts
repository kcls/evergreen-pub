import {Injectable, EventEmitter} from '@angular/core';
import {IdlObject} from '@eg/core/idl.service';

@Injectable()
export class ItemStatusService {

    // These must persist route changes.
    scannedItems: IdlObject[] = [];

    // If true, we've loaded the search/list UI's copies from its ID list
    // Avoid re-loading them.
    preloadItemsLoaded = false;
}

