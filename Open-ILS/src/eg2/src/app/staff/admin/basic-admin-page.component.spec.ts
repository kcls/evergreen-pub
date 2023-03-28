import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { IdlObject, IdlService } from '@eg/core/idl.service';
import { of } from 'rxjs';
import { BasicAdminPageComponent } from './basic-admin-page.component';

@Component({
    selector: 'eg-title',
    template: ''
})
class MockTitleComponent {
    @Input() prefix: string;
}

@Component({
    selector: 'eg-staff-banner',
    template: ''
})
class MockStaffBannerComponent {
    @Input() bannerText: string;
}

@Component({
    selector: 'eg-admin-page',
    template: ''
})
class MockAdminPageComponent {
    @Input() configLinkBasePath: string;
    @Input() disableOrgFilter: boolean;
    @Input() fieldOrder: string;
    @Input() idlClass: string;
    @Input() persistKeyPfx: string;
    @Input() readonlyFields: string;
    @Input() enableUndelete: boolean;
}

describe('Component: BasicAdminPage', () => {
    let component: BasicAdminPageComponent;
    let fixture: ComponentFixture<BasicAdminPageComponent>;
    let idlServiceStub: Partial<IdlService>;
    let routeStub: any;

    beforeEach(() => {
        idlServiceStub = {
            create: (cls: string, seed?: []) => {
                return {
                    a: seed || [],
                    classname: cls,
                    _isfieldmapper: true,

                    field1(value: any): any {
                        this.a[0] = value;
                        return this.a[0];
                    }
                };
            },
            classes: [{ tbl1: { table: 'schema1.table1' } }]
        };

        const emptyParamMap: ParamMap = {
            has: (name: string) => false,
            get: (name: string) => null,
            getAll: (name: string) => [],
            keys: []
        };
        const data = [{
            schema: 'schema1',
            table: 'table1',
            enableUndelete: true
        }];
        const parentRoute = { url: of('') };
        const snapshot = { parent: { url: [{ path: '' }] } };
        routeStub = {
            paramMap: of(emptyParamMap),
            data: of(data),
            parent: parentRoute,
            snapshot
        };

        TestBed.configureTestingModule({
            imports: [],
            providers: [
                { provide: IdlService, useValue: idlServiceStub },
                { provide: ActivatedRoute, useValue: routeStub }
            ],
            declarations: [
                BasicAdminPageComponent,
                MockTitleComponent,
                MockStaffBannerComponent,
                MockAdminPageComponent
            ]
        });
        fixture = TestBed.createComponent(BasicAdminPageComponent);
        component = fixture.componentInstance;
        component.idlClass = 'tbl1';
        fixture.detectChanges();
    });

    it('sets enableUndelete from routing data', () => {
        const adminPage: MockAdminPageComponent = fixture.debugElement.query(
            By.directive(MockAdminPageComponent)).componentInstance;
        expect(adminPage.enableUndelete).toEqual(true);
    });
});
