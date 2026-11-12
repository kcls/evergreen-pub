-- Revert kcls-evergreen:0035-cataloged-headings-915d from pg

BEGIN;

-- CREATE OR REPLACE VIEW cannot drop a column, so both views are
-- dropped and recreated with their original definitions.

DROP VIEW reporter.cataloged_browse_entry_detail;
DROP VIEW reporter.live_cataloged_browse_entry;

CREATE VIEW reporter.live_cataloged_browse_entry AS
 WITH cataloged_entries AS (
         SELECT entry.id AS entry,
            entry.value AS entry_value,
            entry.sort_value AS entry_sort_value,
            entry.create_date AS entry_create_date,
            map.source AS bib_record,
            map.def AS field_def,
            bre.cataloging_date AS bib_cataloging_date,
            bre.editor AS bib_editor,
            bre.edit_date AS bib_edit_date,
            bre.create_date AS bib_create_date,
            cmf.field_class AS browse_axis,
            cmf.label AS field_label,
            ccvm.code AS mattype,
            GREATEST(bre.cataloging_date, entry.create_date) AS heading_date,
            rank() OVER (PARTITION BY entry.id ORDER BY bre.cataloging_date, map.id) AS rank
           FROM (((((metabib.browse_entry entry
             JOIN metabib.browse_entry_def_map map ON ((map.entry = entry.id)))
             JOIN config.metabib_field cmf ON ((cmf.id = map.def)))
             JOIN biblio.record_entry bre ON ((bre.id = map.source)))
             JOIN metabib.record_attr_vector_list vec ON ((vec.source = bre.id)))
             JOIN config.coded_value_map ccvm ON (((ccvm.ctype = 'mattype'::text) AND (ccvm.id = ANY (vec.vlist)))))
          WHERE ((bre.cataloging_date IS NOT NULL) AND (cmf.field_class = ANY (ARRAY['author'::text, 'subject'::text, 'series'::text])))
        )
 SELECT all_entries.entry,
    all_entries.entry_value,
    all_entries.entry_sort_value,
    all_entries.entry_create_date,
    all_entries.bib_record,
    all_entries.field_def,
    all_entries.bib_cataloging_date,
    all_entries.bib_editor,
    all_entries.bib_edit_date,
    all_entries.bib_create_date,
    all_entries.browse_axis,
    all_entries.field_label,
    all_entries.mattype,
    all_entries.heading_date,
    all_entries.rank
   FROM cataloged_entries all_entries
  WHERE (all_entries.rank = 1);

CREATE VIEW reporter.cataloged_browse_entry_detail AS
 SELECT entry.entry,
    entry.entry_value,
    entry.entry_sort_value,
    entry.entry_create_date,
    entry.bib_record,
    entry.field_def,
    entry.bib_cataloging_date,
    entry.bib_editor,
    entry.bib_edit_date,
    entry.bib_create_date,
    entry.browse_axis,
    entry.field_label,
    entry.mattype,
    entry.heading_date,
    entry.rank,
    usr.usrname AS bib_editor_usrname,
    mfr.value AS bib_marc_001,
    evergreen.marc_tag_to_string('1'::text, bre.marc) AS bib_marc_1xx,
    evergreen.marc_tag_to_string('245'::text, bre.marc) AS bib_marc_245,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_entry AS prev_entry,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_entry_value AS prev_entry_value,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_entry_sort_value AS prev_entry_sort_value,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_entry_create_date AS prev_entry_create_date,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_bib_record AS prev_bib_record,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_bib_editor AS prev_bib_editor,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_bib_edit_date AS prev_bib_edit_date,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_bib_create_date AS prev_bib_create_date,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_bib_cataloging_date AS prev_bib_cataloging_date,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_field_def AS prev_field_def,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_field_label AS prev_field_label,
    (reporter.metabib_browse_entry_window_prev(entry.browse_axis, entry.entry_sort_value)).prev_auth_tag AS prev_auth_tag,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_entry AS next_entry,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_entry_value AS next_entry_value,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_entry_sort_value AS next_entry_sort_value,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_entry_create_date AS next_entry_create_date,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_bib_record AS next_bib_record,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_bib_editor AS next_bib_editor,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_bib_edit_date AS next_bib_edit_date,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_bib_create_date AS next_bib_create_date,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_bib_cataloging_date AS next_bib_cataloging_date,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_field_def AS next_field_def,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_field_label AS next_field_label,
    (reporter.metabib_browse_entry_window_next(entry.browse_axis, entry.entry_sort_value)).next_auth_tag AS next_auth_tag
   FROM (((reporter.live_cataloged_browse_entry entry
     JOIN biblio.record_entry bre ON ((bre.id = entry.bib_record)))
     JOIN metabib.full_rec mfr ON (((bre.id = mfr.record) AND (mfr.tag = '001'::bpchar))))
     JOIN actor.usr usr ON ((usr.id = bre.editor)))
  ORDER BY
        CASE entry.browse_axis
            WHEN 'author'::text THEN 1
            WHEN 'subject'::text THEN 2
            ELSE 3
        END, entry.entry_sort_value;

COMMIT;
