-- Deploy kcls-evergreen:0028-collection-hq-aged-circs to pg
-- requires: 0027-tote-checkin-sip-configs

BEGIN;

CREATE OR REPLACE FUNCTION collectionHQ.write_item_rows_to_stdout (TEXT, INT) RETURNS VOID AS $BODY$
-- Usage: SELECT collectionHQ.write_item_rows_to_stdout_2026 ('LIBRARYCODE',org_unit_id);
--
-- Reconciled revision (25-column output layout):
--   * Output matches the original exactly, including last_circ_lib (field 5).
--   * last_circ_lib + last_use_date sourced from action.all_circulation_slim
--     (live + aged) so anonymized circ history is not lost, and both come from
--     the SAME most-recent circ event.
--   * extract_date computed once; arrived (transit recv time) and
--     cumulative_use_total hoisted into the main set-based query.
--   * cumulative_use_total via extend_reporter.full_circ_count (correct
--     legacy+live+aged total) -- avoids the circulation/aged_circulation
--     fan-out bug present in the _new variant.
--   * Strict copy/call-number filtering retained (no deleted call numbers,
--     no negative/zero bib ids).
--   * cumulative_use_current is computed but the output emits a hardcoded 0,
--     matching the original. See the output block to enable it.

  DECLARE
    item BIGINT;
    authority_code ALIAS FOR $1;
    org_unit_id ALIAS FOR $2;
    lms_bib_id BIGINT;
    library_code TEXT;
    last_circ_lib TEXT;
    bar_code TEXT;
    last_use_date TEXT;
    cumulative_use_total TEXT;
    cumulative_use_current TEXT;
    status TEXT;
    date_added TEXT;
    price TEXT;
    purchase_code TEXT;
    rotating_stock TEXT;
    lib_supsel_tag TEXT;
    gen_supsel_tag TEXT;
    notes TEXT;
    extract_date TEXT;
    collection_code TEXT;
    collection_code_level_2 TEXT;
    filter_level_1 TEXT;
    filter_level_2 TEXT;
    filter_level_3 TEXT;
    filter_level_4 TEXT;
    isbn TEXT := '';
    output TEXT := '';
    arrived TIMESTAMPTZ;
    num_rows INTEGER := 0;

  BEGIN

    SELECT REPLACE(NOW()::DATE::TEXT, '-', '') INTO extract_date;

    -- Main set-based driver: one row per copy.
    --   * full_circ_count is 1:1 per copy id (correct legacy+live+aged total).
    --   * transit_copy is pre-aggregated to max(dest_recv_time) per (copy, dest)
    --     and joined on dest = circ_lib, so at most one arrival row per copy.
    -- Both LEFT JOINs are 1:1, so there is no row fan-out and no GROUP BY needed.
    FOR item, arrived, cumulative_use_total IN
      SELECT cp.id,
             atc.dest_recv_time,
             COALESCE(fcc.circ_count, 0)::TEXT
      FROM asset.copy cp
      JOIN asset.call_number acn ON acn.id = cp.call_number
      LEFT JOIN extend_reporter.full_circ_count fcc ON fcc.id = cp.id
      LEFT JOIN (
        SELECT target_copy, dest, MAX(dest_recv_time) AS dest_recv_time
        FROM action.transit_copy
        GROUP BY target_copy, dest
      ) atc ON atc.target_copy = cp.id AND atc.dest = cp.circ_lib
      WHERE NOT cp.deleted
        AND NOT acn.deleted
        AND acn.record > 0
        AND cp.circ_lib IN (SELECT id FROM actor.org_unit_descendants(org_unit_id))
      ORDER BY cp.id
    LOOP

      SELECT cn.record, cn.label, collectionHQ.attempt_isbn(cn.record::BIGINT)
      INTO lms_bib_id, filter_level_1, isbn
      FROM asset.call_number cn, asset.copy c
      WHERE c.call_number = cn.id AND c.id = item;

      SELECT collectionHQ.attempt_price(ac.price::TEXT), barcode, ac.status,
             REPLACE(create_date::DATE::TEXT, '-', ''),
             CASE WHEN floating::INT > 0 THEN 'Y' ELSE NULL END
      INTO price, bar_code, status, date_added, rotating_stock
      FROM asset.copy ac
      WHERE id = item;

      IF price IS NULL OR price = '' THEN
        SELECT collectionHQ.attempt_price((XPATH('//marc:datafield[@tag="020"][1]/marc:subfield[@code="c"]/text()', marc::XML, ARRAY[ARRAY['marc', 'http://www.loc.gov/MARC21/slim']]))[1]::TEXT)
        INTO price
        FROM biblio.record_entry
        WHERE id = lms_bib_id;
      END IF;

      SELECT ou.shortname INTO library_code FROM actor.org_unit ou, asset.copy c WHERE ou.id = c.circ_lib AND c.id = item;

      -- Combined live + aged circulation; last_circ_lib and last_use_date come
      -- from the SAME most-recent circ event so they are always consistent.
      SELECT aou.shortname, REPLACE(circ.xact_start::DATE::TEXT, '-', '')
      INTO last_circ_lib, last_use_date
      FROM action.all_circulation_slim circ
      JOIN actor.org_unit aou ON aou.id = circ.circ_lib
      WHERE circ.target_copy = item
      ORDER BY circ.xact_start DESC
      LIMIT 1;

      -- Computed (live + aged) but discarded by default -- see output block below.
      IF arrived IS NOT NULL THEN
        SELECT COUNT(*) INTO cumulative_use_current FROM action.all_circulation_slim WHERE target_copy = item AND xact_start > arrived;
      ELSE
        cumulative_use_current := '0';
      END IF;

      SELECT SUBSTRING(value FROM 1 FOR 100) INTO notes FROM asset.copy_note WHERE owning_copy = item AND title ILIKE '%collectionHQ%' ORDER BY id LIMIT 1;
      SELECT l.name INTO collection_code FROM asset.copy c, asset.copy_location l WHERE c.location = l.id AND c.id = item;

      purchase_code := ''; -- FIXME do we want something else here?
      lib_supsel_tag := ''; -- FIXME do we want something else here?
      gen_supsel_tag := ''; -- FIXME do we want something else here?
      collection_code_level_2 := ''; -- FIXME do we want something else here?
      filter_level_2 := ''; -- FIXME do we want something else here?
      filter_level_3 := ''; -- FIXME do we want something else here?
      filter_level_4 := ''; -- FIXME do we want something else here?

      output := '##HOLD##,'
        || lms_bib_id || ','
        || COALESCE(collectionHQ.quote(authority_code), '') || ','
        || COALESCE(collectionHQ.quote(library_code), '') || ','
        || COALESCE(collectionHQ.quote(last_circ_lib), '') || ','
        || COALESCE(collectionHQ.quote(bar_code), '') || ','
        || COALESCE(collectionHQ.quote(last_use_date), '') || ','
        || COALESCE(cumulative_use_total, '') || ','
        -- To emit the real current-use count, uncomment the next line and
        -- comment out the '0 ,' line below it:
        --|| COALESCE(cumulative_use_current, '') || ','
        || '0 ,'
        || COALESCE(collectionHQ.quote(status), '') || ','
        || COALESCE(collectionHQ.quote(date_added), '') || ','
        || COALESCE(price, '') || ','
        || COALESCE(collectionHQ.quote(purchase_code), '') || ','
        || COALESCE(collectionHQ.quote(rotating_stock), '') || ','
        || COALESCE(collectionHQ.quote(lib_supsel_tag), '') || ','
        || COALESCE(collectionHQ.quote(gen_supsel_tag), '') || ','
        || COALESCE(collectionHQ.quote(notes), '') || ','
        || COALESCE(collectionHQ.quote(extract_date), '') || ','
        || COALESCE(collectionHQ.quote(collection_code), '') || ','
        || COALESCE(collectionHQ.quote(collection_code_level_2), '') || ','
        || COALESCE(collectionHQ.quote(filter_level_1), '') || ','
        || COALESCE(collectionHQ.quote(filter_level_2), '') || ','
        || COALESCE(collectionHQ.quote(filter_level_3), '') || ','
        || COALESCE(collectionHQ.quote(filter_level_4), '') || ','
        || COALESCE(collectionHQ.quote(isbn), '');

      RAISE INFO '%', output;

      num_rows := num_rows + 1;
      IF (num_rows::numeric % 1000.0 = 0.0) THEN RAISE INFO '% rows written', num_rows; END IF;

    END LOOP;

    RAISE INFO '% rows written in total.', num_rows;

  END;

$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

COMMIT;

