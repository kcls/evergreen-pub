-- Deploy kcls-evergreen:XXXX-pr-formats to pg
-- requires: 0017-org-select-short-names

BEGIN;

CREATE TABLE config.usr_item_request_format (
    code TEXT UNIQUE PRIMARY KEY,
    label TEXT UNIQUE NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    ill_only BOOLEAN NOT NULL DEFAULT FALSE
);

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN

    INSERT INTO config.usr_item_request_format (code, label, position) VALUES
        ('book', 'Book', 0),
        ('large-print', 'Large Print', 1),
        ('audiobook', 'Audiobook', 2),
        ('cd', 'Music CD', 3),
        ('dvd', 'DVD', 4),
        ('ebook-eaudio', 'eBook or Downloadable Audiobook', 5),
        ('article', 'Magazine, Newspaper, or Journal Article', 6),
        ('subscription', 'Magazine or Newspaper Subscription', 7),
        ('microfilm', 'Microfilm', 8)
    ;

END IF; END $INSERT$;

UPDATE config.usr_item_request_format SET ill_only = TRUE WHERE code IN ('microfilm', 'article');

ALTER TABLE actor.usr_item_request 
    ALTER COLUMN format SET NOT NULL,
    ADD CONSTRAINT actor_usr_item_request_format_fkey FOREIGN KEY (format)
        REFERENCES config.usr_item_request_format(code);

COMMIT;
