
BEGIN;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN

    INSERT INTO actor.org_unit (parent_ou, ou_type, shortname, name, opac_visible, fiscal_calendar)
      VALUES (1, 3, 'OK', 'Oakesdale', FALSE, 1);

    INSERT INTO actor.org_unit_setting (org_unit, name, value)
      VALUES (
        (SELECT id FROM actor.org_unit WHERE shortname = 'OK'),
        'opac.holds.org_unit_not_pickup_lib',
        'true'
      );

    INSERT INTO sip.setting_group (label, institution) VALUES ('KCLS Central Sorter', 'kcls');

    -- copy existing settings from 'KCLS' group
    INSERT INTO sip.setting (setting_group, name, description, value)
      SELECT
        (SELECT id FROM sip.setting_group WHERE label = 'KCLS Central Sorter'),
        name,
        description,
        value
      FROM sip.setting WHERE setting_group = 1001;

    -- new stuff for sorter
    INSERT INTO sip.setting (setting_group, name, description, value)
      VALUES (
        (SELECT id FROM sip.setting_group WHERE label = 'KCLS Central Sorter'),
        'msg17_stamp_transit',
        'Update Transits on Checkin',
        'true'
      );

    INSERT INTO actor.workstation (name, owning_lib)
      SELECT 'OK-sorter-01', (SELECT id FROM actor.org_unit WHERE shortname = 'OK');
    INSERT INTO actor.workstation (name, owning_lib)
      SELECT 'OK-sorter-02', (SELECT id FROM actor.org_unit WHERE shortname = 'OK');
    INSERT INTO actor.workstation (name, owning_lib)
      SELECT 'OK-sorter-03', (SELECT id FROM actor.org_unit WHERE shortname = 'OK');
    INSERT INTO actor.workstation (name, owning_lib)
      SELECT 'OK-sorter-04', (SELECT id FROM actor.org_unit WHERE shortname = 'OK');
    INSERT INTO actor.workstation (name, owning_lib)
      SELECT 'OK-sorter-05', (SELECT id FROM actor.org_unit WHERE shortname = 'OK');
    INSERT INTO actor.workstation (name, owning_lib)
      SELECT 'OK-sorter-06', (SELECT id FROM actor.org_unit WHERE shortname = 'OK');

END IF; END $INSERT$;

COMMIT;
