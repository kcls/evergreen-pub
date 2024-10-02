import {Component, OnInit} from '@angular/core';
import {Router, ActivatedRoute, Params, ParamMap} from '@angular/router';
import {AppService} from '../app.service';
import {FormControl} from '@angular/forms';
import {Gateway} from '../gateway.service';
import {RegisterService} from './register.service';
import {Title}  from '@angular/platform-browser';

@Component({
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent implements OnInit {

    languageForms = [{
        label: `አማርኛ | Amharic`,
        pdf: `amharic.pdf`,
      }, {
        label: `اللغة العربية / Arabic`,
        pdf: `arabic.pdf`,
      }, {
        label: `中文 / Chinese`,
        pdf: `chinese.pdf`,
      }, {
        label: `رى / Dari`,
        pdf: `dari.pdf`,
      }, {
        label: `English`,
        pdf: `english.pdf`
      }, {
        label: `English Large Print`,
        pdf: `english-large-print.pdf`,
      }, {
        label: `فارسی / Farsi`,
        pdf: `farsi.pdf`,
      }, {
        label: `Français / French`,
        pdf: `french.pdf`,
      }, {
        label: `हिंदू / Hindi`,
        pdf: `hindi.pdf`,
      }, {
        label: `한국어 / Korean`,
        pdf: `korean.pdf`
      }, {
        label: `kajin ṃajeḷ / Marshallese`,
        pdf: `marshallese.pdf`,
      }, {
        label: `ښتو / Pashto`,
        pdf: `pashto.pdf`,
      }, {
        label: `Português / Portuguese`,
        pdf: `portuguese.pdf`
      }, {
        label: `ਪੰਜਾਬੀ / Punjabi`,
        pdf: `punjabi.pdf`,
      }, {
        label: `Pусский / Russian`,
        pdf: `russian.pdf`,
      }, {
        label: `afka soomaaliga / Somali`,
        pdf: `somali.pdf`,
      }, {
        label: `Español / Spanish`,
        pdf: `spanish.pdf`,
      }, {
        label: `tagalog / Tagalog`,
        pdf: `tagalog.pdf`,
      }, {
        label: `ትግርኛ / Tigrinya`,
        pdf: `tigrinya.pdf`,
      }, {
        label: `мова українська / Ukranian`,
        pdf: `ukranian.pdf`,
      }, {
        label: `tiếng Việt / Vietnamese`,
        pdf: `vietnamese.pdf`,
    }];

    constructor(
        private router: Router,
        private route: ActivatedRoute,
        private title: Title,
        private gateway: Gateway,
        public app: AppService,
        public register: RegisterService,
    ) {}

    ngOnInit() {
        // It's possible an auth token from another app component (e.g.
        // patron requests) is still present.  We explicitly don't want
        // an auth token for self-registration, so clear it.
        this.app.clearAuth();

        this.route.queryParams.subscribe((params: Params) => {
			this.register.inKioskMode = Boolean(params.kiosk);
        });

        this.title.setTitle($localize`Get a Library Card`);
    }
}

