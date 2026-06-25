-- Revert kcls-evergreen:0028-collection-hq-aged-circs from pg

BEGIN;

CREATE OR REPLACE FUNCTION collectionHQ.write_item_rows_to_stdout (TEXT, INT) RETURNS VOID AS $$
-- Usage: SELECT collectionHQ.write_item_rows_to_stdout ('LIBRARYCODE',org_unit_id);

  DECLARE
    item BIGINT;
    authority_code ALIAS FOR $1;
    org_unit_id ALIAS for $2;
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

    FOR item IN
      SELECT acp.id 
      FROM asset.copy acp
      JOIN asset.call_number acn ON acn.id = acp.call_number
      WHERE 
        NOT acp.deleted 
        AND NOT acn.deleted -- meh
        AND acn.record > 0
        AND acp.circ_lib IN (SELECT id FROM actor.org_unit_descendants(org_unit_id)) 
      ORDER BY id
    LOOP

      SELECT cn.record, cn.label, collectionHQ.attempt_isbn(cn.record::BIGINT)
      INTO lms_bib_id, filter_level_1, isbn
      FROM asset.call_number cn, asset.copy c 
      WHERE c.call_number = cn.id AND c.id =  item;
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
      SELECT REPLACE(NOW()::DATE::TEXT, '-', '') INTO extract_date;
      SELECT ou.shortname INTO library_code FROM actor.org_unit ou, asset.copy c WHERE ou.id = c.circ_lib AND c.id = item;
      SELECT aou.shortname, REPLACE(circ.xact_start::DATE::TEXT, '-', '') INTO last_circ_lib, last_use_date FROM actor.org_unit aou INNER JOIN action.all_circulation circ ON (circ.circ_lib = aou.id)
        WHERE circ.target_copy = item ORDER BY circ.xact_start DESC LIMIT 1;
      SELECT REPLACE(xact_start::DATE::TEXT, '-', '') INTO last_use_date FROM action.circulation WHERE target_copy = item ORDER BY xact_start DESC LIMIT 1;
      SELECT circ_count INTO cumulative_use_total FROM extend_reporter.full_circ_count WHERE id = item;
      IF cumulative_use_total IS NULL THEN
        cumulative_use_total := '0';
      END IF;
      SELECT MAX(dest_recv_time) INTO arrived
      FROM action.transit_copy atc
      JOIN asset.copy ac ON (ac.id = atc.target_copy AND ac.circ_lib = atc.dest)
      WHERE ac.id = item;
      IF arrived IS NOT NULL THEN
        SELECT COUNT(*) INTO cumulative_use_current FROM action.circulation WHERE target_copy = item AND xact_start > arrived;
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

$$ LANGUAGE plpgsql;


COMMIT;
