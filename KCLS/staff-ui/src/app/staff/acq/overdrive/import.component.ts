import {Component, OnInit, ViewChild} from '@angular/core';
import {tap} from 'rxjs/operators';
import {HttpClient, HttpRequest, HttpEventType} from '@angular/common/http';
import {HttpResponse, HttpErrorResponse} from '@angular/common/http';
import {ProgressInlineComponent} from '@eg/share/dialog/progress-inline.component';
import {IdlObject} from '@eg/core/idl.service';
import {AuthService} from '@eg/core/auth.service';
import {ToastService} from '@eg/share/toast/toast.service';

const OD_IMPORT_PATH = '/overdrive-invoice-upload';

@Component({
  templateUrl: 'import.component.html'
})
export class ImportComponent implements OnInit {

    selectedFile: File = null;
    numRead = 0;
    numCreated = 0;
    response: any;
    isUploading = false;
    testMode = false;

    @ViewChild('uploadProgress', {static: false})
        private uploadProgress: ProgressInlineComponent;

    constructor(
        private http: HttpClient,
        private toast: ToastService,
        private auth: AuthService
    ) {}

    ngOnInit() {}

    fileSelected($event) {
       this.selectedFile = $event.target.files[0];
    }

    upload() {
        this.isUploading = true;
        this.response = null;
        this.uploadProgress.update({value: 0, max: 1});

        this.uploadFile().then(
            ok => {
                this.isUploading = false;
            },
            err => {
                this.isUploading = false;
            }
        );
    }

    uploadFile(): Promise<any> {

        const formData: FormData = new FormData();

        formData.append('ses', this.auth.token());
        formData.append('csv_file', this.selectedFile, this.selectedFile.name);

        if (this.testMode) {
            formData.append('test_mode', '1');
        }

        const req = new HttpRequest('POST', OD_IMPORT_PATH, formData,
            {reportProgress: true, responseType: 'text'});

        return this.http.request(req).pipe(tap(
            evt => {
                if (evt.type === HttpEventType.UploadProgress) {
                    this.uploadProgress.update(
                        {value: evt.loaded, max: evt.total});

                } else if (evt instanceof HttpResponse) {
                    const json = evt.body as string;
                    this.response = JSON.parse(json);
                    this.numRead = this.response.invoices.length;
                    this.numCreated = this.response.invoices.filter(
                        inv => inv.imported === 1).length;
                }
            },

            (err: HttpErrorResponse) => {
                console.error(err);
                this.toast.danger(err.error);
            }
        )).toPromise();
    }
}

