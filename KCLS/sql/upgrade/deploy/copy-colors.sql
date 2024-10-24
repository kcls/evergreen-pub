-- Deploy kcls-evergreen:copy-colors to pg
-- requires: 0006-sip-filters

BEGIN;

CREATE TABLE config.copy_color (
    id SERIAL PRIMARY KEY,
    label TEXT NOT NULL,
    hex_code TEXT NOT NULL,
    owning_lib INTEGER NOT NULL REFERENCES actor.org_unit(id),
    CONSTRAINT ccl_label_once_per_owner UNIQUE (label, owning_lib)
);

ALTER TABLE asset.copy
    ADD COLUMN color INTEGER REFERENCES config.copy_color(id);

COMMIT;
