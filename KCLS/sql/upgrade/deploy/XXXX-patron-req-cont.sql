- - Deploy kcls-evergreen:XXXX-patron-req-cont to pg
-- requires: 0004-damaged-item-letter

BEGIN;

ALTER TABLE actor.usr_item_request
    ADD COLUMN ill_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN id_matched BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN patron_notes TEXT,
    ADD COLUMN requestor INTEGER NOT NULL,
    ADD COLUMN ill_denial TEXT,
    ADD COLUMN lineitem INTEGER REFERENCES acq.lineitem(id)
;


DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN                         

INSERT into config.org_unit_setting_type
    (name, grp, label, description, datatype, fm_class) 
VALUES (
    'patron_requests.max_active', 
    'opac', 
    'Max Active Patron Purchase/ILL Requests',
    'Max Active Patron Purchase/ILL Requests',
    'integer',
    NULL
);

INSERT INTO actor.org_unit_setting (org_unit, name, value) 
    VALUES (1, 'patron_requests.max_active', '20');

INSERT INTO permission.perm_list (code, description) VALUES (
    'CREATE_USER_ITEM_REQUEST', 
    'Allows staff to create purchase/ill requests on behalf of a patron'
);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.grid.staff.cat.requests', 'cat', 'bool',
    oils_i18n_gettext(
        'eg.grid.staff.cat.requests',
        'Patron Requests Management Grid Settings',
        'cwst','label'
    )
);


END IF; END $INSERT$;                                                          

COMMIT;
