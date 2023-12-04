-- Deploy kcls-evergreen:XXXX-pr-formats to pg
-- requires: 0017-org-select-short-names

BEGIN;

CREATE TABLE config.usr_item_request_format (
    code TEXT UNIQUE PRIMARY KEY,
    label TEXT UNIQUE NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    ill_only BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE config.usr_item_request_audience (
    code TEXT UNIQUE PRIMARY KEY,
    label TEXT UNIQUE NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE config.usr_item_request_lang (
    code TEXT UNIQUE PRIMARY KEY,
    label TEXT UNIQUE NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE
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

    INSERT INTO config.usr_item_request_audience (code, label, position) VALUES
        ('adult', 'Adult', 0),
        ('teen', 'Teen', 1),
        ('children', 'Children', 2)
        ;

    INSERT INTO config.usr_item_request_lang (code, label) VALUES
        ('english', 'English'),
        ('amharic', 'አማርኛ / Amharic'),
        ('arabic', 'ﻉﺮﺒﻳ / Arabic'),
        ('chinese', '中文 / Chinese'),
        ('french', 'Français / French'),
        ('german', 'Deutsch / German'),
        ('gujarati', 'ગુજરાતી / Gujarati'),
        ('hebrew', 'עִברִית / Hebrew'),
        ('hindi', 'हिंदी  / Hindi'),
        ('italian', 'italiano / Italian'),
        ('japanese', '日本語 / Japanese'),
        ('korean', '한국어 / Korean'),
        ('marathi', 'मराठी  / Marathi'),
        ('marshallese', 'Kajin M̧ajeļ / Marshallese'),
        ('punjabi', 'ਪੰਜਾਬੀ  / Punjabi/Panjabi'),
        ('persian', 'ﻑﺍﺮﺴﯾ / Persian'),
        ('portuguese', 'Português / Portuguese'),
        ('russian', 'Pусский / Russian'),
        ('somali', 'Soomaali / Somali'),
        ('spanish', 'Español / Spanish'),
        ('tagalog', 'Tagalog'),
        ('tamil', 'தமிழ்  / Tamil'),
        ('telugu', 'తెలుగు  / Telugu'),
        ('ukrainian', 'Українська / Ukrainian'),
        ('vietnamese', 'Tiếng Việt / Vietnamese')
        ;

END IF; END $INSERT$;

-- format

UPDATE config.usr_item_request_format SET ill_only = TRUE WHERE code IN ('microfilm', 'article');

ALTER TABLE actor.usr_item_request
    ALTER COLUMN format SET NOT NULL,
    ADD CONSTRAINT actor_usr_item_request_format_fkey FOREIGN KEY (format)
        REFERENCES config.usr_item_request_format(code);

-- audience

UPDATE actor.usr_item_request SET audience = 'adult' WHERE audience = 'Adult';
UPDATE actor.usr_item_request SET audience = 'teen' WHERE audience = 'Teen';
UPDATE actor.usr_item_request SET audience = 'children' WHERE audience = 'Children';

ALTER TABLE actor.usr_item_request
    ADD CONSTRAINT actor_usr_item_request_audience_fkey FOREIGN KEY (audience)
        REFERENCES config.usr_item_request_audience(code);

-- lang

UPDATE config.usr_item_request_lang SET is_default = TRUE WHERE code = 'english';

UPDATE actor.usr_item_request SET language = 'english' WHERE language = 'English';
UPDATE actor.usr_item_request SET language = 'amharic' WHERE language = 'አማርኛ / Amharic';
UPDATE actor.usr_item_request SET language = 'arabic' WHERE language = 'ﻉﺮﺒﻳ / Arabic';
UPDATE actor.usr_item_request SET language = 'chinese' WHERE language = '中文 / Chinese';
UPDATE actor.usr_item_request SET language = 'french' WHERE language = 'Français / French';
UPDATE actor.usr_item_request SET language = 'german' WHERE language = 'Deutsch / German';
UPDATE actor.usr_item_request SET language = 'gujarati' WHERE language = 'ગુજરાતી / Gujarati';
UPDATE actor.usr_item_request SET language = 'hebrew' WHERE language = 'עִברִית / Hebrew';
UPDATE actor.usr_item_request SET language = 'hindi' WHERE language = 'हिंदी  / Hindi';
UPDATE actor.usr_item_request SET language = 'italian' WHERE language = 'italiano / Italian';
UPDATE actor.usr_item_request SET language = 'japanese' WHERE language = '日本語 / Japanese';
UPDATE actor.usr_item_request SET language = 'korean' WHERE language = '한국어 / Korean';
UPDATE actor.usr_item_request SET language = 'marathi' WHERE language = 'मराठी  / Marathi';
UPDATE actor.usr_item_request SET language = 'marshallese' WHERE language = 'Kajin M̧ajeļ / Marshallese';
UPDATE actor.usr_item_request SET language = 'punjabi' WHERE language = 'ਪੰਜਾਬੀ  / Punjabi/Panjabi';
UPDATE actor.usr_item_request SET language = 'persian' WHERE language = 'ﻑﺍﺮﺴﯾ / Persian';
UPDATE actor.usr_item_request SET language = 'portuguese' WHERE language = 'Português / Portuguese';
UPDATE actor.usr_item_request SET language = 'russian' WHERE language = 'Pусский / Russian';
UPDATE actor.usr_item_request SET language = 'somali' WHERE language = 'Soomaali / Somali';
UPDATE actor.usr_item_request SET language = 'spanish' WHERE language = 'Español / Spanish';
UPDATE actor.usr_item_request SET language = 'tagalog' WHERE language = 'Tagalog';
UPDATE actor.usr_item_request SET language = 'tamil' WHERE language = 'தமிழ்  / Tamil';
UPDATE actor.usr_item_request SET language = 'telugu' WHERE language = 'తెలుగు  / Telugu';
UPDATE actor.usr_item_request SET language = 'ukrainian' WHERE language = 'Українська / Ukrainian';
UPDATE actor.usr_item_request SET language = 'vietnamese' WHERE language = 'Tiếng Việt / Vietnamese';

ALTER TABLE actor.usr_item_request
    ADD CONSTRAINT actor_usr_item_request_lang_fkey FOREIGN KEY (language)
        REFERENCES config.usr_item_request_lang(code);

COMMIT;


