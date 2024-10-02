import { Component } from '@angular/core';
import { KioskService } from './kiosk.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'patron-ui';

  // Injected here so kiosk detection (entry-URL ?kiosk param / session
  // stickiness) runs at bootstrap, before any lazy route loads.
  constructor(private kiosk: KioskService) {}
}
