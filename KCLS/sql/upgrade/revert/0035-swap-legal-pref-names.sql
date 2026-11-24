-- Revert kcls-evergreen:0035-swap-legal-pref-names from pg

-- Exchanging base and pref name values is its own inverse, so the data
-- statements match the deploy script.

BEGIN;

CREATE OR REPLACE VIEW reporter.classic_item_list AS
 SELECT rmsr.title,
    rmsr.author,
    rmsr.pubdate,
    cp.id,
    cp.price,
    cp.barcode,
    cn.label AS call_number_label,
        CASE
            WHEN call_number_dewey(cn.label) ~ '^[0-9.]+$'::text THEN btrim(to_char(10::double precision * floor(call_number_dewey(cn.label)::double precision / 10::double precision), '000'::text))
            ELSE NULL::text
        END AS dewey_block_tens,
        CASE
            WHEN call_number_dewey(cn.label) ~ '^[0-9.]+$'::text THEN btrim(to_char(100::double precision * floor(call_number_dewey(cn.label)::double precision / 100::double precision), '000'::text))
            ELSE NULL::text
        END AS dewey_block_hundreds,
    erfcc.circ_count AS use_count,
    cp.circ_modifier,
    sl.name AS shelving_location,
    sc1.stat_cat_entry AS stat_cat_1,
    sc2.stat_cat_entry AS stat_cat_2,
    sce1.value AS stat_cat_1_value,
    sce2.value AS stat_cat_2_value,
    cp.edit_date,
    cp.create_date,
    ol.shortname AS owning_lib_name,
    cn.owning_lib,
    cl.shortname AS circ_lib_name,
    cl.id AS circ_lib,
    cp.creator,
    cp.age_protect,
    cp.opac_visible,
    cp.ref,
    cp.deposit_amount,
    cp.deleted,
    rmsr.tcn_value,
    cp.status,
    circ.stop_fines,
    circ.due_date,
    circ_card.barcode AS patron_barcode,
    (circ_u.first_given_name || ' '::text) || circ_u.family_name AS patron_name
   FROM asset.copy cp
     JOIN extend_reporter.full_circ_count erfcc ON cp.id = erfcc.id
     JOIN asset.copy_location sl ON cp.location = sl.id
     JOIN asset.call_number cn ON cp.call_number = cn.id
     JOIN actor.org_unit ol ON cn.owning_lib = ol.id
     JOIN actor.org_unit cl ON cp.circ_lib = cl.id
     JOIN reporter.materialized_simple_record rmsr ON cn.record = rmsr.id
     LEFT JOIN action.circulation circ ON circ.target_copy = cp.id AND circ.checkin_time IS NULL
     LEFT JOIN actor.usr circ_u ON circ_u.id = circ.usr
     LEFT JOIN actor.card circ_card ON circ_u.card = circ_card.id
     LEFT JOIN asset.stat_cat_entry_copy_map sc1 ON sc1.owning_copy = cp.id AND sc1.stat_cat = 1
     LEFT JOIN asset.stat_cat_entry sce1 ON sce1.id = sc1.stat_cat_entry
     LEFT JOIN asset.stat_cat_entry_copy_map sc2 ON sc2.owning_copy = cp.id AND sc2.stat_cat = 2
     LEFT JOIN asset.stat_cat_entry sce2 ON sce2.id = sc2.stat_cat_entry;

DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN

UPDATE actor.usr SET
    prefix = COALESCE(NULLIF(pref_prefix, ''), prefix),
    first_given_name = COALESCE(NULLIF(pref_first_given_name, ''), first_given_name),
    second_given_name = COALESCE(NULLIF(pref_second_given_name, ''), second_given_name),
    family_name = COALESCE(NULLIF(pref_family_name, ''), family_name),
    suffix = COALESCE(NULLIF(pref_suffix, ''), suffix),
    pref_prefix = CASE
        WHEN NULLIF(pref_prefix, '') IS NULL THEN NULL
        ELSE NULLIF(NULLIF(prefix, ''), pref_prefix) END,
    pref_first_given_name = CASE
        WHEN NULLIF(pref_first_given_name, '') IS NULL THEN NULL
        ELSE NULLIF(NULLIF(first_given_name, ''), pref_first_given_name) END,
    pref_second_given_name = CASE
        WHEN NULLIF(pref_second_given_name, '') IS NULL THEN NULL
        ELSE NULLIF(NULLIF(second_given_name, ''), pref_second_given_name) END,
    pref_family_name = CASE
        WHEN NULLIF(pref_family_name, '') IS NULL THEN NULL
        ELSE NULLIF(NULLIF(family_name, ''), pref_family_name) END,
    pref_suffix = CASE
        WHEN NULLIF(pref_suffix, '') IS NULL THEN NULL
        ELSE NULLIF(NULLIF(suffix, ''), pref_suffix) END
WHERE
    pref_prefix IS NOT NULL OR
    pref_first_given_name IS NOT NULL OR
    pref_second_given_name IS NOT NULL OR
    pref_family_name IS NOT NULL OR
    pref_suffix IS NOT NULL;

UPDATE staging.user_stage SET
    first_given_name = COALESCE(NULLIF(pref_first_given_name, ''), first_given_name),
    second_given_name = COALESCE(NULLIF(pref_second_given_name, ''), second_given_name),
    family_name = COALESCE(NULLIF(pref_family_name, ''), family_name),
    pref_first_given_name = CASE
        WHEN NULLIF(pref_first_given_name, '') IS NULL THEN NULL
        ELSE NULLIF(NULLIF(first_given_name, ''), pref_first_given_name) END,
    pref_second_given_name = CASE
        WHEN NULLIF(pref_second_given_name, '') IS NULL THEN NULL
        ELSE NULLIF(NULLIF(second_given_name, ''), pref_second_given_name) END,
    pref_family_name = CASE
        WHEN NULLIF(pref_family_name, '') IS NULL THEN NULL
        ELSE NULLIF(NULLIF(family_name, ''), pref_family_name) END
WHERE
    pref_first_given_name IS NOT NULL OR
    pref_second_given_name IS NOT NULL OR
    pref_family_name IS NOT NULL;

UPDATE sip.setting SET value = 'true'
    WHERE name = 'patron_inverse_pref_names';

UPDATE action_trigger.event_definition SET template =
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(template,
        'user.pref_first_given_name || user.first_given_name',
        'user.first_given_name'),
        'user.pref_family_name || user.family_name',
        'user.family_name'),
        'hold.usr.pref_first_given_name || hold.usr.first_given_name',
        'hold.usr.first_given_name'),
        'usr.pref_first_given_name || usr.first_given_name',
        'usr.first_given_name'),
        'patron.pref_first_given_name || patron.first_given_name',
        'patron.first_given_name')
WHERE template ~ 'pref_(first_given|family)_name';

UPDATE config.print_template SET template =
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(template,
        'patron.pref_prefix || patron.prefix', 'patron.prefix'),
        'patron.pref_first_given_name || patron.first_given_name',
        'patron.first_given_name'),
        'patron.pref_second_given_name || patron.second_given_name',
        'patron.second_given_name'),
        'patron.pref_family_name || patron.family_name',
        'patron.family_name'),
        'patron.pref_suffix || patron.suffix', 'patron.suffix'),
        '[% pfn = patron.family_name; pfn.trim.',
        '[% patron.family_name.trim.'),
        '[% pgn = patron.first_given_name; pgn.trim.',
        '[% patron.first_given_name.trim.')
WHERE name IN (
    'patron_address', 'patron_data', 'missing_pieces',
    'damaged_item_letter', 'hold_shelf_slip', 'hold_transit_slip');

UPDATE config.print_template SET template =
    REPLACE(template,
        'hold.usr_shelf_name;',
        'hold.usr_family_name _ '', '' _ hold.usr_first_given_name;')
WHERE name = 'hold_shelf_list';

UPDATE config.print_template SET template =
    REPLACE(REPLACE(REPLACE(template,
        '.pref_first_given_name', '.PREF_FIRST_TMP'),
        '.first_given_name', '.pref_first_given_name'),
        '.PREF_FIRST_TMP', '.first_given_name')
WHERE name IN ('items_out', 'checkout')
    AND template ~ 'pref_first_given_name\.length';

END IF; END $INSERT$;

COMMIT;
