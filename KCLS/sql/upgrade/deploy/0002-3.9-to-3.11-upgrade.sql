-- Deploy kcls-evergreen:XXXX-3.9-to-3.11-upgrade to pg
-- requires: 0000-kcls-base-schema-3.9

BEGIN;

SELECT 'Starting', CLOCK_TIMESTAMP();

-- SELECT evergreen.upgrade_deps_block_check('1329', :eg_version);

CREATE TABLE config.openathens_uid_field (
    id      SERIAL  PRIMARY KEY,
    name    TEXT    NOT NULL
);

CREATE TABLE config.openathens_name_field (
    id      SERIAL  PRIMARY KEY,
    name    TEXT    NOT NULL
);

CREATE TABLE config.openathens_identity (
    id                          SERIAL  PRIMARY KEY,
    active                      BOOL    NOT NULL DEFAULT true,
    org_unit                    INT     NOT NULL REFERENCES actor.org_unit (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    api_key                     TEXT    NOT NULL,
    connection_id               TEXT    NOT NULL,
    connection_uri              TEXT    NOT NULL,
    auto_signon_enabled         BOOL    NOT NULL DEFAULT true,
    auto_signout_enabled        BOOL    NOT NULL DEFAULT false,
    unique_identifier           INT     NOT NULL REFERENCES config.openathens_uid_field (id) DEFAULT 1,
    display_name                INT     NOT NULL REFERENCES config.openathens_name_field (id) DEFAULT 1,
    release_prefix              BOOL    NOT NULL DEFAULT false,
    release_first_given_name    BOOL    NOT NULL DEFAULT false,
    release_second_given_name   BOOL    NOT NULL DEFAULT false,
    release_family_name         BOOL    NOT NULL DEFAULT false,
    release_suffix              BOOL    NOT NULL DEFAULT false,
    release_email               BOOL    NOT NULL DEFAULT false,
    release_home_ou             BOOL    NOT NULL DEFAULT false,
    release_barcode             BOOL    NOT NULL DEFAULT false
);



-- SKIPPING 
-- SELECT evergreen.upgrade_deps_block_check('1342', :eg_version);

--SELECT evergreen.upgrade_deps_block_check('1343', :eg_version);

ALTER TABLE actor.hours_of_operation
    ADD COLUMN dow_0_note TEXT,
    ADD COLUMN dow_1_note TEXT,
    ADD COLUMN dow_2_note TEXT,
    ADD COLUMN dow_3_note TEXT,
    ADD COLUMN dow_4_note TEXT,
    ADD COLUMN dow_5_note TEXT,
    ADD COLUMN dow_6_note TEXT;

-- SKIPPING
-- SELECT evergreen.upgrade_deps_block_check('1344', :eg_version);

-- SKIPPING / already have
-- SELECT evergreen.upgrade_deps_block_check('1345', :eg_version);

-- SKIPPING / already have
-- SELECT evergreen.upgrade_deps_block_check('1346', :eg_version); 


--SELECT evergreen.upgrade_deps_block_check('1347', :eg_version);   

CREATE OR REPLACE FUNCTION actor.usr_purge_data(
	src_usr  IN INTEGER,
	specified_dest_usr IN INTEGER
) RETURNS VOID AS $$
DECLARE
	suffix TEXT;
	renamable_row RECORD;
	dest_usr INTEGER;
BEGIN

	IF specified_dest_usr IS NULL THEN
		dest_usr := 1; -- Admin user on stock installs
	ELSE
		dest_usr := specified_dest_usr;
	END IF;

    -- action_trigger.event (even doing this, event_output may--and probably does--contain PII and should have a retention/removal policy)
    UPDATE action_trigger.event SET context_user = dest_usr WHERE context_user = src_usr;

	-- acq.*
	UPDATE acq.fund_allocation SET allocator = dest_usr WHERE allocator = src_usr;
	UPDATE acq.lineitem SET creator = dest_usr WHERE creator = src_usr;
	UPDATE acq.lineitem SET editor = dest_usr WHERE editor = src_usr;
	UPDATE acq.lineitem SET selector = dest_usr WHERE selector = src_usr;
	UPDATE acq.lineitem_note SET creator = dest_usr WHERE creator = src_usr;
	UPDATE acq.lineitem_note SET editor = dest_usr WHERE editor = src_usr;
	UPDATE acq.invoice SET closed_by = dest_usr WHERE closed_by = src_usr;
	DELETE FROM acq.lineitem_usr_attr_definition WHERE usr = src_usr;

	-- Update with a rename to avoid collisions
	FOR renamable_row in
		SELECT id, name
		FROM   acq.picklist
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  acq.picklist
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = renamable_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	UPDATE acq.picklist SET creator = dest_usr WHERE creator = src_usr;
	UPDATE acq.picklist SET editor = dest_usr WHERE editor = src_usr;
	UPDATE acq.po_note SET creator = dest_usr WHERE creator = src_usr;
	UPDATE acq.po_note SET editor = dest_usr WHERE editor = src_usr;
	UPDATE acq.purchase_order SET owner = dest_usr WHERE owner = src_usr;
	UPDATE acq.purchase_order SET creator = dest_usr WHERE creator = src_usr;
	UPDATE acq.purchase_order SET editor = dest_usr WHERE editor = src_usr;
	UPDATE acq.claim_event SET creator = dest_usr WHERE creator = src_usr;

	-- action.*
	DELETE FROM action.circulation WHERE usr = src_usr;
	UPDATE action.circulation SET circ_staff = dest_usr WHERE circ_staff = src_usr;
	UPDATE action.circulation SET checkin_staff = dest_usr WHERE checkin_staff = src_usr;
	UPDATE action.hold_notification SET notify_staff = dest_usr WHERE notify_staff = src_usr;
	UPDATE action.hold_request SET fulfillment_staff = dest_usr WHERE fulfillment_staff = src_usr;
	UPDATE action.hold_request SET requestor = dest_usr WHERE requestor = src_usr;
	DELETE FROM action.hold_request WHERE usr = src_usr;
	UPDATE action.in_house_use SET staff = dest_usr WHERE staff = src_usr;
	UPDATE action.non_cat_in_house_use SET staff = dest_usr WHERE staff = src_usr;
	DELETE FROM action.non_cataloged_circulation WHERE patron = src_usr;
	UPDATE action.non_cataloged_circulation SET staff = dest_usr WHERE staff = src_usr;
	DELETE FROM action.survey_response WHERE usr = src_usr;
	UPDATE action.fieldset SET owner = dest_usr WHERE owner = src_usr;
	DELETE FROM action.usr_circ_history WHERE usr = src_usr;
	UPDATE action.curbside SET notes = NULL WHERE patron = src_usr;

	-- actor.*
	DELETE FROM actor.card WHERE usr = src_usr;
	DELETE FROM actor.stat_cat_entry_usr_map WHERE target_usr = src_usr;
	DELETE FROM actor.usr_privacy_waiver WHERE usr = src_usr;
	DELETE FROM actor.usr_message WHERE usr = src_usr;

	-- The following update is intended to avoid transient violations of a foreign
	-- key constraint, whereby actor.usr_address references itself.  It may not be
	-- necessary, but it does no harm.
	UPDATE actor.usr_address SET replaces = NULL
		WHERE usr = src_usr AND replaces IS NOT NULL;
	DELETE FROM actor.usr_address WHERE usr = src_usr;
	DELETE FROM actor.usr_org_unit_opt_in WHERE usr = src_usr;
	UPDATE actor.usr_org_unit_opt_in SET staff = dest_usr WHERE staff = src_usr;
	DELETE FROM actor.usr_setting WHERE usr = src_usr;
	DELETE FROM actor.usr_standing_penalty WHERE usr = src_usr;
	UPDATE actor.usr_message SET title = 'purged', message = 'purged', read_date = NOW() WHERE usr = src_usr;
	DELETE FROM actor.usr_message WHERE usr = src_usr;
	UPDATE actor.usr_standing_penalty SET staff = dest_usr WHERE staff = src_usr;
	UPDATE actor.usr_message SET editor = dest_usr WHERE editor = src_usr;

	-- asset.*
	UPDATE asset.call_number SET creator = dest_usr WHERE creator = src_usr;
	UPDATE asset.call_number SET editor = dest_usr WHERE editor = src_usr;
	UPDATE asset.call_number_note SET creator = dest_usr WHERE creator = src_usr;
	UPDATE asset.copy SET creator = dest_usr WHERE creator = src_usr;
	UPDATE asset.copy SET editor = dest_usr WHERE editor = src_usr;
	UPDATE asset.copy_note SET creator = dest_usr WHERE creator = src_usr;

	-- auditor.*
	DELETE FROM auditor.actor_usr_address_history WHERE id = src_usr;
	DELETE FROM auditor.actor_usr_history WHERE id = src_usr;
	UPDATE auditor.asset_call_number_history SET creator = dest_usr WHERE creator = src_usr;
	UPDATE auditor.asset_call_number_history SET editor  = dest_usr WHERE editor  = src_usr;
	UPDATE auditor.asset_copy_history SET creator = dest_usr WHERE creator = src_usr;
	UPDATE auditor.asset_copy_history SET editor  = dest_usr WHERE editor  = src_usr;
	UPDATE auditor.biblio_record_entry_history SET creator = dest_usr WHERE creator = src_usr;
	UPDATE auditor.biblio_record_entry_history SET editor  = dest_usr WHERE editor  = src_usr;

	-- biblio.*
	UPDATE biblio.record_entry SET creator = dest_usr WHERE creator = src_usr;
	UPDATE biblio.record_entry SET editor = dest_usr WHERE editor = src_usr;
	UPDATE biblio.record_note SET creator = dest_usr WHERE creator = src_usr;
	UPDATE biblio.record_note SET editor = dest_usr WHERE editor = src_usr;

	-- container.*
	-- Update buckets with a rename to avoid collisions
	FOR renamable_row in
		SELECT id, name
		FROM   container.biblio_record_entry_bucket
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  container.biblio_record_entry_bucket
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = renamable_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	FOR renamable_row in
		SELECT id, name
		FROM   container.call_number_bucket
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  container.call_number_bucket
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = renamable_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	FOR renamable_row in
		SELECT id, name
		FROM   container.copy_bucket
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  container.copy_bucket
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = renamable_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	FOR renamable_row in
		SELECT id, name
		FROM   container.user_bucket
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  container.user_bucket
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = renamable_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	DELETE FROM container.user_bucket_item WHERE target_user = src_usr;

	-- money.*
	DELETE FROM money.billable_xact WHERE usr = src_usr;
	DELETE FROM money.collections_tracker WHERE usr = src_usr;
	UPDATE money.collections_tracker SET collector = dest_usr WHERE collector = src_usr;

	-- permission.*
	DELETE FROM permission.usr_grp_map WHERE usr = src_usr;
	DELETE FROM permission.usr_object_perm_map WHERE usr = src_usr;
	DELETE FROM permission.usr_perm_map WHERE usr = src_usr;
	DELETE FROM permission.usr_work_ou_map WHERE usr = src_usr;

	-- reporter.*
	-- Update with a rename to avoid collisions
	BEGIN
		FOR renamable_row in
			SELECT id, name
			FROM   reporter.output_folder
			WHERE  owner = src_usr
		LOOP
			suffix := ' (' || src_usr || ')';
			LOOP
				BEGIN
					UPDATE  reporter.output_folder
					SET     owner = dest_usr, name = name || suffix
					WHERE   id = renamable_row.id;
				EXCEPTION WHEN unique_violation THEN
					suffix := suffix || ' ';
					CONTINUE;
				END;
				EXIT;
			END LOOP;
		END LOOP;
	EXCEPTION WHEN undefined_table THEN
		-- do nothing
	END;

	BEGIN
		UPDATE reporter.report SET owner = dest_usr WHERE owner = src_usr;
	EXCEPTION WHEN undefined_table THEN
		-- do nothing
	END;

	-- Update with a rename to avoid collisions
	BEGIN
		FOR renamable_row in
			SELECT id, name
			FROM   reporter.report_folder
			WHERE  owner = src_usr
		LOOP
			suffix := ' (' || src_usr || ')';
			LOOP
				BEGIN
					UPDATE  reporter.report_folder
					SET     owner = dest_usr, name = name || suffix
					WHERE   id = renamable_row.id;
				EXCEPTION WHEN unique_violation THEN
					suffix := suffix || ' ';
					CONTINUE;
				END;
				EXIT;
			END LOOP;
		END LOOP;
	EXCEPTION WHEN undefined_table THEN
		-- do nothing
	END;

	BEGIN
		UPDATE reporter.schedule SET runner = dest_usr WHERE runner = src_usr;
	EXCEPTION WHEN undefined_table THEN
		-- do nothing
	END;

	BEGIN
		UPDATE reporter.template SET owner = dest_usr WHERE owner = src_usr;
	EXCEPTION WHEN undefined_table THEN
		-- do nothing
	END;

	-- Update with a rename to avoid collisions
	BEGIN
		FOR renamable_row in
			SELECT id, name
			FROM   reporter.template_folder
			WHERE  owner = src_usr
		LOOP
			suffix := ' (' || src_usr || ')';
			LOOP
				BEGIN
					UPDATE  reporter.template_folder
					SET     owner = dest_usr, name = name || suffix
					WHERE   id = renamable_row.id;
				EXCEPTION WHEN unique_violation THEN
					suffix := suffix || ' ';
					CONTINUE;
				END;
				EXIT;
			END LOOP;
		END LOOP;
	EXCEPTION WHEN undefined_table THEN
	-- do nothing
	END;

	-- vandelay.*
	-- Update with a rename to avoid collisions
	FOR renamable_row in
		SELECT id, name
		FROM   vandelay.queue
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  vandelay.queue
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = renamable_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

    UPDATE vandelay.session_tracker SET usr = dest_usr WHERE usr = src_usr;

    -- NULL-ify addresses last so other cleanup (e.g. circ anonymization)
    -- can access the information before deletion.
	UPDATE actor.usr SET
		active = FALSE,
		card = NULL,
		mailing_address = NULL,
		billing_address = NULL
	WHERE id = src_usr;

END;
$$ LANGUAGE plpgsql;

-- SKIPPING / ALREADY HAVE
-- SELECT evergreen.upgrade_deps_block_check('1348', :eg_version);

-- SKIPPING
-- SELECT evergreen.upgrade_deps_block_check('1349', :eg_version);


-- SELECT evergreen.upgrade_deps_block_check('1350', :eg_version);
CREATE OR REPLACE FUNCTION asset.merge_record_assets(target_record bigint, source_record bigint) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
    moved_objects INT := 0;
    source_cn     asset.call_number%ROWTYPE;
    target_cn     asset.call_number%ROWTYPE;
    metarec       metabib.metarecord%ROWTYPE;
    hold          action.hold_request%ROWTYPE;
    ser_rec       serial.record_entry%ROWTYPE;
    ser_sub       serial.subscription%ROWTYPE;
    acq_lineitem  acq.lineitem%ROWTYPE;
    acq_request   acq.user_request%ROWTYPE;
    booking       booking.resource_type%ROWTYPE;
    source_part   biblio.monograph_part%ROWTYPE;
    target_part   biblio.monograph_part%ROWTYPE;
    multi_home    biblio.peer_bib_copy_map%ROWTYPE;
    uri_count     INT := 0;
    counter       INT := 0;
    uri_datafield TEXT;
    uri_text      TEXT := '';
BEGIN

    -- we don't merge bib -1 
    IF target_record = -1 OR source_record = -1 THEN 
       RETURN 0;
    END IF;

    -- move any 856 entries on records that have at least one MARC-mapped URI entry
    SELECT  INTO uri_count COUNT(*)
      FROM  asset.uri_call_number_map m
            JOIN asset.call_number cn ON (m.call_number = cn.id)
      WHERE cn.record = source_record;

    IF uri_count > 0 THEN
        
        -- This returns more nodes than you might expect:
        -- 7 instead of 1 for an 856 with $u $y $9
        SELECT  COUNT(*) INTO counter
          FROM  oils_xpath_table(
                    'id',
                    'marc',
                    'biblio.record_entry',
                    '//*[@tag="856"]',
                    'id=' || source_record
                ) as t(i int,c text);
    
        FOR i IN 1 .. counter LOOP
            SELECT  '<datafield xmlns="http://www.loc.gov/MARC21/slim"' || 
            ' tag="856"' ||
            ' ind1="' || FIRST(ind1) || '"'  ||
            ' ind2="' || FIRST(ind2) || '">' ||
                        STRING_AGG(
                            '<subfield code="' || subfield || '">' ||
                            regexp_replace(
                                regexp_replace(
                                    regexp_replace(data,'&','&amp;','g'),
                                    '>', '&gt;', 'g'
                                ),
                                '<', '&lt;', 'g'
                            ) || '</subfield>', ''
                        ) || '</datafield>' INTO uri_datafield
              FROM  oils_xpath_table(
                        'id',
                        'marc',
                        'biblio.record_entry',
                        '//*[@tag="856"][position()=' || i || ']/@ind1|' ||
                        '//*[@tag="856"][position()=' || i || ']/@ind2|' ||
                        '//*[@tag="856"][position()=' || i || ']/*/@code|' ||
                        '//*[@tag="856"][position()=' || i || ']/*[@code]',
                        'id=' || source_record
                    ) as t(id int,ind1 text, ind2 text,subfield text,data text);

            -- As most of the results will be NULL, protect against NULLifying
            -- the valid content that we do generate
            uri_text := uri_text || COALESCE(uri_datafield, '');
        END LOOP;

        IF uri_text <> '' THEN
            UPDATE  biblio.record_entry
              SET   marc = regexp_replace(marc,'(</[^>]*record>)', uri_text || E'\\1')
              WHERE id = target_record;
        END IF;

    END IF;

    -- Find and move metarecords to the target record
    SELECT    INTO metarec *
      FROM    metabib.metarecord
      WHERE    master_record = source_record;

    IF FOUND THEN
        UPDATE    metabib.metarecord
          SET    master_record = target_record,
            mods = NULL
          WHERE    id = metarec.id;

        moved_objects := moved_objects + 1;
    END IF;

    -- Find call numbers attached to the source ...
    FOR source_cn IN SELECT * FROM asset.call_number WHERE record = source_record LOOP

        SELECT    INTO target_cn *
          FROM    asset.call_number
          WHERE    label = source_cn.label
            AND prefix = source_cn.prefix
            AND suffix = source_cn.suffix
            AND owning_lib = source_cn.owning_lib
            AND record = target_record
            AND NOT deleted;

        -- ... and if there's a conflicting one on the target ...
        IF FOUND THEN

            -- ... move the copies to that, and ...
            UPDATE    asset.copy
              SET    call_number = target_cn.id
              WHERE    call_number = source_cn.id;

            -- ... move V holds to the move-target call number
            FOR hold IN SELECT * FROM action.hold_request WHERE target = source_cn.id AND hold_type = 'V' LOOP
        
                UPDATE    action.hold_request
                  SET    target = target_cn.id
                  WHERE    id = hold.id;
        
                moved_objects := moved_objects + 1;
            END LOOP;
        
            UPDATE asset.call_number SET deleted = TRUE WHERE id = source_cn.id;

        -- ... if not ...
        ELSE
            -- ... just move the call number to the target record
            UPDATE    asset.call_number
              SET    record = target_record
              WHERE    id = source_cn.id;
        END IF;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- Find T holds targeting the source record ...
    FOR hold IN SELECT * FROM action.hold_request WHERE target = source_record AND hold_type = 'T' LOOP

        -- ... and move them to the target record
        UPDATE    action.hold_request
          SET    target = target_record
          WHERE    id = hold.id;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- Find serial records targeting the source record ...
    FOR ser_rec IN SELECT * FROM serial.record_entry WHERE record = source_record LOOP
        -- ... and move them to the target record
        UPDATE    serial.record_entry
          SET    record = target_record
          WHERE    id = ser_rec.id;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- Find serial subscriptions targeting the source record ...
    FOR ser_sub IN SELECT * FROM serial.subscription WHERE record_entry = source_record LOOP
        -- ... and move them to the target record
        UPDATE    serial.subscription
          SET    record_entry = target_record
          WHERE    id = ser_sub.id;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- Find booking resource types targeting the source record ...
    FOR booking IN SELECT * FROM booking.resource_type WHERE record = source_record LOOP
        -- ... and move them to the target record
        UPDATE    booking.resource_type
          SET    record = target_record
          WHERE    id = booking.id;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- Find acq lineitems targeting the source record ...
    FOR acq_lineitem IN SELECT * FROM acq.lineitem WHERE eg_bib_id = source_record LOOP
        -- ... and move them to the target record
        UPDATE    acq.lineitem
          SET    eg_bib_id = target_record
          WHERE    id = acq_lineitem.id;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- Find acq user purchase requests targeting the source record ...
    FOR acq_request IN SELECT * FROM acq.user_request WHERE eg_bib = source_record LOOP
        -- ... and move them to the target record
        UPDATE    acq.user_request
          SET    eg_bib = target_record
          WHERE    id = acq_request.id;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- Find parts attached to the source ...
    FOR source_part IN SELECT * FROM biblio.monograph_part WHERE record = source_record LOOP

        SELECT    INTO target_part *
          FROM    biblio.monograph_part
          WHERE    label = source_part.label
            AND record = target_record;

        -- ... and if there's a conflicting one on the target ...
        IF FOUND THEN

            -- ... move the copy-part maps to that, and ...
            UPDATE    asset.copy_part_map
              SET    part = target_part.id
              WHERE    part = source_part.id;

            -- ... move P holds to the move-target part
            FOR hold IN SELECT * FROM action.hold_request WHERE target = source_part.id AND hold_type = 'P' LOOP
        
                UPDATE    action.hold_request
                  SET    target = target_part.id
                  WHERE    id = hold.id;
        
                moved_objects := moved_objects + 1;
            END LOOP;

        -- ... if not ...
        ELSE
            -- ... just move the part to the target record
            UPDATE    biblio.monograph_part
              SET    record = target_record
              WHERE    id = source_part.id;
        END IF;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- Find multi_home items attached to the source ...
    FOR multi_home IN SELECT * FROM biblio.peer_bib_copy_map WHERE peer_record = source_record LOOP
        -- ... and move them to the target record
        UPDATE    biblio.peer_bib_copy_map
          SET    peer_record = target_record
          WHERE    id = multi_home.id;

        moved_objects := moved_objects + 1;
    END LOOP;

    -- And delete mappings where the item's home bib was merged with the peer bib
    DELETE FROM biblio.peer_bib_copy_map WHERE peer_record = (
        SELECT (SELECT record FROM asset.call_number WHERE id = call_number)
        FROM asset.copy WHERE id = target_copy
    );

    -- Apply merge tracking
    UPDATE biblio.record_entry 
        SET merge_date = NOW() WHERE id = target_record;

    UPDATE biblio.record_entry
        SET merge_date = NOW(), merged_to = target_record
        WHERE id = source_record;

    -- replace book bag entries of source_record with target_record
    UPDATE container.biblio_record_entry_bucket_item
        SET target_biblio_record_entry = target_record
        WHERE bucket IN (SELECT id FROM container.biblio_record_entry_bucket WHERE btype = 'bookbag')
        AND target_biblio_record_entry = source_record;

    -- move over record notes 
    UPDATE biblio.record_note 
        SET record = target_record, value = CONCAT(value,'; note merged from ',source_record::TEXT) 
        WHERE record = source_record
        AND NOT deleted;

    -- add note to record merge 
    INSERT INTO biblio.record_note (record, value) 
        VALUES (target_record,CONCAT('record ',source_record::TEXT,' merged on ',NOW()::TEXT));

    -- Finally, "delete" the source record
    UPDATE biblio.record_entry SET active = FALSE WHERE id = source_record;
    DELETE FROM biblio.record_entry WHERE id = source_record;

    -- That's all, folks!
    RETURN moved_objects;
END;
$_$;


-- SKIPPING
-- SELECT evergreen.upgrade_deps_block_check('1353', :eg_version);

-- SELECT evergreen.upgrade_deps_block_check('1354', :eg_version);
-- we have 1 pub note in prod.
ALTER TABLE biblio.record_note DROP COLUMN pub;


-- SKIPPING
-- SELECT evergreen.upgrade_deps_block_check('1356', :eg_version);

-- SKIPPING
-- SELECT evergreen.upgrade_deps_block_check('1357', :eg_version);

-- SELECT evergreen.upgrade_deps_block_check('1358', :eg_version);
SELECT 'Rebuilding config.ccmm_once_per_paramset', CLOCK_TIMESTAMP();

DROP INDEX config.ccmm_once_per_paramset;

CREATE UNIQUE INDEX ccmm_once_per_paramset ON config.circ_matrix_matchpoint (org_unit, grp, COALESCE(circ_modifier, ''), COALESCE(copy_location::TEXT, ''), COALESCE(marc_type, ''), COALESCE(marc_form, ''), COALESCE(marc_bib_level,''), COALESCE(marc_vr_format, ''), COALESCE(copy_circ_lib::TEXT, ''), COALESCE(copy_owning_lib::TEXT, ''), COALESCE(user_home_ou::TEXT, ''), COALESCE(ref_flag::TEXT, ''), COALESCE(juvenile_flag::TEXT, ''), COALESCE(is_renewal::TEXT, ''), COALESCE(usr_age_lower_bound, '0 seconds'), COALESCE(usr_age_upper_bound, '0 seconds'), COALESCE(item_age, '0 seconds')) WHERE active;

SELECT 'Rebuilding config.chmm_once_per_paramset', CLOCK_TIMESTAMP();

DROP INDEX config.chmm_once_per_paramset;

CREATE UNIQUE INDEX chmm_once_per_paramset ON config.hold_matrix_matchpoint (COALESCE(user_home_ou::TEXT, ''), COALESCE(request_ou::TEXT, ''), COALESCE(pickup_ou::TEXT, ''), COALESCE(item_owning_ou::TEXT, ''), COALESCE(item_circ_ou::TEXT, ''), COALESCE(usr_grp::TEXT, ''), COALESCE(requestor_grp::TEXT, ''), COALESCE(circ_modifier, ''), COALESCE(marc_type, ''), COALESCE(marc_form, ''), COALESCE(marc_bib_level, ''), COALESCE(marc_vr_format, ''), COALESCE(juvenile_flag::TEXT, ''), COALESCE(ref_flag::TEXT, ''), COALESCE(item_age, '0 seconds')) WHERE active;


SELECT 'Done with paramset indexes', CLOCK_TIMESTAMP();

-- SELECT evergreen.upgrade_deps_block_check('1359', :eg_version);

CREATE OR REPLACE FUNCTION search.symspell_dictionary_reify () RETURNS SETOF search.symspell_dictionary AS $f$
 WITH new_rows AS (
    DELETE FROM search.symspell_dictionary_updates WHERE transaction_id = txid_current() RETURNING *
 ), computed_rows AS ( -- this collapses the rows deleted into the format we need for UPSERT
    SELECT  SUM(keyword_count)    AS keyword_count,
            SUM(title_count)      AS title_count,
            SUM(author_count)     AS author_count,
            SUM(subject_count)    AS subject_count,
            SUM(series_count)     AS series_count,
            SUM(identifier_count) AS identifier_count,

            prefix_key,

            ARRAY_REMOVE(ARRAY_AGG(DISTINCT keyword_suggestions[1]), NULL)    AS keyword_suggestions,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT title_suggestions[1]), NULL)      AS title_suggestions,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT author_suggestions[1]), NULL)     AS author_suggestions,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT subject_suggestions[1]), NULL)    AS subject_suggestions,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT series_suggestions[1]), NULL)     AS series_suggestions,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT identifier_suggestions[1]), NULL) AS identifier_suggestions
      FROM  new_rows
      GROUP BY prefix_key
 )
 INSERT INTO search.symspell_dictionary AS d SELECT * FROM computed_rows
 ON CONFLICT (prefix_key) DO UPDATE SET
    keyword_count = GREATEST(0, d.keyword_count + EXCLUDED.keyword_count),
    keyword_suggestions = evergreen.text_array_merge_unique(EXCLUDED.keyword_suggestions,d.keyword_suggestions),

    title_count = GREATEST(0, d.title_count + EXCLUDED.title_count),
    title_suggestions = evergreen.text_array_merge_unique(EXCLUDED.title_suggestions,d.title_suggestions),

    author_count = GREATEST(0, d.author_count + EXCLUDED.author_count),
    author_suggestions = evergreen.text_array_merge_unique(EXCLUDED.author_suggestions,d.author_suggestions),

    subject_count = GREATEST(0, d.subject_count + EXCLUDED.subject_count),
    subject_suggestions = evergreen.text_array_merge_unique(EXCLUDED.subject_suggestions,d.subject_suggestions),

    series_count = GREATEST(0, d.series_count + EXCLUDED.series_count),
    series_suggestions = evergreen.text_array_merge_unique(EXCLUDED.series_suggestions,d.series_suggestions),

    identifier_count = GREATEST(0, d.identifier_count + EXCLUDED.identifier_count),
    identifier_suggestions = evergreen.text_array_merge_unique(EXCLUDED.identifier_suggestions,d.identifier_suggestions)

    WHERE (
        EXCLUDED.keyword_count <> 0 OR
        EXCLUDED.title_count <> 0 OR
        EXCLUDED.author_count <> 0 OR
        EXCLUDED.subject_count <> 0 OR
        EXCLUDED.series_count <> 0 OR
        EXCLUDED.identifier_count <> 0 OR
        NOT (EXCLUDED.keyword_suggestions <@ d.keyword_suggestions) OR
        NOT (EXCLUDED.title_suggestions <@ d.title_suggestions) OR
        NOT (EXCLUDED.author_suggestions <@ d.author_suggestions) OR
        NOT (EXCLUDED.subject_suggestions <@ d.subject_suggestions) OR
        NOT (EXCLUDED.series_suggestions <@ d.series_suggestions) OR
        NOT (EXCLUDED.identifier_suggestions <@ d.identifier_suggestions)
    )
 RETURNING *;
$f$ LANGUAGE SQL;

-- SELECT evergreen.upgrade_deps_block_check('1360', :eg_version); -- bshum / Dyrcona / JBoyer

-- replace functions from 300.schema.staged_search.sql

CREATE OR REPLACE FUNCTION asset.all_visible_flags () RETURNS TEXT AS $f$
    SELECT  '(' || STRING_AGG(search.calculate_visibility_attribute(1 << x, 'copy_flags')::TEXT,'&') || ')'
      FROM  GENERATE_SERIES(0,0) AS x; -- increment as new flags are added.
$f$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION asset.visible_orgs (otype TEXT) RETURNS TEXT AS $f$
    SELECT  '(' || STRING_AGG(search.calculate_visibility_attribute(id, $1)::TEXT,'|') || ')'
      FROM  actor.org_unit
      WHERE opac_visible;
$f$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION asset.invisible_orgs (otype TEXT) RETURNS TEXT AS $f$
    SELECT  '!(' || STRING_AGG(search.calculate_visibility_attribute(id, $1)::TEXT,'|') || ')'
      FROM  actor.org_unit
      WHERE NOT opac_visible;
$f$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION asset.bib_source_default () RETURNS TEXT AS $f$
    SELECT  '(' || STRING_AGG(search.calculate_visibility_attribute(id, 'bib_source')::TEXT,'|') || ')'
      FROM  config.bib_source
      WHERE transcendant;
$f$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION asset.location_group_default () RETURNS TEXT AS $f$
    SELECT '!()'::TEXT; -- For now, as there's no way to cause a location group to hide all copies.
/*
    SELECT  '!(' || STRING_AGG(search.calculate_visibility_attribute(id, 'location_group')::TEXT,'|') || ')'
      FROM  asset.copy_location_group
      WHERE NOT opac_visible;
*/
$f$ LANGUAGE SQL IMMUTABLE;

CREATE OR REPLACE FUNCTION asset.location_default () RETURNS TEXT AS $f$
    SELECT  '!(' || STRING_AGG(search.calculate_visibility_attribute(id, 'location')::TEXT,'|') || ')'
      FROM  asset.copy_location
      WHERE NOT opac_visible;
$f$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION asset.status_default () RETURNS TEXT AS $f$
    SELECT  '!(' || STRING_AGG(search.calculate_visibility_attribute(id, 'status')::TEXT,'|') || ')'
      FROM  config.copy_status
      WHERE NOT opac_visible;
$f$ LANGUAGE SQL STABLE;

-- replace unapi.mmr from 990.schema.unapi.sql

CREATE OR REPLACE FUNCTION unapi.mmr (
    obj_id BIGINT,
    format TEXT,
    ename TEXT,
    includes TEXT[],
    org TEXT,
    depth INT DEFAULT NULL,
    slimit HSTORE DEFAULT NULL,
    soffset HSTORE DEFAULT NULL,
    include_xmlns BOOL DEFAULT TRUE,
    pref_lib INT DEFAULT NULL
)
RETURNS XML AS $F$
DECLARE
    mmrec   metabib.metarecord%ROWTYPE;
    leadrec biblio.record_entry%ROWTYPE;
    subrec biblio.record_entry%ROWTYPE;
    layout  unapi.bre_output_layout%ROWTYPE;
    xfrm    config.xml_transform%ROWTYPE;
    ouid    INT;
    xml_buf TEXT; -- growing XML document
    tmp_xml TEXT; -- single-use XML string
    xml_frag TEXT; -- single-use XML fragment
    top_el  TEXT;
    output  XML;
    hxml    XML;
    axml    XML;
    subxml  XML; -- subordinate records elements
    sub_xpath TEXT; 
    parts   TEXT[]; 
BEGIN

    -- xpath for extracting bre.marc values from subordinate records 
    -- so they may be appended to the MARC of the master record prior
    -- to XSLT processing.
    -- subjects, isbn, issn, upc -- anything else?
    sub_xpath := 
      '//*[starts-with(@tag, "6") or @tag="020" or @tag="022" or @tag="024"]';

    IF org = '-' OR org IS NULL THEN
        SELECT shortname INTO org FROM evergreen.org_top();
    END IF;

    SELECT id INTO ouid FROM actor.org_unit WHERE shortname = org;

    IF ouid IS NULL THEN
        RETURN NULL::XML;
    END IF;

    SELECT INTO mmrec * FROM metabib.metarecord WHERE id = obj_id;
    IF NOT FOUND THEN
        RETURN NULL::XML;
    END IF;

    -- TODO: aggregate holdings from constituent records
    IF format = 'holdings_xml' THEN -- the special case
        output := unapi.mmr_holdings_xml(
            obj_id, ouid, org, depth,
            array_remove(includes,'holdings_xml'),
            slimit, soffset, include_xmlns, pref_lib);
        RETURN output;
    END IF;

    SELECT * INTO layout FROM unapi.bre_output_layout WHERE name = format;

    IF layout.name IS NULL THEN
        RETURN NULL::XML;
    END IF;

    SELECT * INTO xfrm FROM config.xml_transform WHERE name = layout.transform;

    SELECT INTO leadrec * FROM biblio.record_entry WHERE id = mmrec.master_record;

    -- Grab distinct MVF for all records if requested
    IF ('mra' = ANY (includes)) THEN 
        axml := unapi.mmr_mra(obj_id,NULL,NULL,NULL,org,depth,NULL,NULL,TRUE,pref_lib);
    ELSE
        axml := NULL::XML;
    END IF;

    xml_buf = leadrec.marc;

    hxml := NULL::XML;
    IF ('holdings_xml' = ANY (includes)) THEN
        hxml := unapi.mmr_holdings_xml(
                    obj_id, ouid, org, depth,
                    array_remove(includes,'holdings_xml'),
                    slimit, soffset, include_xmlns, pref_lib);
    END IF;

    subxml := NULL::XML;
    parts := '{}'::TEXT[];
    FOR subrec IN SELECT bre.* FROM biblio.record_entry bre
         JOIN metabib.metarecord_source_map mmsm ON (mmsm.source = bre.id)
         JOIN metabib.metarecord mmr ON (mmr.id = mmsm.metarecord)
         WHERE mmr.id = obj_id AND NOT bre.deleted
         ORDER BY CASE WHEN bre.id = mmr.master_record THEN 0 ELSE bre.id END
         LIMIT COALESCE((slimit->'bre')::INT, 5) LOOP

        IF subrec.id = leadrec.id THEN CONTINUE; END IF;
        -- Append choice data from the the non-lead records to the 
        -- the lead record document

        parts := parts || xpath(sub_xpath, subrec.marc::XML)::TEXT[];
    END LOOP;

    SELECT STRING_AGG( DISTINCT p , '' )::XML INTO subxml FROM UNNEST(parts) p;

    -- append data from the subordinate records to the 
    -- main record document before applying the XSLT

    IF subxml IS NOT NULL THEN 
        xml_buf := REGEXP_REPLACE(xml_buf, 
            '</record>(.*?)$', subxml || '</record>' || E'\\1');
    END IF;

    IF format = 'marcxml' THEN
         -- If we're not using the prefixed namespace in 
         -- this record, then remove all declarations of it
        IF xml_buf !~ E'<marc:' THEN
           xml_buf := REGEXP_REPLACE(xml_buf, 
            ' xmlns:marc="http://www.loc.gov/MARC21/slim"', '', 'g');
        END IF; 
    ELSE
        xml_buf := oils_xslt_process(xml_buf, xfrm.xslt)::XML;
    END IF;

    -- update top_el to reflect the change in xml_buf, which may
    -- now be a different type of document (e.g. record -> mods)
    top_el := REGEXP_REPLACE(xml_buf, E'^.*?<((?:\\S+:)?' || 
        layout.holdings_element || ').*$', E'\\1');

    IF axml IS NOT NULL THEN 
        xml_buf := REGEXP_REPLACE(xml_buf, 
            '</' || top_el || '>(.*?)$', axml || '</' || top_el || E'>\\1');
    END IF;

    IF hxml IS NOT NULL THEN
        xml_buf := REGEXP_REPLACE(xml_buf, 
            '</' || top_el || '>(.*?)$', hxml || '</' || top_el || E'>\\1');
    END IF;

    IF ('mmr.unapi' = ANY (includes)) THEN 
        output := REGEXP_REPLACE(
            xml_buf,
            '</' || top_el || '>(.*?)',
            XMLELEMENT(
                name abbr,
                XMLATTRIBUTES(
                    'http://www.w3.org/1999/xhtml' AS xmlns,
                    'unapi-id' AS class,
                    'tag:open-ils.org:U2@mmr/' || obj_id || '/' || org AS title
                )
            )::TEXT || '</' || top_el || E'>\\1'
        );
    ELSE
        output := xml_buf;
    END IF;

    -- remove ignorable whitesace
    output := REGEXP_REPLACE(output::TEXT,E'>\\s+<','><','gs')::XML;
    RETURN output;
END;
$F$ LANGUAGE PLPGSQL STABLE;

CREATE OR REPLACE FUNCTION actor.usr_merge( src_usr INT, dest_usr INT, del_addrs BOOLEAN, del_cards BOOLEAN, deactivate_cards BOOLEAN ) RETURNS VOID AS $$
DECLARE
	suffix TEXT;
	bucket_row RECORD;
	picklist_row RECORD;
	queue_row RECORD;
	folder_row RECORD;
BEGIN

    -- Bail if src_usr equals dest_usr because the result of merging a
    -- user with itself is not what you want.
    IF src_usr = dest_usr THEN
        RETURN;
    END IF;

    -- do some initial cleanup 
    UPDATE actor.usr SET card = NULL WHERE id = src_usr;
    UPDATE actor.usr SET mailing_address = NULL WHERE id = src_usr;
    UPDATE actor.usr SET billing_address = NULL WHERE id = src_usr;

    -- actor.*
    IF del_cards THEN
        DELETE FROM actor.card where usr = src_usr;
    ELSE
        IF deactivate_cards THEN
            UPDATE actor.card SET active = 'f' WHERE usr = src_usr;
        END IF;
        UPDATE actor.card SET usr = dest_usr WHERE usr = src_usr;
    END IF;


    IF del_addrs THEN
        DELETE FROM actor.usr_address WHERE usr = src_usr;
    ELSE
        UPDATE actor.usr_address SET usr = dest_usr WHERE usr = src_usr;
    END IF;

    UPDATE actor.usr_message SET usr = dest_usr WHERE usr = src_usr;
    -- dupes are technically OK in actor.usr_standing_penalty, should manually delete them...
    UPDATE actor.usr_standing_penalty SET usr = dest_usr WHERE usr = src_usr;
    PERFORM actor.usr_merge_rows('actor.usr_org_unit_opt_in', 'usr', src_usr, dest_usr);
    PERFORM actor.usr_merge_rows('actor.usr_setting', 'usr', src_usr, dest_usr);

    -- permission.*
    PERFORM actor.usr_merge_rows('permission.usr_perm_map', 'usr', src_usr, dest_usr);
    PERFORM actor.usr_merge_rows('permission.usr_object_perm_map', 'usr', src_usr, dest_usr);
    PERFORM actor.usr_merge_rows('permission.usr_grp_map', 'usr', src_usr, dest_usr);
    PERFORM actor.usr_merge_rows('permission.usr_work_ou_map', 'usr', src_usr, dest_usr);


    -- container.*
	
	-- For each *_bucket table: transfer every bucket belonging to src_usr
	-- into the custody of dest_usr.
	--
	-- In order to avoid colliding with an existing bucket owned by
	-- the destination user, append the source user's id (in parenthesese)
	-- to the name.  If you still get a collision, add successive
	-- spaces to the name and keep trying until you succeed.
	--
	FOR bucket_row in
		SELECT id, name
		FROM   container.biblio_record_entry_bucket
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  container.biblio_record_entry_bucket
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = bucket_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	FOR bucket_row in
		SELECT id, name
		FROM   container.call_number_bucket
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  container.call_number_bucket
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = bucket_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	FOR bucket_row in
		SELECT id, name
		FROM   container.copy_bucket
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  container.copy_bucket
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = bucket_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	FOR bucket_row in
		SELECT id, name
		FROM   container.user_bucket
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  container.user_bucket
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = bucket_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

	UPDATE container.user_bucket_item SET target_user = dest_usr WHERE target_user = src_usr;

    -- vandelay.*
	-- transfer queues the same way we transfer buckets (see above)
	FOR queue_row in
		SELECT id, name
		FROM   vandelay.queue
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  vandelay.queue
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = queue_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

    UPDATE vandelay.session_tracker SET usr = dest_usr WHERE usr = src_usr;

    -- money.*
    PERFORM actor.usr_merge_rows('money.collections_tracker', 'usr', src_usr, dest_usr);
    PERFORM actor.usr_merge_rows('money.collections_tracker', 'collector', src_usr, dest_usr);
    UPDATE money.billable_xact SET usr = dest_usr WHERE usr = src_usr;
    UPDATE money.billing SET voider = dest_usr WHERE voider = src_usr;
    UPDATE money.bnm_payment SET accepting_usr = dest_usr WHERE accepting_usr = src_usr;

    -- action.*
    UPDATE action.circulation SET usr = dest_usr WHERE usr = src_usr;
    UPDATE action.circulation SET circ_staff = dest_usr WHERE circ_staff = src_usr;
    UPDATE action.circulation SET checkin_staff = dest_usr WHERE checkin_staff = src_usr;
    UPDATE action.usr_circ_history SET usr = dest_usr WHERE usr = src_usr;

    UPDATE action.hold_request SET usr = dest_usr WHERE usr = src_usr;
    UPDATE action.hold_request SET fulfillment_staff = dest_usr WHERE fulfillment_staff = src_usr;
    UPDATE action.hold_request SET requestor = dest_usr WHERE requestor = src_usr;
    UPDATE action.hold_notification SET notify_staff = dest_usr WHERE notify_staff = src_usr;

    UPDATE action.in_house_use SET staff = dest_usr WHERE staff = src_usr;
    UPDATE action.non_cataloged_circulation SET staff = dest_usr WHERE staff = src_usr;
    UPDATE action.non_cataloged_circulation SET patron = dest_usr WHERE patron = src_usr;
    UPDATE action.non_cat_in_house_use SET staff = dest_usr WHERE staff = src_usr;
    UPDATE action.survey_response SET usr = dest_usr WHERE usr = src_usr;

    -- acq.*
    UPDATE acq.fund_allocation SET allocator = dest_usr WHERE allocator = src_usr;
	UPDATE acq.fund_transfer SET transfer_user = dest_usr WHERE transfer_user = src_usr;
    UPDATE acq.invoice SET closed_by = dest_usr WHERE closed_by = src_usr;

	-- transfer picklists the same way we transfer buckets (see above)
	FOR picklist_row in
		SELECT id, name
		FROM   acq.picklist
		WHERE  owner = src_usr
	LOOP
		suffix := ' (' || src_usr || ')';
		LOOP
			BEGIN
				UPDATE  acq.picklist
				SET     owner = dest_usr, name = name || suffix
				WHERE   id = picklist_row.id;
			EXCEPTION WHEN unique_violation THEN
				suffix := suffix || ' ';
				CONTINUE;
			END;
			EXIT;
		END LOOP;
	END LOOP;

    UPDATE acq.purchase_order SET owner = dest_usr WHERE owner = src_usr;
    UPDATE acq.po_note SET creator = dest_usr WHERE creator = src_usr;
    UPDATE acq.po_note SET editor = dest_usr WHERE editor = src_usr;
    UPDATE acq.provider_note SET creator = dest_usr WHERE creator = src_usr;
    UPDATE acq.provider_note SET editor = dest_usr WHERE editor = src_usr;
    UPDATE acq.lineitem_note SET creator = dest_usr WHERE creator = src_usr;
    UPDATE acq.lineitem_note SET editor = dest_usr WHERE editor = src_usr;
    UPDATE acq.lineitem_usr_attr_definition SET usr = dest_usr WHERE usr = src_usr;

    -- asset.*
    UPDATE asset.copy SET creator = dest_usr WHERE creator = src_usr;
    UPDATE asset.copy SET editor = dest_usr WHERE editor = src_usr;
    UPDATE asset.copy_note SET creator = dest_usr WHERE creator = src_usr;
    UPDATE asset.call_number SET creator = dest_usr WHERE creator = src_usr;
    UPDATE asset.call_number SET editor = dest_usr WHERE editor = src_usr;
    UPDATE asset.call_number_note SET creator = dest_usr WHERE creator = src_usr;

    -- serial.*
    UPDATE serial.record_entry SET creator = dest_usr WHERE creator = src_usr;
    UPDATE serial.record_entry SET editor = dest_usr WHERE editor = src_usr;

    -- reporter.*
    -- It's not uncommon to define the reporter schema in a replica 
    -- DB only, so don't assume these tables exist in the write DB.
    BEGIN
    	UPDATE reporter.template SET owner = dest_usr WHERE owner = src_usr;
    EXCEPTION WHEN undefined_table THEN
        -- do nothing
    END;
    BEGIN
    	UPDATE reporter.report SET owner = dest_usr WHERE owner = src_usr;
    EXCEPTION WHEN undefined_table THEN
        -- do nothing
    END;
    BEGIN
    	UPDATE reporter.schedule SET runner = dest_usr WHERE runner = src_usr;
    EXCEPTION WHEN undefined_table THEN
        -- do nothing
    END;
    BEGIN
		-- transfer folders the same way we transfer buckets (see above)
		FOR folder_row in
			SELECT id, name
			FROM   reporter.template_folder
			WHERE  owner = src_usr
		LOOP
			suffix := ' (' || src_usr || ')';
			LOOP
				BEGIN
					UPDATE  reporter.template_folder
					SET     owner = dest_usr, name = name || suffix
					WHERE   id = folder_row.id;
				EXCEPTION WHEN unique_violation THEN
					suffix := suffix || ' ';
					CONTINUE;
				END;
				EXIT;
			END LOOP;
		END LOOP;
    EXCEPTION WHEN undefined_table THEN
        -- do nothing
    END;
    BEGIN
		-- transfer folders the same way we transfer buckets (see above)
		FOR folder_row in
			SELECT id, name
			FROM   reporter.report_folder
			WHERE  owner = src_usr
		LOOP
			suffix := ' (' || src_usr || ')';
			LOOP
				BEGIN
					UPDATE  reporter.report_folder
					SET     owner = dest_usr, name = name || suffix
					WHERE   id = folder_row.id;
				EXCEPTION WHEN unique_violation THEN
					suffix := suffix || ' ';
					CONTINUE;
				END;
				EXIT;
			END LOOP;
		END LOOP;
    EXCEPTION WHEN undefined_table THEN
        -- do nothing
    END;
    BEGIN
		-- transfer folders the same way we transfer buckets (see above)
		FOR folder_row in
			SELECT id, name
			FROM   reporter.output_folder
			WHERE  owner = src_usr
		LOOP
			suffix := ' (' || src_usr || ')';
			LOOP
				BEGIN
					UPDATE  reporter.output_folder
					SET     owner = dest_usr, name = name || suffix
					WHERE   id = folder_row.id;
				EXCEPTION WHEN unique_violation THEN
					suffix := suffix || ' ';
					CONTINUE;
				END;
				EXIT;
			END LOOP;
		END LOOP;
    EXCEPTION WHEN undefined_table THEN
        -- do nothing
    END;

    -- propagate preferred name values from the source user to the
    -- destination user, but only when values are not being replaced.
    WITH susr AS (SELECT * FROM actor.usr WHERE id = src_usr)
    UPDATE actor.usr SET 
        pref_prefix = 
            COALESCE(pref_prefix, (SELECT pref_prefix FROM susr)),
        pref_first_given_name = 
            COALESCE(pref_first_given_name, (SELECT pref_first_given_name FROM susr)),
        pref_second_given_name = 
            COALESCE(pref_second_given_name, (SELECT pref_second_given_name FROM susr)),
        pref_family_name = 
            COALESCE(pref_family_name, (SELECT pref_family_name FROM susr)),
        pref_suffix = 
            COALESCE(pref_suffix, (SELECT pref_suffix FROM susr))
    WHERE id = dest_usr;

    -- Copy and deduplicate name keywords
    -- String -> array -> rows -> DISTINCT -> array -> string
    WITH susr AS (SELECT * FROM actor.usr WHERE id = src_usr),
         dusr AS (SELECT * FROM actor.usr WHERE id = dest_usr)
    UPDATE actor.usr SET name_keywords = (
        WITH keywords AS (
            SELECT DISTINCT UNNEST(
                REGEXP_SPLIT_TO_ARRAY(
                    COALESCE((SELECT name_keywords FROM susr), '') || ' ' ||
                    COALESCE((SELECT name_keywords FROM dusr), ''),  E'\\s+'
                )
            ) AS parts
        ) SELECT STRING_AGG(kw.parts, ' ') FROM keywords kw
    ) WHERE id = dest_usr;

    -- Finally, delete the source user
    PERFORM actor.usr_delete(src_usr,dest_usr);

END;
$$ LANGUAGE plpgsql;

-- SELECT evergreen.upgrade_deps_block_check('1362', :eg_version);

SELECT 'Creating hopeless_date index', CLOCK_TIMESTAMP();

CREATE INDEX hold_request_hopeless_date_idx ON action.hold_request (hopeless_date);

SELECT 'Done creating hopeless_date index', CLOCK_TIMESTAMP();

-- SELECT evergreen.upgrade_deps_block_check('1363', :eg_version);

ALTER TABLE action.hold_request_cancel_cause
  ADD COLUMN manual BOOL NOT NULL DEFAULT FALSE;


-- SELECT evergreen.upgrade_deps_block_check('1365', :eg_version);

CREATE OR REPLACE FUNCTION search.highlight_display_fields_impl(
    rid         BIGINT,
    tsq         TEXT,
    field_list  INT[] DEFAULT '{}'::INT[],
    css_class   TEXT DEFAULT 'oils_SH',
    hl_all      BOOL DEFAULT TRUE,
    minwords    INT DEFAULT 5,
    maxwords    INT DEFAULT 25,
    shortwords  INT DEFAULT 0,
    maxfrags    INT DEFAULT 0,
    delimiter   TEXT DEFAULT ' ... '
) RETURNS SETOF search.highlight_result AS $f$
DECLARE
    opts            TEXT := '';
    v_css_class     TEXT := css_class;
    v_delimiter     TEXT := delimiter;
    v_field_list    INT[] := field_list;
    hl_query        TEXT;
BEGIN
    IF v_delimiter LIKE $$%'%$$ OR v_delimiter LIKE '%"%' THEN --"
        v_delimiter := ' ... ';
    END IF;

    IF NOT hl_all THEN
        opts := opts || 'MinWords=' || minwords;
        opts := opts || ', MaxWords=' || maxwords;
        opts := opts || ', ShortWords=' || shortwords;
        opts := opts || ', MaxFragments=' || maxfrags;
        opts := opts || ', FragmentDelimiter="' || delimiter || '"';
    ELSE
        opts := opts || 'HighlightAll=TRUE';
    END IF;

    IF v_css_class LIKE $$%'%$$ OR v_css_class LIKE '%"%' THEN -- "
        v_css_class := 'oils_SH';
    END IF;

    opts := opts || $$, StopSel=</mark>, StartSel="<mark class='$$ || v_css_class; -- "

    IF v_field_list = '{}'::INT[] THEN
        SELECT ARRAY_AGG(id) INTO v_field_list FROM config.metabib_field WHERE display_field;
    END IF;

    hl_query := $$
        SELECT  de.id,
                de.source,
                de.field,
                evergreen.escape_for_html(de.value) AS value,
                ts_headline(
                    ts_config::REGCONFIG,
                    evergreen.escape_for_html(de.value),
                    $$ || quote_literal(tsq) || $$,
                    $1 || ' ' || mf.field_class || ' ' || mf.name || $xx$'>"$xx$ -- "'
                ) AS highlight
          FROM  metabib.display_entry de
                JOIN config.metabib_field mf ON (mf.id = de.field)
                JOIN search.best_tsconfig t ON (t.id = de.field)
          WHERE de.source = $2
                AND field = ANY ($3)
          ORDER BY de.id;$$;

    RETURN QUERY EXECUTE hl_query USING opts, rid, v_field_list;
END;
$f$ LANGUAGE PLPGSQL;


-- SELECT evergreen.upgrade_deps_block_check('1366', :eg_version);

ALTER TABLE config.metabib_class
    ADD COLUMN IF NOT EXISTS variant_authority_suggestion   BOOL NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS symspell_transfer_case         BOOL NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS symspell_skip_correct          BOOL NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS symspell_suggestion_verbosity  INT NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS max_phrase_edit_distance       INT NOT NULL DEFAULT 2,
    ADD COLUMN IF NOT EXISTS suggestion_word_option_count   INT NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS max_suggestions                INT NOT NULL DEFAULT -1,
    ADD COLUMN IF NOT EXISTS low_result_threshold           INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS min_suggestion_use_threshold   INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS soundex_weight                 INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pg_trgm_weight                 INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS keyboard_distance_weight       INT NOT NULL DEFAULT 0;


/* -- may not need these 2 functions
CREATE OR REPLACE FUNCTION search.symspell_parse_positive_words ( phrase TEXT )
RETURNS SETOF TEXT AS $F$
    SELECT  UNNEST
      FROM  (SELECT UNNEST(x), ROW_NUMBER() OVER ()
              FROM  regexp_matches($1, '(?<!-)\+?([[:alnum:]]+''*[[:alnum:]]*)', 'g') x
            ) y
      WHERE UNNEST IS NOT NULL
      ORDER BY row_number
$F$ LANGUAGE SQL STRICT IMMUTABLE;

CREATE OR REPLACE FUNCTION search.symspell_parse_positive_phrases ( phrase TEXT )
RETURNS SETOF TEXT AS $F$
    SELECT  BTRIM(BTRIM(UNNEST),'"')
      FROM  (SELECT UNNEST(x), ROW_NUMBER() OVER ()
              FROM  regexp_matches($1, '(?:^|\s+)(?:(-?"[^"]+")|(-?\+?[[:alnum:]]+''*?[[:alnum:]]*?))', 'g') x
            ) y
      WHERE UNNEST IS NOT NULL AND UNNEST NOT LIKE '-%'
      ORDER BY row_number
$F$ LANGUAGE SQL STRICT IMMUTABLE;
*/

CREATE OR REPLACE FUNCTION search.symspell_parse_words ( phrase TEXT )
RETURNS SETOF TEXT AS $F$
    SELECT  UNNEST
      FROM  (SELECT UNNEST(x), ROW_NUMBER() OVER ()
              FROM  regexp_matches($1, '(?:^|\s+)((?:-|\+)?[[:alnum:]]+''*[[:alnum:]]*)', 'g') x
            ) y
      WHERE UNNEST IS NOT NULL
      ORDER BY row_number
$F$ LANGUAGE SQL STRICT IMMUTABLE;

CREATE OR REPLACE FUNCTION search.distribute_phrase_sign (input TEXT) RETURNS TEXT AS $f$
DECLARE
    phrase_sign TEXT;
    output      TEXT;
BEGIN
    output := input;

    IF output ~ '^(?:-|\+)' THEN
        phrase_sign := SUBSTRING(input FROM 1 FOR 1);
        output := SUBSTRING(output FROM 2);
    END IF;

    IF output LIKE '"%"' THEN
        IF phrase_sign IS NULL THEN
            phrase_sign := '+';
        END IF;
        output := BTRIM(output,'"');
    END IF;

    IF phrase_sign IS NOT NULL THEN
        RETURN REGEXP_REPLACE(output,'(^|\s+)(?=[[:alnum:]])','\1'||phrase_sign,'g');
    END IF;

    RETURN output;
END;
$f$ LANGUAGE PLPGSQL STRICT IMMUTABLE;

CREATE OR REPLACE FUNCTION search.query_parse_phrases ( phrase TEXT )
RETURNS SETOF TEXT AS $F$
    SELECT  search.distribute_phrase_sign(UNNEST)
      FROM  (SELECT UNNEST(x), ROW_NUMBER() OVER ()
              FROM  regexp_matches($1, '(?:^|\s+)(?:((?:-|\+)?"[^"]+")|((?:-|\+)?[[:alnum:]]+''*[[:alnum:]]*))', 'g') x
            ) y
      WHERE UNNEST IS NOT NULL
      ORDER BY row_number
$F$ LANGUAGE SQL STRICT IMMUTABLE;

CREATE TYPE search.query_parse_position AS (
    word                TEXT,
    word_pos            INT,
    phrase_in_input_pos INT,
    word_in_phrase_pos  INT,
    negated             BOOL,
    exact               BOOL
);

CREATE OR REPLACE FUNCTION search.query_parse_positions ( raw_input TEXT )
RETURNS SETOF search.query_parse_position AS $F$
DECLARE
    curr_phrase TEXT;
    curr_word   TEXT;
    phrase_pos  INT := 0;
    word_pos    INT := 0;
    pos         INT := 0;
    neg         BOOL;
    ex          BOOL;
BEGIN
    FOR curr_phrase IN SELECT x FROM search.query_parse_phrases(raw_input) x LOOP
        word_pos := 0;
        FOR curr_word IN SELECT x FROM search.symspell_parse_words(curr_phrase) x LOOP
            neg := FALSE;
            ex := FALSE;
            IF curr_word ~ '^(?:-|\+)' THEN
                ex := TRUE;
                IF curr_word LIKE '-%' THEN
                    neg := TRUE;
                END IF;
                curr_word := SUBSTRING(curr_word FROM 2);
            END IF;
            RETURN QUERY SELECT curr_word, pos, phrase_pos, word_pos, neg, ex;
            word_pos := word_pos + 1;
            pos := pos + 1;
        END LOOP;
        phrase_pos := phrase_pos + 1;
    END LOOP;
    RETURN;
END;
$F$ LANGUAGE PLPGSQL STRICT IMMUTABLE;

/*
select  suggestion as sugg,
        suggestion_count as scount,
        input,
        norm_input,
        prefix_key_count as ncount,
        lev_distance,
        soundex_sim,
        pg_trgm_sim,
        qwerty_kb_match
  from  search.symspell_suggest(
            'Cedenzas (2) for Mosart''s Piano concerto',
            'title',
            '{}',
            2,2,false,5
        )
  where lev_distance is not null
  order by lev_distance,
           suggestion_count desc,
           soundex_sim desc,
           pg_trgm_sim desc,
           qwerty_kb_match desc
;

select * from search.symspell_suggest('piano concerto -jaz','subject','{}',2,2,false,4) order by lev_distance, soundex_sim desc, pg_trgm_sim desc, qwerty_kb_match desc;

*/
CREATE OR REPLACE FUNCTION search.symspell_suggest (
    raw_input       TEXT,
    search_class    TEXT,
    search_fields   TEXT[] DEFAULT '{}',
    max_ed          INT DEFAULT NULL,      -- per word, on average, between norm input and suggestion
    verbosity       INT DEFAULT NULL,      -- 0=Best only; 1=
    skip_correct    BOOL DEFAULT NULL,  -- only suggest replacement words for misspellings?
    max_word_opts   INT DEFAULT NULL,   -- 0 means all combinations, probably want to restrict?
    count_threshold INT DEFAULT NULL    -- min count of records using the terms
) RETURNS SETOF search.symspell_lookup_output AS $F$
DECLARE
    sugg_set         search.symspell_lookup_output[];
    parsed_query_set search.query_parse_position[];
    entry            RECORD;
    auth_entry       RECORD;
    norm_count       RECORD;
    current_sugg     RECORD;
    auth_sugg        RECORD;
    norm_test        TEXT;
    norm_input       TEXT;
    norm_sugg        TEXT;
    query_part       TEXT := '';
    output           search.symspell_lookup_output;
    c_skip_correct                  BOOL;
    c_variant_authority_suggestion  BOOL;
    c_symspell_transfer_case        BOOL;
    c_authority_class_restrict      BOOL;
    c_min_suggestion_use_threshold  INT;
    c_soundex_weight                INT;
    c_pg_trgm_weight                INT;
    c_keyboard_distance_weight      INT;
    c_suggestion_word_option_count  INT;
    c_symspell_suggestion_verbosity INT;
    c_max_phrase_edit_distance      INT;
BEGIN

    -- Gather settings
    SELECT  cmc.min_suggestion_use_threshold,
            cmc.soundex_weight,
            cmc.pg_trgm_weight,
            cmc.keyboard_distance_weight,
            cmc.suggestion_word_option_count,
            cmc.symspell_suggestion_verbosity,
            cmc.symspell_skip_correct,
            cmc.symspell_transfer_case,
            cmc.max_phrase_edit_distance,
            cmc.variant_authority_suggestion,
            cmc.restrict
      INTO  c_min_suggestion_use_threshold,
            c_soundex_weight,
            c_pg_trgm_weight,
            c_keyboard_distance_weight,
            c_suggestion_word_option_count,
            c_symspell_suggestion_verbosity,
            c_skip_correct,
            c_symspell_transfer_case,
            c_max_phrase_edit_distance,
            c_variant_authority_suggestion,
            c_authority_class_restrict
      FROM  config.metabib_class cmc
      WHERE cmc.name = search_class;


    -- Set up variables to use at run time based on params and settings
    c_min_suggestion_use_threshold := COALESCE(count_threshold,c_min_suggestion_use_threshold);
    c_max_phrase_edit_distance := COALESCE(max_ed,c_max_phrase_edit_distance);
    c_symspell_suggestion_verbosity := COALESCE(verbosity,c_symspell_suggestion_verbosity);
    c_suggestion_word_option_count := COALESCE(max_word_opts,c_suggestion_word_option_count);
    c_skip_correct := COALESCE(skip_correct,c_skip_correct);

    SELECT  ARRAY_AGG(
                x ORDER BY  x.word_pos,
                            x.lev_distance,
                            (x.soundex_sim * c_soundex_weight)
                                + (x.pg_trgm_sim * c_pg_trgm_weight)
                                + (x.qwerty_kb_match * c_keyboard_distance_weight) DESC,
                            x.suggestion_count DESC
            ) INTO sugg_set
      FROM  search.symspell_lookup(
                raw_input,
                search_class,
                c_symspell_suggestion_verbosity,
                c_symspell_transfer_case,
                c_min_suggestion_use_threshold,
                c_soundex_weight,
                c_pg_trgm_weight,
                c_keyboard_distance_weight
            ) x
      WHERE x.lev_distance <= c_max_phrase_edit_distance;

    SELECT ARRAY_AGG(x) INTO parsed_query_set FROM search.query_parse_positions(raw_input) x;

    IF search_fields IS NOT NULL AND CARDINALITY(search_fields) > 0 THEN
        SELECT STRING_AGG(id::TEXT,',') INTO query_part FROM config.metabib_field WHERE name = ANY (search_fields);
        IF CHARACTER_LENGTH(query_part) > 0 THEN query_part := 'AND field IN ('||query_part||')'; END IF;
    END IF;

    SELECT STRING_AGG(word,' ') INTO norm_input FROM search.query_parse_positions(evergreen.lowercase(raw_input)) WHERE NOT negated;
    EXECUTE 'SELECT  COUNT(DISTINCT source) AS recs
               FROM  metabib.' || search_class || '_field_entry
               WHERE index_vector @@ plainto_tsquery($$simple$$,$1)' || query_part
            INTO norm_count USING norm_input;

    SELECT STRING_AGG(word,' ') INTO norm_test FROM UNNEST(parsed_query_set);
    FOR current_sugg IN
        SELECT  *
          FROM  search.symspell_generate_combined_suggestions(
                    sugg_set,
                    parsed_query_set,
                    c_skip_correct,
                    c_suggestion_word_option_count
                ) x
    LOOP
        EXECUTE 'SELECT  COUNT(DISTINCT source) AS recs
                   FROM  metabib.' || search_class || '_field_entry
                   WHERE index_vector @@ to_tsquery($$simple$$,$1)' || query_part
                INTO entry USING current_sugg.test;
        SELECT STRING_AGG(word,' ') INTO norm_sugg FROM search.query_parse_positions(current_sugg.suggestion);
        IF entry.recs >= c_min_suggestion_use_threshold AND (norm_count.recs = 0 OR norm_sugg <> norm_input) THEN

            output.input := raw_input;
            output.norm_input := norm_input;
            output.suggestion := current_sugg.suggestion;
            output.suggestion_count := entry.recs;
            output.prefix_key := NULL;
            output.prefix_key_count := norm_count.recs;

            output.lev_distance := NULLIF(evergreen.levenshtein_damerau_edistance(norm_test, norm_sugg, c_max_phrase_edit_distance * CARDINALITY(parsed_query_set)), -1);
            output.qwerty_kb_match := evergreen.qwerty_keyboard_distance_match(norm_test, norm_sugg);
            output.pg_trgm_sim := similarity(norm_input, norm_sugg);
            output.soundex_sim := difference(norm_input, norm_sugg) / 4.0;

            RETURN NEXT output;
        END IF;

        IF c_variant_authority_suggestion THEN
            FOR auth_sugg IN
                SELECT  DISTINCT m.value AS prefix_key,
                        m.sort_value AS suggestion,
                        v.value as raw_input,
                        v.sort_value as norm_input
                  FROM  authority.simple_heading v
                        JOIN authority.control_set_authority_field csaf ON (csaf.id = v.atag)
                        JOIN authority.heading_field f ON (f.id = csaf.heading_field)
                        JOIN authority.simple_heading m ON (m.record = v.record AND csaf.main_entry = m.atag)
                        JOIN authority.control_set_bib_field csbf ON (csbf.authority_field = csaf.main_entry)
                        JOIN authority.control_set_bib_field_metabib_field_map csbfmfm ON (csbf.id = csbfmfm.bib_field)
                        JOIN config.metabib_field cmf ON (
                                csbfmfm.metabib_field = cmf.id
                                AND (c_authority_class_restrict IS FALSE OR cmf.field_class = search_class)
                                AND (search_fields = '{}'::TEXT[] OR cmf.name = ANY (search_fields))
                        )
                  WHERE v.sort_value = norm_sugg
            LOOP
                EXECUTE 'SELECT  COUNT(DISTINCT source) AS recs
                           FROM  metabib.' || search_class || '_field_entry
                           WHERE index_vector @@ plainto_tsquery($$simple$$,$1)' || query_part
                        INTO auth_entry USING auth_sugg.suggestion;
                IF auth_entry.recs >= c_min_suggestion_use_threshold AND (norm_count.recs = 0 OR auth_sugg.suggestion <> norm_input) THEN
                    output.input := auth_sugg.raw_input;
                    output.norm_input := auth_sugg.norm_input;
                    output.suggestion := auth_sugg.suggestion;
                    output.prefix_key := auth_sugg.prefix_key;
                    output.suggestion_count := auth_entry.recs * -1; -- negative value here 

                    output.lev_distance := 0;
                    output.qwerty_kb_match := 0;
                    output.pg_trgm_sim := 0;
                    output.soundex_sim := 0;

                    RETURN NEXT output;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    RETURN;
END;
$F$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION search.symspell_generate_combined_suggestions(
    word_data search.symspell_lookup_output[],
    pos_data search.query_parse_position[],
    skip_correct BOOL DEFAULT TRUE,
    max_words INT DEFAULT 0
) RETURNS TABLE (suggestion TEXT, test TEXT) AS $f$
    my $word_data = shift;
    my $pos_data = shift;
    my $skip_correct = shift;
    my $max_per_word = shift;
    return undef unless (@$word_data and @$pos_data);

    my $last_word_pos = $$word_data[-1]{word_pos};
    my $pos_to_word_map = [ map { [] } 0 .. $last_word_pos ];
    my $parsed_query_data = { map { ($$_{word_pos} => $_) } @$pos_data };

    for my $row (@$word_data) {
        my $wp = +$$row{word_pos};
        next if (
            $skip_correct eq 't' and $$row{lev_distance} > 0
            and @{$$pos_to_word_map[$wp]}
            and $$pos_to_word_map[$wp][0]{lev_distance} == 0
        );
        push @{$$pos_to_word_map[$$row{word_pos}]}, $row;
    }

    gen_step($max_per_word, $pos_to_word_map, $parsed_query_data, $last_word_pos);
    return undef;

    # -----------------------------
    sub gen_step {
        my $max_words = shift;
        my $data = shift;
        my $pos_data = shift;
        my $last_pos = shift;
        my $prefix = shift || '';
        my $test_prefix = shift || '';
        my $current_pos = shift || 0;

        my $word_count = 0;
        for my $sugg ( @{$$data[$current_pos]} ) {
            my $was_inside_phrase = 0;
            my $now_inside_phrase = 0;

            my $word = $$sugg{suggestion};
            $word_count++;

            my $prev_phrase = $$pos_data{$current_pos - 1}{phrase_in_input_pos};
            my $curr_phrase = $$pos_data{$current_pos}{phrase_in_input_pos};
            my $next_phrase = $$pos_data{$current_pos + 1}{phrase_in_input_pos};

            $now_inside_phrase++ if (defined($next_phrase) and $curr_phrase == $next_phrase);
            $was_inside_phrase++ if (defined($prev_phrase) and $curr_phrase == $prev_phrase);

            my $string = $prefix;
            $string .= ' ' if $string;

            if (!$was_inside_phrase) { # might be starting a phrase?
                $string .= '-' if ($$pos_data{$current_pos}{negated} eq 't');
                if ($now_inside_phrase) { # we are! add the double-quote
                    $string .= '"';
                }
                $string .= $word;
            } else { # definitely were in a phrase
                $string .= $word;
                if (!$now_inside_phrase) { # we are not any longer, add the double-quote
                    $string .= '"';
                }
            }

            my $test_string = $test_prefix;
            if ($current_pos > 0) { # have something already, need joiner
                $test_string .= $curr_phrase == $prev_phrase ? ' <-> ' : ' & ';
            }
            $test_string .= '!' if ($$pos_data{$current_pos}{negated} eq 't');
            $test_string .= $word;

            if ($current_pos == $last_pos) {
                return_next {suggestion => $string, test => $test_string};
            } else {
                gen_step($max_words, $data, $pos_data, $last_pos, $string, $test_string, $current_pos + 1);
            }
            
            last if ($max_words and $word_count >= $max_words);
        }
    }
$f$ LANGUAGE PLPERLU IMMUTABLE;

-- Changing parameters, so we have to drop the old one first
DROP FUNCTION search.symspell_lookup;
CREATE FUNCTION search.symspell_lookup (
    raw_input       TEXT,
    search_class    TEXT,
    verbosity       INT DEFAULT NULL,
    xfer_case       BOOL DEFAULT NULL,
    count_threshold INT DEFAULT NULL,
    soundex_weight  INT DEFAULT NULL,
    pg_trgm_weight  INT DEFAULT NULL,
    kbdist_weight   INT DEFAULT NULL
) RETURNS SETOF search.symspell_lookup_output AS $F$
DECLARE
    prefix_length INT;
    maxED         INT;
    word_list   TEXT[];
    edit_list   TEXT[] := '{}';
    seen_list   TEXT[] := '{}';
    output      search.symspell_lookup_output;
    output_list search.symspell_lookup_output[];
    entry       RECORD;
    entry_key   TEXT;
    prefix_key  TEXT;
    sugg        TEXT;
    input       TEXT;
    word        TEXT;
    w_pos       INT := -1;
    smallest_ed INT := -1;
    global_ed   INT;
    c_symspell_suggestion_verbosity INT;
    c_min_suggestion_use_threshold  INT;
    c_soundex_weight                INT;
    c_pg_trgm_weight                INT;
    c_keyboard_distance_weight      INT;
    c_symspell_transfer_case        BOOL;
BEGIN

    SELECT  cmc.min_suggestion_use_threshold,
            cmc.soundex_weight,
            cmc.pg_trgm_weight,
            cmc.keyboard_distance_weight,
            cmc.symspell_transfer_case,
            cmc.symspell_suggestion_verbosity
      INTO  c_min_suggestion_use_threshold,
            c_soundex_weight,
            c_pg_trgm_weight,
            c_keyboard_distance_weight,
            c_symspell_transfer_case,
            c_symspell_suggestion_verbosity
      FROM  config.metabib_class cmc
      WHERE cmc.name = search_class;

    c_min_suggestion_use_threshold := COALESCE(count_threshold,c_min_suggestion_use_threshold);
    c_symspell_transfer_case := COALESCE(xfer_case,c_symspell_transfer_case);
    c_symspell_suggestion_verbosity := COALESCE(verbosity,c_symspell_suggestion_verbosity);
    c_soundex_weight := COALESCE(soundex_weight,c_soundex_weight);
    c_pg_trgm_weight := COALESCE(pg_trgm_weight,c_pg_trgm_weight);
    c_keyboard_distance_weight := COALESCE(kbdist_weight,c_keyboard_distance_weight);

    SELECT value::INT INTO prefix_length FROM config.internal_flag WHERE name = 'symspell.prefix_length' AND enabled;
    prefix_length := COALESCE(prefix_length, 6);

    SELECT value::INT INTO maxED FROM config.internal_flag WHERE name = 'symspell.max_edit_distance' AND enabled;
    maxED := COALESCE(maxED, 3);

    -- XXX This should get some more thought ... maybe search_normalize?
    word_list := ARRAY_AGG(x.word) FROM search.query_parse_positions(raw_input) x;

    -- Common case exact match test for preformance
    IF c_symspell_suggestion_verbosity = 0 AND CARDINALITY(word_list) = 1 AND CHARACTER_LENGTH(word_list[1]) <= prefix_length THEN
        EXECUTE
          'SELECT  '||search_class||'_suggestions AS suggestions,
                   '||search_class||'_count AS count,
                   prefix_key
             FROM  search.symspell_dictionary
             WHERE prefix_key = $1
                   AND '||search_class||'_count >= $2 
                   AND '||search_class||'_suggestions @> ARRAY[$1]' 
          INTO entry USING evergreen.lowercase(word_list[1]), c_min_suggestion_use_threshold;
        IF entry.prefix_key IS NOT NULL THEN
            output.lev_distance := 0; -- definitionally
            output.prefix_key := entry.prefix_key;
            output.prefix_key_count := entry.count;
            output.suggestion_count := entry.count;
            output.input := word_list[1];
            IF c_symspell_transfer_case THEN
                output.suggestion := search.symspell_transfer_casing(output.input, entry.prefix_key);
            ELSE
                output.suggestion := entry.prefix_key;
            END IF;
            output.norm_input := entry.prefix_key;
            output.qwerty_kb_match := 1;
            output.pg_trgm_sim := 1;
            output.soundex_sim := 1;
            RETURN NEXT output;
            RETURN;
        END IF;
    END IF;

    <<word_loop>>
    FOREACH word IN ARRAY word_list LOOP
        w_pos := w_pos + 1;
        input := evergreen.lowercase(word);

        IF CHARACTER_LENGTH(input) > prefix_length THEN
            prefix_key := SUBSTRING(input FROM 1 FOR prefix_length);
            edit_list := ARRAY[input,prefix_key] || search.symspell_generate_edits(prefix_key, 1, maxED);
        ELSE
            edit_list := input || search.symspell_generate_edits(input, 1, maxED);
        END IF;

        SELECT ARRAY_AGG(x ORDER BY CHARACTER_LENGTH(x) DESC) INTO edit_list FROM UNNEST(edit_list) x;

        output_list := '{}';
        seen_list := '{}';
        global_ed := NULL;

        <<entry_key_loop>>
        FOREACH entry_key IN ARRAY edit_list LOOP
            smallest_ed := -1;
            IF global_ed IS NOT NULL THEN
                smallest_ed := global_ed;
            END IF;
            FOR entry IN EXECUTE
                'SELECT  '||search_class||'_suggestions AS suggestions,
                         '||search_class||'_count AS count,
                         prefix_key
                   FROM  search.symspell_dictionary
                   WHERE prefix_key = $1
                         AND '||search_class||'_suggestions IS NOT NULL' 
                USING entry_key
            LOOP
                FOREACH sugg IN ARRAY entry.suggestions LOOP
                    IF NOT seen_list @> ARRAY[sugg] THEN
                        seen_list := seen_list || sugg;
                        IF input = sugg THEN -- exact match, no need to spend time on a call
                            output.lev_distance := 0;
                            output.suggestion_count = entry.count;
                        ELSIF ABS(CHARACTER_LENGTH(input) - CHARACTER_LENGTH(sugg)) > maxED THEN
                            -- They are definitionally too different to consider, just move on.
                            CONTINUE;
                        ELSE
                            --output.lev_distance := levenshtein_less_equal(
                            output.lev_distance := evergreen.levenshtein_damerau_edistance(
                                input,
                                sugg,
                                maxED
                            );
                            IF output.lev_distance < 0 THEN
                                -- The Perl module returns -1 for "more distant than max".
                                output.lev_distance := maxED + 1;
                                -- This short-circuit's the count test below for speed, bypassing
                                -- a couple useless tests.
                                output.suggestion_count := -1;
                            ELSE
                                EXECUTE 'SELECT '||search_class||'_count FROM search.symspell_dictionary WHERE prefix_key = $1'
                                    INTO output.suggestion_count USING sugg;
                            END IF;
                        END IF;

                        -- The caller passes a minimum suggestion count threshold (or uses
                        -- the default of 0) and if the suggestion has that many or less uses
                        -- then we move on to the next suggestion, since this one is too rare.
                        CONTINUE WHEN output.suggestion_count < c_min_suggestion_use_threshold;

                        -- Track the smallest edit distance among suggestions from this prefix key.
                        IF smallest_ed = -1 OR output.lev_distance < smallest_ed THEN
                            smallest_ed := output.lev_distance;
                        END IF;

                        -- Track the smallest edit distance for all prefix keys for this word.
                        IF global_ed IS NULL OR smallest_ed < global_ed THEN
                            global_ed = smallest_ed;
                        END IF;

                        -- Only proceed if the edit distance is <= the max for the dictionary.
                        IF output.lev_distance <= maxED THEN
                            IF output.lev_distance > global_ed AND c_symspell_suggestion_verbosity <= 1 THEN
                                -- Lev distance is our main similarity measure. While
                                -- trgm or soundex similarity could be the main filter,
                                -- Lev is both language agnostic and faster.
                                --
                                -- Here we will skip suggestions that have a longer edit distance
                                -- than the shortest we've already found. This is simply an
                                -- optimization that allows us to avoid further processing
                                -- of this entry. It would be filtered out later.

                                CONTINUE;
                            END IF;

                            -- If we have an exact match on the suggestion key we can also avoid
                            -- some function calls.
                            IF output.lev_distance = 0 THEN
                                output.qwerty_kb_match := 1;
                                output.pg_trgm_sim := 1;
                                output.soundex_sim := 1;
                            ELSE
                                output.qwerty_kb_match := evergreen.qwerty_keyboard_distance_match(input, sugg);
                                output.pg_trgm_sim := similarity(input, sugg);
                                output.soundex_sim := difference(input, sugg) / 4.0;
                            END IF;

                            -- Fill in some fields
                            IF c_symspell_transfer_case THEN
                                output.suggestion := search.symspell_transfer_casing(word, sugg);
                            ELSE
                                output.suggestion := sugg;
                            END IF;
                            output.prefix_key := entry.prefix_key;
                            output.prefix_key_count := entry.count;
                            output.input := word;
                            output.norm_input := input;
                            output.word_pos := w_pos;

                            -- We can't "cache" a set of generated records directly, so
                            -- here we build up an array of search.symspell_lookup_output
                            -- records that we can revivicate later as a table using UNNEST().
                            output_list := output_list || output;

                            EXIT entry_key_loop WHEN smallest_ed = 0 AND c_symspell_suggestion_verbosity = 0; -- exact match early exit
                            CONTINUE entry_key_loop WHEN smallest_ed = 0 AND c_symspell_suggestion_verbosity = 1; -- exact match early jump to the next key
                        END IF; -- maxED test
                    END IF; -- suggestion not seen test
                END LOOP; -- loop over suggestions
            END LOOP; -- loop over entries
        END LOOP; -- loop over entry_keys

        -- Now we're done examining this word
        IF c_symspell_suggestion_verbosity = 0 THEN
            -- Return the "best" suggestion from the smallest edit
            -- distance group.  We define best based on the weighting
            -- of the non-lev similarity measures and use the suggestion
            -- use count to break ties.
            RETURN QUERY
                SELECT * FROM UNNEST(output_list)
                    ORDER BY lev_distance,
                        (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC
                        LIMIT 1;
        ELSIF c_symspell_suggestion_verbosity = 1 THEN
            -- Return all suggestions from the smallest
            -- edit distance group.
            RETURN QUERY
                SELECT * FROM UNNEST(output_list) WHERE lev_distance = smallest_ed
                    ORDER BY (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC;
        ELSIF c_symspell_suggestion_verbosity = 2 THEN
            -- Return everything we find, along with relevant stats
            RETURN QUERY
                SELECT * FROM UNNEST(output_list)
                    ORDER BY lev_distance,
                        (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC;
        ELSIF c_symspell_suggestion_verbosity = 3 THEN
            -- Return everything we find from the two smallest edit distance groups
            RETURN QUERY
                SELECT * FROM UNNEST(output_list)
                    WHERE lev_distance IN (SELECT DISTINCT lev_distance FROM UNNEST(output_list) ORDER BY 1 LIMIT 2)
                    ORDER BY lev_distance,
                        (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC;
        ELSIF c_symspell_suggestion_verbosity = 4 THEN
            -- Return everything we find from the two smallest edit distance groups that are NOT 0 distance
            RETURN QUERY
                SELECT * FROM UNNEST(output_list)
                    WHERE lev_distance IN (SELECT DISTINCT lev_distance FROM UNNEST(output_list) WHERE lev_distance > 0 ORDER BY 1 LIMIT 2)
                    ORDER BY lev_distance,
                        (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC;
        END IF;
    END LOOP; -- loop over words
END;
$F$ LANGUAGE PLPGSQL;

-- Find the "broadest" value in use, and update the defaults for all classes
DO $do$
DECLARE
    val TEXT;
BEGIN
    SELECT  FIRST(s.value ORDER BY t.depth) INTO val
      FROM  actor.org_unit_setting s
            JOIN actor.org_unit u ON (u.id = s.org_unit)
            JOIN actor.org_unit_type t ON (u.ou_type = t.id)
      WHERE s.name = 'opac.did_you_mean.low_result_threshold';

    IF FOUND AND val IS NOT NULL THEN
        UPDATE config.metabib_class SET low_result_threshold = val::INT;
    END IF;

    SELECT  FIRST(s.value ORDER BY t.depth) INTO val
      FROM  actor.org_unit_setting s
            JOIN actor.org_unit u ON (u.id = s.org_unit)
            JOIN actor.org_unit_type t ON (u.ou_type = t.id)
      WHERE s.name = 'opac.did_you_mean.max_suggestions';

    IF FOUND AND val IS NOT NULL THEN
        UPDATE config.metabib_class SET max_suggestions = val::INT;
    END IF;

    SELECT  FIRST(s.value ORDER BY t.depth) INTO val
      FROM  actor.org_unit_setting s
            JOIN actor.org_unit u ON (u.id = s.org_unit)
            JOIN actor.org_unit_type t ON (u.ou_type = t.id)
      WHERE s.name = 'search.symspell.min_suggestion_use_threshold';

    IF FOUND AND val IS NOT NULL THEN
        UPDATE config.metabib_class SET min_suggestion_use_threshold = val::INT;
    END IF;

    SELECT  FIRST(s.value ORDER BY t.depth) INTO val
      FROM  actor.org_unit_setting s
            JOIN actor.org_unit u ON (u.id = s.org_unit)
            JOIN actor.org_unit_type t ON (u.ou_type = t.id)
      WHERE s.name = 'search.symspell.soundex.weight';

    IF FOUND AND val IS NOT NULL THEN
        UPDATE config.metabib_class SET soundex_weight = val::INT;
    END IF;

    SELECT  FIRST(s.value ORDER BY t.depth) INTO val
      FROM  actor.org_unit_setting s
            JOIN actor.org_unit u ON (u.id = s.org_unit)
            JOIN actor.org_unit_type t ON (u.ou_type = t.id)
      WHERE s.name = 'search.symspell.pg_trgm.weight';

    IF FOUND AND val IS NOT NULL THEN
        UPDATE config.metabib_class SET pg_trgm_weight = val::INT;
    END IF;

    SELECT  FIRST(s.value ORDER BY t.depth) INTO val
      FROM  actor.org_unit_setting s
            JOIN actor.org_unit u ON (u.id = s.org_unit)
            JOIN actor.org_unit_type t ON (u.ou_type = t.id)
      WHERE s.name = 'search.symspell.keyboard_distance.weight';

    IF FOUND AND val IS NOT NULL THEN
        UPDATE config.metabib_class SET keyboard_distance_weight = val::INT;
    END IF;
END;
$do$;

-- SELECT evergreen.upgrade_deps_block_check('1367', :eg_version);

-- Bring authorized headings into the symspell dictionary. Side
-- loader should be used for Real Sites.  See below the COMMIT.
/*
SELECT  search.symspell_build_and_merge_entries(h.value, m.field_class, NULL)
  FROM  authority.simple_heading h
        JOIN authority.control_set_auth_field_metabib_field_map_refs a ON (a.authority_field = h.atag)
        JOIN config.metabib_field m ON (a.metabib_field=m.id);
*/

-- ensure that this function is in place; it hitherto had not been
-- present in baseline

CREATE OR REPLACE FUNCTION search.symspell_build_and_merge_entries (
    full_input      TEXT,
    source_class    TEXT,
    old_input       TEXT DEFAULT NULL,
    include_phrases BOOL DEFAULT FALSE
) RETURNS SETOF search.symspell_dictionary AS $F$
DECLARE
    new_entry       RECORD;
    conflict_entry  RECORD;
BEGIN

    IF full_input = old_input THEN -- neither NULL, and are the same
        RETURN;
    END IF;

    FOR new_entry IN EXECUTE $q$
        SELECT  count,
                prefix_key,
                s AS suggestions
          FROM  (SELECT prefix_key,
                        ARRAY_AGG(DISTINCT $q$ || source_class || $q$_suggestions[1]) s,
                        SUM($q$ || source_class || $q$_count) count
                  FROM  search.symspell_build_entries($1, $2, $3, $4)
                  GROUP BY 1) x
        $q$ USING full_input, source_class, old_input, include_phrases
    LOOP
        EXECUTE $q$
            SELECT  prefix_key,
                    $q$ || source_class || $q$_suggestions suggestions,
                    $q$ || source_class || $q$_count count
              FROM  search.symspell_dictionary
              WHERE prefix_key = $1 $q$
            INTO conflict_entry
            USING new_entry.prefix_key;

        IF new_entry.count <> 0 THEN -- Real word, and count changed
            IF conflict_entry.prefix_key IS NOT NULL THEN -- we'll be updating
                IF conflict_entry.count > 0 THEN -- it's a real word
                    RETURN QUERY EXECUTE $q$
                        UPDATE  search.symspell_dictionary
                           SET  $q$ || source_class || $q$_count = $2
                          WHERE prefix_key = $1
                          RETURNING * $q$
                        USING new_entry.prefix_key, GREATEST(0, new_entry.count + conflict_entry.count);
                ELSE -- it was a prefix key or delete-emptied word before
                    IF conflict_entry.suggestions @> new_entry.suggestions THEN -- already have all suggestions here...
                        RETURN QUERY EXECUTE $q$
                            UPDATE  search.symspell_dictionary
                               SET  $q$ || source_class || $q$_count = $2
                              WHERE prefix_key = $1
                              RETURNING * $q$
                            USING new_entry.prefix_key, GREATEST(0, new_entry.count);
                    ELSE -- new suggestion!
                        RETURN QUERY EXECUTE $q$
                            UPDATE  search.symspell_dictionary
                               SET  $q$ || source_class || $q$_count = $2,
                                    $q$ || source_class || $q$_suggestions = $3
                              WHERE prefix_key = $1
                              RETURNING * $q$
                            USING new_entry.prefix_key, GREATEST(0, new_entry.count), evergreen.text_array_merge_unique(conflict_entry.suggestions,new_entry.suggestions);
                    END IF;
                END IF;
            ELSE
                -- We keep the on-conflict clause just in case...
                RETURN QUERY EXECUTE $q$
                    INSERT INTO search.symspell_dictionary AS d (
                        $q$ || source_class || $q$_count,
                        prefix_key,
                        $q$ || source_class || $q$_suggestions
                    ) VALUES ( $1, $2, $3 ) ON CONFLICT (prefix_key) DO
                        UPDATE SET  $q$ || source_class || $q$_count = d.$q$ || source_class || $q$_count + EXCLUDED.$q$ || source_class || $q$_count,
                                    $q$ || source_class || $q$_suggestions = evergreen.text_array_merge_unique(d.$q$ || source_class || $q$_suggestions, EXCLUDED.$q$ || source_class || $q$_suggestions)
                        RETURNING * $q$
                    USING new_entry.count, new_entry.prefix_key, new_entry.suggestions;
            END IF;
        ELSE -- key only, or no change
            IF conflict_entry.prefix_key IS NOT NULL THEN -- we'll be updating
                IF NOT conflict_entry.suggestions @> new_entry.suggestions THEN -- There are new suggestions
                    RETURN QUERY EXECUTE $q$
                        UPDATE  search.symspell_dictionary
                           SET  $q$ || source_class || $q$_suggestions = $2
                          WHERE prefix_key = $1
                          RETURNING * $q$
                        USING new_entry.prefix_key, evergreen.text_array_merge_unique(conflict_entry.suggestions,new_entry.suggestions);
                END IF;
            ELSE
                RETURN QUERY EXECUTE $q$
                    INSERT INTO search.symspell_dictionary AS d (
                        $q$ || source_class || $q$_count,
                        prefix_key,
                        $q$ || source_class || $q$_suggestions
                    ) VALUES ( $1, $2, $3 ) ON CONFLICT (prefix_key) DO -- key exists, suggestions may be added due to this entry
                        UPDATE SET  $q$ || source_class || $q$_suggestions = evergreen.text_array_merge_unique(d.$q$ || source_class || $q$_suggestions, EXCLUDED.$q$ || source_class || $q$_suggestions)
                    RETURNING * $q$
                    USING new_entry.count, new_entry.prefix_key, new_entry.suggestions;
            END IF;
        END IF;
    END LOOP;
END;
$F$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION search.symspell_maintain_entries () RETURNS TRIGGER AS $f$
DECLARE
    search_class    TEXT;
    new_value       TEXT := NULL;
    old_value       TEXT := NULL;
BEGIN

    IF TG_TABLE_SCHEMA = 'authority' THEN
        SELECT  m.field_class INTO search_class
          FROM  authority.control_set_auth_field_metabib_field_map_refs a
                JOIN config.metabib_field m ON (a.metabib_field=m.id)
          WHERE a.authority_field = NEW.atag;

        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
    ELSE
        search_class := COALESCE(TG_ARGV[0], SPLIT_PART(TG_TABLE_NAME,'_',1));
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        new_value := NEW.value;
    END IF;

    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        old_value := OLD.value;
    END IF;

    PERFORM * FROM search.symspell_build_and_merge_entries(new_value, search_class, old_value);

    RETURN NULL; -- always fired AFTER
END;
$f$ LANGUAGE PLPGSQL;

CREATE TRIGGER maintain_symspell_entries_tgr
    AFTER INSERT OR UPDATE OR DELETE ON authority.simple_heading
    FOR EACH ROW EXECUTE PROCEDURE search.symspell_maintain_entries();


-- SELECT evergreen.upgrade_deps_block_check('1368', :eg_version);

CREATE OR REPLACE FUNCTION search.symspell_maintain_entries () RETURNS TRIGGER AS $f$
DECLARE
    search_class    TEXT;
    new_value       TEXT := NULL;
    old_value       TEXT := NULL;
BEGIN

    IF TG_TABLE_SCHEMA = 'authority' THEN
        SELECT  m.field_class INTO search_class
          FROM  authority.control_set_auth_field_metabib_field_map_refs a
                JOIN config.metabib_field m ON (a.metabib_field=m.id)
          WHERE a.authority_field = NEW.atag;

        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
    ELSE
        search_class := COALESCE(TG_ARGV[0], SPLIT_PART(TG_TABLE_NAME,'_',1));
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        new_value := NEW.value;
    END IF;

    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        old_value := OLD.value;
    END IF;

    IF new_value = old_value THEN
        -- same, move along
    ELSE
        INSERT INTO search.symspell_dictionary_updates
            SELECT  txid_current(), *
              FROM  search.symspell_build_entries(
                        new_value,
                        search_class,
                        old_value
                    );
    END IF;

    -- PERFORM * FROM search.symspell_build_and_merge_entries(new_value, search_class, old_value);

    RETURN NULL; -- always fired AFTER
END;
$f$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION authority.indexing_ingest_or_delete () RETURNS TRIGGER AS $func$
DECLARE
    ashs    authority.simple_heading%ROWTYPE;
    mbe_row metabib.browse_entry%ROWTYPE;
    mbe_id  BIGINT;
    ash_id  BIGINT;
BEGIN

    IF NEW.deleted IS TRUE THEN -- If this authority is deleted
        DELETE FROM authority.bib_linking WHERE authority = NEW.id; -- Avoid updating fields in bibs that are no longer visible
        DELETE FROM authority.full_rec WHERE record = NEW.id; -- Avoid validating fields against deleted authority records
        DELETE FROM authority.simple_heading WHERE record = NEW.id;
          -- Should remove matching $0 from controlled fields at the same time?

        -- XXX What do we about the actual linking subfields present in
        -- authority records that target this one when this happens?
        DELETE FROM authority.authority_linking
            WHERE source = NEW.id OR target = NEW.id;

        RETURN NEW; -- and we're done
    END IF;

    IF TG_OP = 'UPDATE' THEN -- re-ingest?
        PERFORM * FROM config.internal_flag WHERE name = 'ingest.reingest.force_on_same_marc' AND enabled;

        IF NOT FOUND AND OLD.marc = NEW.marc THEN -- don't do anything if the MARC didn't change
            RETURN NEW;
        END IF;

        -- Unless there's a setting stopping us, propagate these updates to any linked bib records when the heading changes
        PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_authority_auto_update' AND enabled;

        IF NOT FOUND AND NEW.heading <> OLD.heading THEN
            PERFORM authority.propagate_changes(NEW.id);
        END IF;
	
        DELETE FROM authority.simple_heading WHERE record = NEW.id;
        DELETE FROM authority.authority_linking WHERE source = NEW.id;
    END IF;

    INSERT INTO authority.authority_linking (source, target, field)
        SELECT source, target, field FROM authority.calculate_authority_linking(
            NEW.id, NEW.control_set, NEW.marc::XML
        );

    FOR ashs IN SELECT * FROM authority.simple_heading_set(NEW.marc) LOOP

        INSERT INTO authority.simple_heading (record,atag,value,sort_value,thesaurus)
            VALUES (ashs.record, ashs.atag, ashs.value, ashs.sort_value, ashs.thesaurus);
            ash_id := CURRVAL('authority.simple_heading_id_seq'::REGCLASS);

        SELECT INTO mbe_row * FROM metabib.browse_entry
            WHERE value = ashs.value AND sort_value = ashs.sort_value;

        IF FOUND THEN
            mbe_id := mbe_row.id;
        ELSE
            INSERT INTO metabib.browse_entry
                ( value, sort_value ) VALUES
                ( ashs.value, ashs.sort_value );

            mbe_id := CURRVAL('metabib.browse_entry_id_seq'::REGCLASS);
        END IF;

        INSERT INTO metabib.browse_entry_simple_heading_map (entry,simple_heading) VALUES (mbe_id,ash_id);

    END LOOP;

    -- Flatten and insert the afr data
    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_authority_full_rec' AND enabled;
    IF NOT FOUND THEN
        PERFORM authority.reingest_authority_full_rec(NEW.id);
        PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_authority_rec_descriptor' AND enabled;
        IF NOT FOUND THEN
            PERFORM authority.reingest_authority_rec_descriptor(NEW.id);
        END IF;
    END IF;

    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_symspell_reification' AND enabled;
    IF NOT FOUND THEN
        PERFORM search.symspell_dictionary_reify();
    END IF;

    RETURN NEW;
END;
$func$ LANGUAGE PLPGSQL;

-- SELECT evergreen.upgrade_deps_block_check('1369', :eg_version);

CREATE OR REPLACE FUNCTION search.symspell_maintain_entries () RETURNS TRIGGER AS $f$
DECLARE
    search_class    TEXT;
    new_value       TEXT := NULL;
    old_value       TEXT := NULL;
    _atag           INTEGER;
BEGIN

    IF TG_TABLE_SCHEMA = 'authority' THEN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            _atag = NEW.atag;
        ELSE
            _atag = OLD.atag;
        END IF;

        SELECT  m.field_class INTO search_class
          FROM  authority.control_set_auth_field_metabib_field_map_refs a
                JOIN config.metabib_field m ON (a.metabib_field=m.id)
          WHERE a.authority_field = _atag;

        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
    ELSE
        search_class := COALESCE(TG_ARGV[0], SPLIT_PART(TG_TABLE_NAME,'_',1));
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        new_value := NEW.value;
    END IF;

    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        old_value := OLD.value;
    END IF;

    IF new_value = old_value THEN
        -- same, move along
    ELSE
        INSERT INTO search.symspell_dictionary_updates
            SELECT  txid_current(), *
              FROM  search.symspell_build_entries(
                        new_value,
                        search_class,
                        old_value
                    );
    END IF;

    -- PERFORM * FROM search.symspell_build_and_merge_entries(new_value, search_class, old_value);

    RETURN NULL; -- always fired AFTER
END;
$f$ LANGUAGE PLPGSQL;

CREATE TABLE action.ingest_queue (
    id          SERIAL      PRIMARY KEY,
    created     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    who         INT         REFERENCES actor.usr (id) ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    start_time  TIMESTAMPTZ,
    end_time    TIMESTAMPTZ,
    threads     INT,
    why         TEXT
);

CREATE TABLE action.ingest_queue_entry (
    id          BIGSERIAL   PRIMARY KEY,
    record      BIGINT      NOT NULL, -- points to a record id of the appropriate record_type
    record_type TEXT        NOT NULL,
    action      TEXT        NOT NULL,
    run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    state_data  TEXT        NOT NULL DEFAULT '',
    queue       INT         REFERENCES action.ingest_queue (id) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    override_by BIGINT      REFERENCES action.ingest_queue_entry (id) ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    ingest_time TIMESTAMPTZ,
    fail_time   TIMESTAMPTZ
);
CREATE UNIQUE INDEX record_pending_once ON action.ingest_queue_entry (record_type,record,state_data) WHERE ingest_time IS NULL AND override_by IS NULL;
CREATE INDEX entry_override_by_idx ON action.ingest_queue_entry (override_by) WHERE override_by IS NOT NULL;

CREATE OR REPLACE FUNCTION action.enqueue_ingest_entry (
    record_id       BIGINT,
    rtype           TEXT DEFAULT 'biblio',
    when_to_run     TIMESTAMPTZ DEFAULT NOW(),
    queue_id        INT  DEFAULT NULL,
    ingest_action   TEXT DEFAULT 'update', -- will be the most common?
    old_state_data  TEXT DEFAULT ''
) RETURNS BOOL AS $F$
DECLARE
    new_entry       action.ingest_queue_entry%ROWTYPE;
    prev_del_entry  action.ingest_queue_entry%ROWTYPE;
    diag_detail     TEXT;
    diag_context    TEXT;
BEGIN

    IF ingest_action = 'delete' THEN
        -- first see if there is an outstanding entry
        SELECT  * INTO prev_del_entry
          FROM  action.ingest_queue_entry
          WHERE qe.record = record_id
                AND qe.state_date = old_state_data
                AND qe.record_type = rtype
                AND qe.ingest_time IS NULL
                AND qe.override_by IS NULL;
    END IF;

    WITH existing_queue_entry_cte AS (
        SELECT  queue_id AS queue,
                rtype AS record_type,
                record_id AS record,
                qe.id AS override_by,
                ingest_action AS action,
                q.run_at AS run_at,
                old_state_data AS state_data
          FROM  action.ingest_queue_entry qe
                JOIN action.ingest_queue q ON (qe.queue = q.id)
          WHERE qe.record = record_id
                AND q.end_time IS NULL
                AND qe.record_type = rtype
                AND qe.state_data = old_state_data
                AND qe.ingest_time IS NULL
                AND qe.fail_time IS NULL
                AND qe.override_by IS NULL
    ), existing_nonqueue_entry_cte AS (
        SELECT  queue_id AS queue,
                rtype AS record_type,
                record_id AS record,
                qe.id AS override_by,
                ingest_action AS action,
                qe.run_at AS run_at,
                old_state_data AS state_data
          FROM  action.ingest_queue_entry qe
          WHERE qe.record = record_id
                AND qe.queue IS NULL
                AND qe.record_type = rtype
                AND qe.state_data = old_state_data
                AND qe.ingest_time IS NULL
                AND qe.fail_time IS NULL
                AND qe.override_by IS NULL
    ), new_entry_cte AS (
        SELECT * FROM existing_queue_entry_cte
          UNION ALL
        SELECT * FROM existing_nonqueue_entry_cte
          UNION ALL
        SELECT queue_id, rtype, record_id, NULL, ingest_action, COALESCE(when_to_run,NOW()), old_state_data
    ), insert_entry_cte AS (
        INSERT INTO action.ingest_queue_entry
            (queue, record_type, record, override_by, action, run_at, state_data)
          SELECT queue, record_type, record, override_by, action, run_at, state_data FROM new_entry_cte
            ORDER BY 4 NULLS LAST, 6
            LIMIT 1
        RETURNING *
    ) SELECT * INTO new_entry FROM insert_entry_cte;

    IF prev_del_entry.id IS NOT NULL THEN -- later delete overrides earlier unapplied entry
        UPDATE  action.ingest_queue_entry
          SET   override_by = new_entry.id
          WHERE id = prev_del_entry.id;

        UPDATE  action.ingest_queue_entry
          SET   override_by = NULL
          WHERE id = new_entry.id;

    ELSIF new_entry.override_by IS NOT NULL THEN
        RETURN TRUE; -- already handled, don't notify
    END IF;

    NOTIFY queued_ingest;

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS diag_detail  = PG_EXCEPTION_DETAIL,
                            diag_context = PG_EXCEPTION_CONTEXT;
    RAISE WARNING '%\n%', diag_detail, diag_context;
    RETURN FALSE;
END;
$F$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION action.process_ingest_queue_entry (qeid BIGINT) RETURNS BOOL AS $func$
DECLARE
    ingest_success  BOOL := NULL;
    qe              action.ingest_queue_entry%ROWTYPE;
    aid             authority.record_entry.id%TYPE;
BEGIN

    SELECT * INTO qe FROM action.ingest_queue_entry WHERE id = qeid;
    IF qe.ingest_time IS NOT NULL OR qe.override_by IS NOT NULL THEN
        RETURN TRUE; -- Already done
    END IF;

    IF qe.action = 'delete' THEN
        IF qe.record_type = 'biblio' THEN
            SELECT metabib.indexing_delete(r.*, qe.state_data) INTO ingest_success FROM biblio.record_entry r WHERE r.id = qe.record;
        ELSIF qe.record_type = 'authority' THEN
            SELECT authority.indexing_delete(r.*, qe.state_data) INTO ingest_success FROM authority.record_entry r WHERE r.id = qe.record;
        END IF;
    ELSE
        IF qe.record_type = 'biblio' THEN
            IF qe.action = 'propagate' THEN
                SELECT authority.apply_propagate_changes(qe.state_data::BIGINT, qe.record) INTO aid;
                SELECT aid = qe.state_data::BIGINT INTO ingest_success;
            ELSE
                SELECT metabib.indexing_update(r.*, qe.action = 'insert', qe.state_data) INTO ingest_success FROM biblio.record_entry r WHERE r.id = qe.record;
            END IF;
        ELSIF qe.record_type = 'authority' THEN
            SELECT authority.indexing_update(r.*, qe.action = 'insert', qe.state_data) INTO ingest_success FROM authority.record_entry r WHERE r.id = qe.record;
        END IF;
    END IF;

    IF NOT ingest_success THEN
        UPDATE action.ingest_queue_entry SET fail_time = NOW() WHERE id = qe.id;
        PERFORM * FROM config.internal_flag WHERE name = 'ingest.queued.abort_on_error' AND enabled;
        IF FOUND THEN
            RAISE EXCEPTION 'Ingest action of % on %.record_entry % for queue entry % failed', qe.action, qe.record_type, qe.record, qe.id;
        ELSE
            RAISE WARNING 'Ingest action of % on %.record_entry % for queue entry % failed', qe.action, qe.record_type, qe.record, qe.id;
        END IF;
    ELSE
        UPDATE action.ingest_queue_entry SET ingest_time = NOW() WHERE id = qe.id;
    END IF;

    RETURN ingest_success;
END;
$func$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION action.complete_duplicated_entries () RETURNS TRIGGER AS $F$
BEGIN
    IF NEW.ingest_time IS NOT NULL THEN
        UPDATE action.ingest_queue_entry SET ingest_time = NEW.ingest_time WHERE override_by = NEW.id;
    END IF;

    RETURN NULL;
END;
$F$ LANGUAGE PLPGSQL;

CREATE TRIGGER complete_duplicated_entries_trigger
    AFTER UPDATE ON action.ingest_queue_entry
    FOR EACH ROW WHEN (NEW.override_by IS NULL)
    EXECUTE PROCEDURE action.complete_duplicated_entries();

CREATE OR REPLACE FUNCTION action.set_ingest_queue(INT) RETURNS VOID AS $$
    $_SHARED{"ingest_queue_id"} = $_[0];
$$ LANGUAGE plperlu;

CREATE OR REPLACE FUNCTION action.get_ingest_queue() RETURNS INT AS $$
    return $_SHARED{"ingest_queue_id"};
$$ LANGUAGE plperlu;

CREATE OR REPLACE FUNCTION action.clear_ingest_queue() RETURNS VOID AS $$
    delete($_SHARED{"ingest_queue_id"});
$$ LANGUAGE plperlu;

CREATE OR REPLACE FUNCTION action.set_queued_ingest_force(TEXT) RETURNS VOID AS $$
    $_SHARED{"ingest_queue_force"} = $_[0];
$$ LANGUAGE plperlu;

CREATE OR REPLACE FUNCTION action.get_queued_ingest_force() RETURNS TEXT AS $$
    return $_SHARED{"ingest_queue_force"};
$$ LANGUAGE plperlu;

CREATE OR REPLACE FUNCTION action.clear_queued_ingest_force() RETURNS VOID AS $$
    delete($_SHARED{"ingest_queue_force"});
$$ LANGUAGE plperlu;

------------------ ingest functions ------------------

CREATE OR REPLACE FUNCTION metabib.indexing_delete (bib biblio.record_entry, extra TEXT DEFAULT NULL) RETURNS BOOL AS $func$
DECLARE
    tmp_bool BOOL;
    diag_detail     TEXT;
    diag_context    TEXT;
BEGIN
    PERFORM * FROM config.internal_flag WHERE name = 'ingest.metarecord_mapping.preserve_on_delete' AND enabled;
    tmp_bool := FOUND;

    PERFORM metabib.remap_metarecord_for_bib(bib.id, bib.fingerprint, TRUE, tmp_bool);

    IF NOT tmp_bool THEN
        -- One needs to keep these around to support searches
        -- with the #deleted modifier, so one should turn on the named
        -- internal flag for that functionality.
        DELETE FROM metabib.record_attr_vector_list WHERE source = bib.id;
    END IF;

    DELETE FROM authority.bib_linking abl WHERE abl.bib = bib.id; -- Avoid updating fields in bibs that are no longer visible
    DELETE FROM biblio.peer_bib_copy_map WHERE peer_record = bib.id; -- Separate any multi-homed items
    DELETE FROM metabib.browse_entry_def_map WHERE source = bib.id; -- Don't auto-suggest deleted bibs

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS diag_detail  = PG_EXCEPTION_DETAIL,
                            diag_context = PG_EXCEPTION_CONTEXT;
    RAISE WARNING '%\n%', diag_detail, diag_context;
    RETURN FALSE;
END;
$func$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION metabib.indexing_update (bib biblio.record_entry, insert_only BOOL DEFAULT FALSE, extra TEXT DEFAULT NULL) RETURNS BOOL AS $func$
DECLARE
    skip_facet   BOOL   := FALSE;
    skip_display BOOL   := FALSE;
    skip_browse  BOOL   := FALSE;
    skip_search  BOOL   := FALSE;
    skip_auth    BOOL   := FALSE;
    skip_full    BOOL   := FALSE;
    skip_attrs   BOOL   := FALSE;
    skip_luri    BOOL   := FALSE;
    skip_mrmap   BOOL   := FALSE;
    only_attrs   TEXT[] := NULL;
    only_fields  INT[]  := '{}'::INT[];
    diag_detail     TEXT;
    diag_context    TEXT;
BEGIN

    -- Record authority linking
    SELECT extra LIKE '%skip_authority%' INTO skip_auth;
    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_authority_linking' AND enabled;
    IF NOT FOUND AND NOT skip_auth THEN
        PERFORM biblio.map_authority_linking( bib.id, bib.marc );
    END IF;

    -- Flatten and insert the mfr data
    SELECT extra LIKE '%skip_full_rec%' INTO skip_full;
    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_metabib_full_rec' AND enabled;
    IF NOT FOUND AND NOT skip_full THEN
        PERFORM metabib.reingest_metabib_full_rec(bib.id);
    END IF;

    -- Now we pull out attribute data, which is dependent on the mfr for all but XPath-based fields
    SELECT extra LIKE '%skip_attrs%' INTO skip_attrs;
    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_metabib_rec_descriptor' AND enabled;
    IF NOT FOUND AND NOT skip_attrs THEN
        IF extra ~ 'attr\(\s*(\w[ ,\w]*?)\s*\)' THEN
            SELECT REGEXP_SPLIT_TO_ARRAY(
                (REGEXP_MATCHES(extra, 'attr\(\s*(\w[ ,\w]*?)\s*\)'))[1],
                '\s*,\s*'
            ) INTO only_attrs;
        END IF;

        PERFORM metabib.reingest_record_attributes(bib.id, only_attrs, bib.marc, insert_only);
    END IF;

    -- Gather and insert the field entry data
    SELECT extra LIKE '%skip_facet%' INTO skip_facet;
    SELECT extra LIKE '%skip_display%' INTO skip_display;
    SELECT extra LIKE '%skip_browse%' INTO skip_browse;
    SELECT extra LIKE '%skip_search%' INTO skip_search;

    IF extra ~ 'field_list\(\s*(\d[ ,\d]+)\s*\)' THEN
        SELECT REGEXP_SPLIT_TO_ARRAY(
            (REGEXP_MATCHES(extra, 'field_list\(\s*(\d[ ,\d]+)\s*\)'))[1],
            '\s*,\s*'
        )::INT[] INTO only_fields;
    END IF;

    IF NOT skip_facet OR NOT skip_display OR NOT skip_browse OR NOT skip_search THEN
        PERFORM metabib.reingest_metabib_field_entries(bib.id, skip_facet, skip_display, skip_browse, skip_search, only_fields);
    END IF;

    -- Located URI magic
    SELECT extra LIKE '%skip_luri%' INTO skip_luri;
    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_located_uri' AND enabled;
    IF NOT FOUND AND NOT skip_luri THEN PERFORM biblio.extract_located_uris( bib.id, bib.marc, bib.editor ); END IF;

    -- (re)map metarecord-bib linking
    SELECT extra LIKE '%skip_mrmap%' INTO skip_mrmap;
    IF insert_only THEN -- if not deleted and performing an insert, check for the flag
        PERFORM * FROM config.internal_flag WHERE name = 'ingest.metarecord_mapping.skip_on_insert' AND enabled;
        IF NOT FOUND AND NOT skip_mrmap THEN
            PERFORM metabib.remap_metarecord_for_bib( bib.id, bib.fingerprint );
        END IF;
    ELSE -- we're doing an update, and we're not deleted, remap
        PERFORM * FROM config.internal_flag WHERE name = 'ingest.metarecord_mapping.skip_on_update' AND enabled;
        IF NOT FOUND AND NOT skip_mrmap THEN
            PERFORM metabib.remap_metarecord_for_bib( bib.id, bib.fingerprint );
        END IF;
    END IF;

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS diag_detail  = PG_EXCEPTION_DETAIL,
                            diag_context = PG_EXCEPTION_CONTEXT;
    RAISE WARNING '%\n%', diag_detail, diag_context;
    RETURN FALSE;
END;
$func$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION authority.indexing_delete (auth authority.record_entry, extra TEXT DEFAULT NULL) RETURNS BOOL AS $func$
DECLARE
    tmp_bool BOOL;
    diag_detail     TEXT;
    diag_context    TEXT;
BEGIN
    DELETE FROM authority.bib_linking WHERE authority = NEW.id; -- Avoid updating fields in bibs that are no longer visible
    DELETE FROM authority.full_rec WHERE record = NEW.id; -- Avoid validating fields against deleted authority records
    DELETE FROM authority.simple_heading WHERE record = NEW.id;
      -- Should remove matching $0 from controlled fields at the same time?

    -- XXX What do we about the actual linking subfields present in
    -- authority records that target this one when this happens?
    DELETE FROM authority.authority_linking WHERE source = NEW.id OR target = NEW.id;

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS diag_detail  = PG_EXCEPTION_DETAIL,
                            diag_context = PG_EXCEPTION_CONTEXT;
    RAISE WARNING '%\n%', diag_detail, diag_context;
    RETURN FALSE;
END;
$func$ LANGUAGE PLPGSQL;


CREATE OR REPLACE FUNCTION authority.indexing_update (auth authority.record_entry, insert_only BOOL DEFAULT FALSE, old_heading TEXT DEFAULT NULL) RETURNS BOOL AS $func$
DECLARE
    ashs    authority.simple_heading%ROWTYPE;
    mbe_row metabib.browse_entry%ROWTYPE;
    mbe_id  BIGINT;
    ash_id  BIGINT;
    diag_detail     TEXT;
    diag_context    TEXT;
BEGIN

    -- Unless there's a setting stopping us, propagate these updates to any linked bib records when the heading changes
    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_authority_auto_update' AND enabled;

    IF NOT FOUND AND auth.heading <> old_heading THEN
        PERFORM authority.propagate_changes(auth.id);
    END IF;

    IF NOT insert_only THEN
        DELETE FROM authority.authority_linking WHERE source = auth.id;
        DELETE FROM authority.simple_heading WHERE record = auth.id;
    END IF;

    INSERT INTO authority.authority_linking (source, target, field)
        SELECT source, target, field FROM authority.calculate_authority_linking(
            auth.id, auth.control_set, auth.marc::XML
        );

    FOR ashs IN SELECT * FROM authority.simple_heading_set(auth.marc) LOOP

        INSERT INTO authority.simple_heading (record,atag,value,sort_value,thesaurus)
            VALUES (ashs.record, ashs.atag, ashs.value, ashs.sort_value, ashs.thesaurus);
            ash_id := CURRVAL('authority.simple_heading_id_seq'::REGCLASS);

        SELECT INTO mbe_row * FROM metabib.browse_entry
            WHERE value = ashs.value AND sort_value = ashs.sort_value;

        IF FOUND THEN
            mbe_id := mbe_row.id;
        ELSE
            INSERT INTO metabib.browse_entry
                ( value, sort_value ) VALUES
                ( ashs.value, ashs.sort_value );

            mbe_id := CURRVAL('metabib.browse_entry_id_seq'::REGCLASS);
        END IF;

        INSERT INTO metabib.browse_entry_simple_heading_map (entry,simple_heading) VALUES (mbe_id,ash_id);

    END LOOP;

    -- Flatten and insert the afr data
    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_authority_full_rec' AND enabled;
    IF NOT FOUND THEN
        PERFORM authority.reingest_authority_full_rec(auth.id);
        PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_authority_rec_descriptor' AND enabled;
        IF NOT FOUND THEN
            PERFORM authority.reingest_authority_rec_descriptor(auth.id);
        END IF;
    END IF;

    PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_symspell_reification' AND enabled;
    IF NOT FOUND THEN
        PERFORM search.symspell_dictionary_reify();
    END IF;

    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS diag_detail  = PG_EXCEPTION_DETAIL,
                            diag_context = PG_EXCEPTION_CONTEXT;
    RAISE WARNING '%\n%', diag_detail, diag_context;
    RETURN FALSE;
END;
$func$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION evergreen.indexing_ingest_or_delete () RETURNS TRIGGER AS $func$
DECLARE
    old_state_data      TEXT := '';
    new_action          TEXT;
    queuing_force       TEXT;
    queuing_flag_name   TEXT;
    queuing_flag        BOOL := FALSE;
    queuing_success     BOOL := FALSE;
    ingest_success      BOOL := FALSE;
    ingest_queue        INT;
BEGIN

    -- Identify the ingest action type
    IF TG_OP = 'UPDATE' THEN

        -- Gather type-specific data for later use
        IF TG_TABLE_SCHEMA = 'authority' THEN
            old_state_data = OLD.heading;
        END IF;

        IF NOT OLD.deleted THEN -- maybe reingest?
            IF NEW.deleted THEN
                new_action = 'delete'; -- nope, delete
            ELSE
                new_action = 'update'; -- yes, update
            END IF;
        ELSIF NOT NEW.deleted THEN
            new_action = 'insert'; -- revivify, AKA insert
        ELSE
            RETURN NEW; -- was and is still deleted, don't ingest
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        new_action = 'insert'; -- brand new
    ELSE
        RETURN OLD; -- really deleting the record
    END IF;

    queuing_flag_name := 'ingest.queued.'||TG_TABLE_SCHEMA||'.'||new_action;
    -- See if we should be queuing anything
    SELECT  enabled INTO queuing_flag
      FROM  config.internal_flag
      WHERE name IN ('ingest.queued.all','ingest.queued.'||TG_TABLE_SCHEMA||'.all', queuing_flag_name)
            AND enabled
      LIMIT 1;

    SELECT action.get_queued_ingest_force() INTO queuing_force;
    IF queuing_flag IS NULL AND queuing_force = queuing_flag_name THEN
        queuing_flag := TRUE;
    END IF;

    -- you (or part of authority propagation) can forcibly disable specific queuing actions
    IF queuing_force = queuing_flag_name||'.disabled' THEN
        queuing_flag := FALSE;
    END IF;

    -- And if we should be queuing ...
    IF queuing_flag THEN
        ingest_queue := action.get_ingest_queue();

        -- ... but this is NOT a named or forced queue request (marc editor update, say, or vandelay overlay)...
        IF queuing_force IS NULL AND ingest_queue IS NULL AND new_action = 'update' THEN -- re-ingest?

            PERFORM * FROM config.internal_flag WHERE name = 'ingest.reingest.force_on_same_marc' AND enabled;

            --  ... then don't do anything if ingest.reingest.force_on_same_marc is not enabled and the MARC hasn't changed
            IF NOT FOUND AND OLD.marc = NEW.marc THEN
                RETURN NEW;
            END IF;
        END IF;

        -- Otherwise, attempt to enqueue
        SELECT action.enqueue_ingest_entry( NEW.id, TG_TABLE_SCHEMA, NOW(), ingest_queue, new_action, old_state_data) INTO queuing_success;
    END IF;

    -- If queuing was not requested, or failed for some reason, do it live.
    IF NOT queuing_success THEN
        IF queuing_flag THEN
            RAISE WARNING 'Enqueuing of %.record_entry % for ingest failed, attempting direct ingest', TG_TABLE_SCHEMA, NEW.id;
        END IF;

        IF new_action = 'delete' THEN
            IF TG_TABLE_SCHEMA = 'biblio' THEN
                SELECT metabib.indexing_delete(NEW.*, old_state_data) INTO ingest_success;
            ELSIF TG_TABLE_SCHEMA = 'authority' THEN
                SELECT authority.indexing_delete(NEW.*, old_state_data) INTO ingest_success;
            END IF;
        ELSE
            IF TG_TABLE_SCHEMA = 'biblio' THEN
                SELECT metabib.indexing_update(NEW.*, new_action = 'insert', old_state_data) INTO ingest_success;
            ELSIF TG_TABLE_SCHEMA = 'authority' THEN
                SELECT authority.indexing_update(NEW.*, new_action = 'insert', old_state_data) INTO ingest_success;
            END IF;
        END IF;
        
        IF NOT ingest_success THEN
            PERFORM * FROM config.internal_flag WHERE name = 'ingest.queued.abort_on_error' AND enabled;
            IF FOUND THEN
                RAISE EXCEPTION 'Ingest of %.record_entry % failed', TG_TABLE_SCHEMA, NEW.id;
            ELSE
                RAISE WARNING 'Ingest of %.record_entry % failed', TG_TABLE_SCHEMA, NEW.id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$func$ LANGUAGE PLPGSQL;

DROP TRIGGER aaa_indexing_ingest_or_delete ON biblio.record_entry;
DROP TRIGGER aaa_auth_ingest_or_delete ON authority.record_entry;

CREATE TRIGGER aaa_indexing_ingest_or_delete AFTER INSERT OR UPDATE ON biblio.record_entry FOR EACH ROW EXECUTE PROCEDURE evergreen.indexing_ingest_or_delete ();
CREATE TRIGGER aaa_auth_ingest_or_delete AFTER INSERT OR UPDATE ON authority.record_entry FOR EACH ROW EXECUTE PROCEDURE evergreen.indexing_ingest_or_delete ();

CREATE OR REPLACE FUNCTION metabib.reingest_record_attributes (rid BIGINT, pattr_list TEXT[] DEFAULT NULL, prmarc TEXT DEFAULT NULL, rdeleted BOOL DEFAULT TRUE) RETURNS VOID AS $func$
DECLARE
    transformed_xml TEXT;
    rmarc           TEXT := prmarc;
    tmp_val         TEXT;
    prev_xfrm       TEXT;
    normalizer      RECORD;
    xfrm            config.xml_transform%ROWTYPE;
    attr_vector     INT[] := '{}'::INT[];
    attr_vector_tmp INT[];
    attr_list       TEXT[] := pattr_list;
    attr_value      TEXT[];
    norm_attr_value TEXT[];
    tmp_xml         TEXT;
    tmp_array       TEXT[];
    attr_def        config.record_attr_definition%ROWTYPE;
    ccvm_row        config.coded_value_map%ROWTYPE;
    jump_past       BOOL;
BEGIN

    IF attr_list IS NULL OR rdeleted THEN -- need to do the full dance on INSERT or undelete
        SELECT ARRAY_AGG(name) INTO attr_list FROM config.record_attr_definition
        WHERE (
            tag IS NOT NULL OR
            fixed_field IS NOT NULL OR
            xpath IS NOT NULL OR
            phys_char_sf IS NOT NULL OR
            composite
        ) AND (
            filter OR sorter
        );
    END IF;

    IF rmarc IS NULL THEN
        SELECT marc INTO rmarc FROM biblio.record_entry WHERE id = rid;
    END IF;

    FOR attr_def IN SELECT * FROM config.record_attr_definition WHERE NOT composite AND name = ANY( attr_list ) ORDER BY format LOOP

        jump_past := FALSE; -- This gets set when we are non-multi and have found something
        attr_value := '{}'::TEXT[];
        norm_attr_value := '{}'::TEXT[];
        attr_vector_tmp := '{}'::INT[];

        SELECT * INTO ccvm_row FROM config.coded_value_map c WHERE c.ctype = attr_def.name LIMIT 1;

        IF attr_def.tag IS NOT NULL THEN -- tag (and optional subfield list) selection
            SELECT  ARRAY_AGG(value) INTO attr_value
              FROM  (SELECT * FROM metabib.full_rec ORDER BY tag, subfield) AS x
              WHERE record = rid
                    AND tag LIKE attr_def.tag
                    AND CASE
                        WHEN attr_def.sf_list IS NOT NULL
                            THEN POSITION(subfield IN attr_def.sf_list) > 0
                        ELSE TRUE
                    END
              GROUP BY tag
              ORDER BY tag;

            IF NOT attr_def.multi THEN
                attr_value := ARRAY[ARRAY_TO_STRING(attr_value, COALESCE(attr_def.joiner,' '))];
                jump_past := TRUE;
            END IF;
        END IF;

        IF NOT jump_past AND attr_def.fixed_field IS NOT NULL THEN -- a named fixed field, see config.marc21_ff_pos_map.fixed_field
            attr_value := attr_value || vandelay.marc21_extract_fixed_field_list(rmarc, attr_def.fixed_field);

            IF NOT attr_def.multi THEN
                attr_value := ARRAY[attr_value[1]];
                jump_past := TRUE;
            END IF;
        END IF;

        IF NOT jump_past AND attr_def.xpath IS NOT NULL THEN -- and xpath expression

            SELECT INTO xfrm * FROM config.xml_transform WHERE name = attr_def.format;

            -- See if we can skip the XSLT ... it's expensive
            IF prev_xfrm IS NULL OR prev_xfrm <> xfrm.name THEN
                -- Can't skip the transform
                IF xfrm.xslt <> '---' THEN
                    transformed_xml := oils_xslt_process(rmarc,xfrm.xslt);
                ELSE
                    transformed_xml := rmarc;
                END IF;

                prev_xfrm := xfrm.name;
            END IF;

            IF xfrm.name IS NULL THEN
                -- just grab the marcxml (empty) transform
                SELECT INTO xfrm * FROM config.xml_transform WHERE xslt = '---' LIMIT 1;
                prev_xfrm := xfrm.name;
            END IF;

            FOR tmp_xml IN SELECT UNNEST(oils_xpath(attr_def.xpath, transformed_xml, ARRAY[ARRAY[xfrm.prefix, xfrm.namespace_uri]])) LOOP
                tmp_val := oils_xpath_string(
                                '//*',
                                tmp_xml,
                                COALESCE(attr_def.joiner,' '),
                                ARRAY[ARRAY[xfrm.prefix, xfrm.namespace_uri]]
                            );
                IF tmp_val IS NOT NULL AND BTRIM(tmp_val) <> '' THEN
                    attr_value := attr_value || tmp_val;
                    EXIT WHEN NOT attr_def.multi;
                END IF;
            END LOOP;
        END IF;

        IF NOT jump_past AND attr_def.phys_char_sf IS NOT NULL THEN -- a named Physical Characteristic, see config.marc21_physical_characteristic_*_map
            SELECT  ARRAY_AGG(m.value) INTO tmp_array
              FROM  vandelay.marc21_physical_characteristics(rmarc) v
                    LEFT JOIN config.marc21_physical_characteristic_value_map m ON (m.id = v.value)
              WHERE v.subfield = attr_def.phys_char_sf AND (m.value IS NOT NULL AND BTRIM(m.value) <> '')
                    AND ( ccvm_row.id IS NULL OR ( ccvm_row.id IS NOT NULL AND v.id IS NOT NULL) );

            attr_value := attr_value || tmp_array;

            IF NOT attr_def.multi THEN
                attr_value := ARRAY[attr_value[1]];
            END IF;

        END IF;

                -- apply index normalizers to attr_value
        FOR tmp_val IN SELECT value FROM UNNEST(attr_value) x(value) LOOP
            FOR normalizer IN
                SELECT  n.func AS func,
                        n.param_count AS param_count,
                        m.params AS params
                  FROM  config.index_normalizer n
                        JOIN config.record_attr_index_norm_map m ON (m.norm = n.id)
                  WHERE attr = attr_def.name
                  ORDER BY m.pos LOOP
                    EXECUTE 'SELECT ' || normalizer.func || '(' ||
                    COALESCE( quote_literal( tmp_val ), 'NULL' ) ||
                        CASE
                            WHEN normalizer.param_count > 0
                                THEN ',' || REPLACE(REPLACE(BTRIM(normalizer.params,'[]'),E'\'',E'\\\''),E'"',E'\'')
                                ELSE ''
                            END ||
                    ')' INTO tmp_val;

            END LOOP;
            IF tmp_val IS NOT NULL AND tmp_val <> '' THEN
                -- note that a string that contains only blanks
                -- is a valid value for some attributes
                norm_attr_value := norm_attr_value || tmp_val;
            END IF;
        END LOOP;

        IF attr_def.filter THEN
            -- Create unknown uncontrolled values and find the IDs of the values
            IF ccvm_row.id IS NULL THEN
                FOR tmp_val IN SELECT value FROM UNNEST(norm_attr_value) x(value) LOOP
                    IF tmp_val IS NOT NULL AND BTRIM(tmp_val) <> '' THEN
                        BEGIN -- use subtransaction to isolate unique constraint violations
                            INSERT INTO metabib.uncontrolled_record_attr_value ( attr, value ) VALUES ( attr_def.name, tmp_val );
                        EXCEPTION WHEN unique_violation THEN END;
                    END IF;
                END LOOP;

                SELECT ARRAY_AGG(id) INTO attr_vector_tmp FROM metabib.uncontrolled_record_attr_value WHERE attr = attr_def.name AND value = ANY( norm_attr_value );
            ELSE
                SELECT ARRAY_AGG(id) INTO attr_vector_tmp FROM config.coded_value_map WHERE ctype = attr_def.name AND code = ANY( norm_attr_value );
            END IF;

            -- Add the new value to the vector
            attr_vector := attr_vector || attr_vector_tmp;
        END IF;

        IF attr_def.sorter THEN
            DELETE FROM metabib.record_sorter WHERE source = rid AND attr = attr_def.name;
            IF norm_attr_value[1] IS NOT NULL THEN
                INSERT INTO metabib.record_sorter (source, attr, value) VALUES (rid, attr_def.name, norm_attr_value[1]);
            END IF;
        END IF;

    END LOOP;

/* We may need to rewrite the vlist to contain
   the intersection of new values for requested
   attrs and old values for ignored attrs. To
   do this, we take the old attr vlist and
   subtract any values that are valid for the
   requested attrs, and then add back the new
   set of attr values. */

    IF ARRAY_LENGTH(pattr_list, 1) > 0 THEN
        SELECT vlist INTO attr_vector_tmp FROM metabib.record_attr_vector_list WHERE source = rid;
        SELECT attr_vector_tmp - ARRAY_AGG(id::INT) INTO attr_vector_tmp FROM metabib.full_attr_id_map WHERE attr = ANY (pattr_list);
        attr_vector := attr_vector || attr_vector_tmp;
    END IF;

    -- On to composite attributes, now that the record attrs have been pulled.  Processed in name order, so later composite
    -- attributes can depend on earlier ones.
    PERFORM metabib.compile_composite_attr_cache_init();
    FOR attr_def IN SELECT * FROM config.record_attr_definition WHERE composite AND name = ANY( attr_list ) ORDER BY name LOOP

        FOR ccvm_row IN SELECT * FROM config.coded_value_map c WHERE c.ctype = attr_def.name ORDER BY value LOOP

            tmp_val := metabib.compile_composite_attr( ccvm_row.id );
            CONTINUE WHEN tmp_val IS NULL OR tmp_val = ''; -- nothing to do

            IF attr_def.filter THEN
                IF attr_vector @@ tmp_val::query_int THEN
                    attr_vector = attr_vector + intset(ccvm_row.id);
                    EXIT WHEN NOT attr_def.multi;
                END IF;
            END IF;

            IF attr_def.sorter THEN
                IF attr_vector @@ tmp_val THEN
                    DELETE FROM metabib.record_sorter WHERE source = rid AND attr = attr_def.name;
                    INSERT INTO metabib.record_sorter (source, attr, value) VALUES (rid, attr_def.name, ccvm_row.code);
                END IF;
            END IF;

        END LOOP;

    END LOOP;

    IF ARRAY_LENGTH(attr_vector, 1) > 0 THEN
        INSERT INTO metabib.record_attr_vector_list (source, vlist) VALUES (rid, attr_vector)
            ON CONFLICT (source) DO UPDATE SET vlist = EXCLUDED.vlist;
    END IF;

END;

$func$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION authority.propagate_changes
    (aid BIGINT, bid BIGINT) RETURNS BIGINT AS $func$
DECLARE
    queuing_success BOOL := FALSE;
BEGIN

    PERFORM 1 FROM config.global_flag
        WHERE name IN ('ingest.queued.all','ingest.queued.authority.propagate')
            AND enabled;

    IF FOUND THEN
        -- XXX enqueue special 'propagate' bib action
        SELECT action.enqueue_ingest_entry( bid, 'biblio', NOW(), NULL, 'propagate', aid::TEXT) INTO queuing_success;

        IF queuing_success THEN
            RETURN aid;
        END IF;
    END IF;

    PERFORM authority.apply_propagate_changes(aid, bid);
    RETURN aid;
END;
$func$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION authority.apply_propagate_changes
    (aid BIGINT, bid BIGINT) RETURNS BIGINT AS $func$
DECLARE
    bib_forced  BOOL := FALSE;
    bib_rec     biblio.record_entry%ROWTYPE;
    new_marc    TEXT;
BEGIN

    SELECT INTO bib_rec * FROM biblio.record_entry WHERE id = bid;

    new_marc := vandelay.merge_record_xml(
        bib_rec.marc, authority.generate_overlay_template(aid));

    IF new_marc = bib_rec.marc THEN
        -- Authority record change had no impact on this bib record.
        -- Nothing left to do.
        RETURN aid;
    END IF;

    PERFORM 1 FROM config.global_flag
        WHERE name = 'ingest.disable_authority_auto_update_bib_meta'
            AND enabled;

    IF NOT FOUND THEN
        -- update the bib record editor and edit_date
        bib_rec.editor := (
            SELECT editor FROM authority.record_entry WHERE id = aid);
        bib_rec.edit_date = NOW();
    END IF;

    PERFORM action.set_queued_ingest_force('ingest.queued.biblio.update.disabled');

    UPDATE biblio.record_entry SET
        marc = new_marc,
        editor = bib_rec.editor,
        edit_date = bib_rec.edit_date
    WHERE id = bid;

    PERFORM action.clear_queued_ingest_force();

    RETURN aid;

END;
$func$ LANGUAGE PLPGSQL;

CREATE OR REPLACE FUNCTION metabib.reingest_metabib_field_entries(
    bib_id BIGINT,
    skip_facet BOOL DEFAULT FALSE,
    skip_display BOOL DEFAULT FALSE,
    skip_browse BOOL DEFAULT FALSE,
    skip_search BOOL DEFAULT FALSE,
    only_fields INT[] DEFAULT '{}'::INT[]
) RETURNS VOID AS $func$
DECLARE
    fclass          RECORD;
    ind_data        metabib.field_entry_template%ROWTYPE;
    mbe_row         metabib.browse_entry%ROWTYPE;
    mbe_id          BIGINT;
    b_skip_facet    BOOL;
    b_skip_display    BOOL;
    b_skip_browse   BOOL;
    b_skip_search   BOOL;
    value_prepped   TEXT;
    field_list      INT[] := only_fields;
    field_types     TEXT[] := '{}'::TEXT[];
BEGIN

    IF field_list = '{}'::INT[] THEN
        SELECT ARRAY_AGG(id) INTO field_list FROM config.metabib_field;
    END IF;

    SELECT COALESCE(NULLIF(skip_facet, FALSE), EXISTS (SELECT enabled FROM config.internal_flag WHERE name =  'ingest.skip_facet_indexing' AND enabled)) INTO b_skip_facet;
    SELECT COALESCE(NULLIF(skip_display, FALSE), EXISTS (SELECT enabled FROM config.internal_flag WHERE name =  'ingest.skip_display_indexing' AND enabled)) INTO b_skip_display;
    SELECT COALESCE(NULLIF(skip_browse, FALSE), EXISTS (SELECT enabled FROM config.internal_flag WHERE name =  'ingest.skip_browse_indexing' AND enabled)) INTO b_skip_browse;
    SELECT COALESCE(NULLIF(skip_search, FALSE), EXISTS (SELECT enabled FROM config.internal_flag WHERE name =  'ingest.skip_search_indexing' AND enabled)) INTO b_skip_search;

    IF NOT b_skip_facet THEN field_types := field_types || '{facet}'; END IF;
    IF NOT b_skip_display THEN field_types := field_types || '{display}'; END IF;
    IF NOT b_skip_browse THEN field_types := field_types || '{browse}'; END IF;
    IF NOT b_skip_search THEN field_types := field_types || '{search}'; END IF;

    PERFORM * FROM config.internal_flag WHERE name = 'ingest.assume_inserts_only' AND enabled;
    IF NOT FOUND THEN
        IF NOT b_skip_search THEN
            FOR fclass IN SELECT * FROM config.metabib_class LOOP
                EXECUTE $$DELETE FROM metabib.$$ || fclass.name || $$_field_entry WHERE source = $$ || bib_id || $$ AND field = ANY($1)$$ USING field_list;
            END LOOP;
        END IF;
        IF NOT b_skip_facet THEN
            DELETE FROM metabib.facet_entry WHERE source = bib_id AND field = ANY(field_list);
        END IF;
        IF NOT b_skip_display THEN
            DELETE FROM metabib.display_entry WHERE source = bib_id AND field = ANY(field_list);
        END IF;
        IF NOT b_skip_browse THEN
            DELETE FROM metabib.browse_entry_def_map WHERE source = bib_id AND def = ANY(field_list);
        END IF;
    END IF;

    FOR ind_data IN SELECT * FROM biblio.extract_metabib_field_entry( bib_id, ' ', field_types, field_list ) LOOP

	-- don't store what has been normalized away
        CONTINUE WHEN ind_data.value IS NULL;

        IF ind_data.field < 0 THEN
            ind_data.field = -1 * ind_data.field;
        END IF;

        IF ind_data.facet_field AND NOT b_skip_facet THEN
            INSERT INTO metabib.facet_entry (field, source, value)
                VALUES (ind_data.field, ind_data.source, ind_data.value);
        END IF;

        IF ind_data.display_field AND NOT b_skip_display THEN
            INSERT INTO metabib.display_entry (field, source, value)
                VALUES (ind_data.field, ind_data.source, ind_data.value);
        END IF;


        IF ind_data.browse_field AND NOT b_skip_browse THEN
            -- A caveat about this SELECT: this should take care of replacing
            -- old mbe rows when data changes, but not if normalization (by
            -- which I mean specifically the output of
            -- evergreen.oils_tsearch2()) changes.  It may or may not be
            -- expensive to add a comparison of index_vector to index_vector
            -- to the WHERE clause below.

            CONTINUE WHEN ind_data.sort_value IS NULL;

            value_prepped := metabib.browse_normalize(ind_data.value, ind_data.field);

            /*
            IF ind_data.browse_nocase THEN -- for "nocase" browse definions, look for a preexisting row that matches case-insensitively on value and use that
                SELECT INTO mbe_row * FROM metabib.browse_entry
                    WHERE evergreen.lowercase(value) = evergreen.lowercase(value_prepped) AND sort_value = ind_data.sort_value
                    ORDER BY sort_value, value LIMIT 1; -- gotta pick something, I guess
            END IF;
            */

            -- KCLS
            SELECT INTO mbe_row * FROM metabib.browse_entry
                WHERE
                    MD5(value) = MD5(value_prepped) AND
                    MD5(sort_value) = MD5(ind_data.sort_value);

            -- KCLS
            IF FOUND THEN
                mbe_id := mbe_row.id;
            ELSE
                INSERT INTO metabib.browse_entry
                    ( value, sort_value, truncated_sort_value, metabib_fields_cache)
                    VALUES (
                        value_prepped,
                        ind_data.sort_value,
                        SUBSTR(ind_data.sort_value, 1, 2048),
                        '{}'
                    );
                mbe_id := CURRVAL('metabib.browse_entry_id_seq'::REGCLASS);
            END IF;


            /*
            IF mbe_row.id IS NOT NULL THEN -- asked to check for, and found, a "nocase" version to use
                mbe_id := mbe_row.id;
            ELSE -- otherwise, an UPSERT-protected variant
                INSERT INTO metabib.browse_entry
                    ( value, sort_value ) VALUES
                    ( value_prepped, ind_data.sort_value )
                  ON CONFLICT (sort_value, value) DO UPDATE SET sort_value = EXCLUDED.sort_value -- must update a row to return an existing id
                  RETURNING id INTO mbe_id;
            END IF;
            */

            INSERT INTO metabib.browse_entry_def_map (entry, def, source, authority)
                VALUES (mbe_id, ind_data.field, ind_data.source, ind_data.authority);
        END IF;

        IF ind_data.search_field AND NOT b_skip_search THEN
            -- Avoid inserting duplicate rows
            EXECUTE 'SELECT 1 FROM metabib.' || ind_data.field_class ||
                '_field_entry WHERE field = $1 AND source = $2 AND value = $3'
                INTO mbe_id USING ind_data.field, ind_data.source, ind_data.value;
                -- RAISE NOTICE 'Search for an already matching row returned %', mbe_id;
            IF mbe_id IS NULL THEN
                EXECUTE $$
                INSERT INTO metabib.$$ || ind_data.field_class || $$_field_entry (field, source, value)
                    VALUES ($$ ||
                        quote_literal(ind_data.field) || $$, $$ ||
                        quote_literal(ind_data.source) || $$, $$ ||
                        quote_literal(ind_data.value) ||
                    $$);$$;
            END IF;
        END IF;

    END LOOP;

    IF NOT b_skip_search THEN
        PERFORM metabib.update_combined_index_vectors(bib_id);
        PERFORM * FROM config.internal_flag WHERE name = 'ingest.disable_symspell_reification' AND enabled;
        IF NOT FOUND THEN
            PERFORM search.symspell_dictionary_reify();
        END IF;
    END IF;

    RETURN;
END;
$func$ LANGUAGE PLPGSQL;

-- get rid of old version
DROP FUNCTION authority.indexing_ingest_or_delete;


-- Skipping schema changes for now.  Clobbers a lot of custom code
-- for a feature we likely won't ever need.
-- SELECT evergreen.upgrade_deps_block_check('1374', :eg_version);

-- SELECT evergreen.upgrade_deps_block_check('1376', :eg_version);

CREATE OR REPLACE VIEW action.all_circulation_combined_types AS
 SELECT acirc.id AS id,
    acirc.xact_start,
    acirc.circ_lib,
    acirc.circ_staff,
    acirc.create_time,
    ac_acirc.circ_modifier AS item_type,
    'regular_circ'::text AS circ_type
   FROM action.circulation acirc,
    asset.copy ac_acirc
  WHERE acirc.target_copy = ac_acirc.id
UNION ALL
 SELECT ancc.id::BIGINT AS id,
    ancc.circ_time AS xact_start,
    ancc.circ_lib,
    ancc.staff AS circ_staff,
    ancc.circ_time AS create_time,
    cnct_ancc.name AS item_type,
    'non-cat_circ'::text AS circ_type
   FROM action.non_cataloged_circulation ancc,
    config.non_cataloged_type cnct_ancc
  WHERE ancc.item_type = cnct_ancc.id
UNION ALL
 SELECT aihu.id::BIGINT AS id,
    aihu.use_time AS xact_start,
    aihu.org_unit AS circ_lib,
    aihu.staff AS circ_staff,
    aihu.use_time AS create_time,
    ac_aihu.circ_modifier AS item_type,
    'in-house_use'::text AS circ_type
   FROM action.in_house_use aihu,
    asset.copy ac_aihu
  WHERE aihu.item = ac_aihu.id
UNION ALL
 SELECT ancihu.id::BIGINT AS id,
    ancihu.use_time AS xact_start,
    ancihu.org_unit AS circ_lib,
    ancihu.staff AS circ_staff,
    ancihu.use_time AS create_time,
    cnct_ancihu.name AS item_type,
    'non-cat-in-house_use'::text AS circ_type
   FROM action.non_cat_in_house_use ancihu,
    config.non_cataloged_type cnct_ancihu
  WHERE ancihu.item_type = cnct_ancihu.id
UNION ALL
 SELECT aacirc.id AS id,
    aacirc.xact_start,
    aacirc.circ_lib,
    aacirc.circ_staff,
    aacirc.create_time,
    ac_aacirc.circ_modifier AS item_type,
    'aged_circ'::text AS circ_type
   FROM action.aged_circulation aacirc,
    asset.copy ac_aacirc
  WHERE aacirc.target_copy = ac_aacirc.id;

-- SELECT evergreen.upgrade_deps_block_check('1378', :eg_version);

CREATE OR REPLACE FUNCTION search.highlight_display_fields(
    rid         BIGINT,
    tsq_map     TEXT, -- '(a | b) & c' => '1,2,3,4', ...
    css_class   TEXT DEFAULT 'oils_SH',
    hl_all      BOOL DEFAULT TRUE,
    minwords    INT DEFAULT 5,
    maxwords    INT DEFAULT 25,
    shortwords  INT DEFAULT 0,
    maxfrags    INT DEFAULT 0,
    delimiter   TEXT DEFAULT ' ... '
) RETURNS SETOF search.highlight_result AS $f$
DECLARE
    tsq         TEXT;
    fields      TEXT;
    afields     INT[];
    seen        INT[];
BEGIN

    FOR tsq, fields IN SELECT key, value FROM each(tsq_map::HSTORE) LOOP
        SELECT  ARRAY_AGG(unnest::INT) INTO afields
          FROM  unnest(regexp_split_to_array(fields,','));
        seen := seen || afields;

        RETURN QUERY
            SELECT * FROM search.highlight_display_fields_impl(
                rid, tsq, afields, css_class, hl_all,minwords,
                maxwords, shortwords, maxfrags, delimiter
            );
    END LOOP;

    RETURN QUERY
        SELECT  id,
                source,
                field,
                evergreen.escape_for_html(value) AS value,
                evergreen.escape_for_html(value) AS highlight
          FROM  metabib.display_entry
          WHERE source = rid
                AND NOT (field = ANY (seen));
END;
$f$ LANGUAGE PLPGSQL ROWS 10;

-- SELECT evergreen.upgrade_deps_block_check('1382', :eg_version); -- JBoyer / smorrison

-- Remove previous acpl 1 protection
DROP RULE protect_acl_id_1 ON asset.copy_location;

-- Ensure that the owning_lib is set to CONS (equivalent), *should* be a noop.
UPDATE asset.copy_location SET owning_lib = (SELECT id FROM actor.org_unit_ancestor_at_depth(owning_lib,0)) WHERE id = 1;

CREATE OR REPLACE FUNCTION asset.check_delete_copy_location(acpl_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    PERFORM TRUE FROM asset.copy WHERE location = acpl_id AND NOT deleted LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Copy location % contains active copies and cannot be deleted', acpl_id;
    END IF;
    
    IF acpl_id = 1 THEN
        RAISE EXCEPTION
            'Copy location 1 cannot be deleted';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION asset.copy_location_validate_edit()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.id = 1 THEN
        IF OLD.owning_lib != NEW.owning_lib OR NEW.deleted THEN
            RAISE EXCEPTION 'Copy location 1 cannot be moved or deleted';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER acpl_validate_edit BEFORE UPDATE ON asset.copy_location 
    FOR EACH ROW EXECUTE PROCEDURE asset.copy_location_validate_edit();

-- SELECT evergreen.upgrade_deps_block_check('1391', :eg_version);

DROP FUNCTION IF EXISTS evergreen.find_next_open_time(INT, TIMESTAMPTZ, BOOL, TIME, INT); --Get rid of the last version of this function with different arguments so it doesn't cause conflicts when calling it
CREATE OR REPLACE FUNCTION evergreen.find_next_open_time ( circ_lib INT, initial TIMESTAMPTZ, hourly BOOL DEFAULT FALSE, initial_time TIME DEFAULT NULL, has_hoo BOOL DEFAULT TRUE )
    RETURNS TIMESTAMPTZ AS $$
DECLARE
    day_number      INT;
    plus_days       INT;
    final_time      TEXT;
    time_adjusted   BOOL;
    hoo_open        TIME WITHOUT TIME ZONE;
    hoo_close       TIME WITHOUT TIME ZONE;
    adjacent        actor.org_unit_closed%ROWTYPE;
    breakout        INT := 0;
BEGIN

    IF initial_time IS NULL THEN
        initial_time := initial::TIME;
    END IF;

    final_time := (initial + '1 second'::INTERVAL)::TEXT;
    LOOP
        breakout := breakout + 1;

        time_adjusted := FALSE;

        IF has_hoo THEN -- Don't check hours if they have no hoo. I think the behavior in that case is that we act like they're always open? Better than making things due in 2 years.
                        -- Don't expect anyone to call this with it set to false; it's just for our own recursive use.
            day_number := EXTRACT(ISODOW FROM final_time::TIMESTAMPTZ) - 1; --Get which day of the week  it is from which it started on.
            plus_days := 0;
            has_hoo := FALSE; -- set has_hoo to false to check if any days are open (for the first recursion where it's always true)
            FOR i IN 1..7 LOOP
                EXECUTE 'SELECT dow_' || day_number || '_open, dow_' || day_number || '_close FROM actor.hours_of_operation WHERE id = $1'
                    INTO hoo_open, hoo_close
                    USING circ_lib;

                -- RAISE NOTICE 'initial time: %; dow: %; close: %',initial_time,day_number,hoo_close;

                IF hoo_close = '00:00:00' THEN -- bah ... I guess we'll check the next day
                    day_number := (day_number + 1) % 7;
                    plus_days := plus_days + 1;
                    time_adjusted := TRUE;
                    CONTINUE;
                ELSE
                    has_hoo := TRUE; --We do have hours open sometimes, yay!
                END IF;

                IF hoo_close IS NULL THEN -- no hours of operation ... assume no closing?
                    hoo_close := '23:59:59';
                END IF;

                EXIT;
            END LOOP;

            IF NOT has_hoo THEN -- If always closed then forget the extra days - just determine based on closures.
                plus_days := 0;
            END IF;

            final_time := DATE(final_time::TIMESTAMPTZ + (plus_days || ' days')::INTERVAL)::TEXT;
            IF hoo_close <> '00:00:00' AND hourly THEN -- Not a day-granular circ
                final_time := final_time||' '|| hoo_close;
            ELSE
                final_time := final_time||' 23:59:59';
            END IF;
        END IF;

        --RAISE NOTICE 'final_time: %',final_time;

        -- Loop through other closings
        LOOP 
            SELECT * INTO adjacent FROM actor.org_unit_closed WHERE org_unit = circ_lib AND final_time::TIMESTAMPTZ between close_start AND close_end;
            EXIT WHEN adjacent.id IS NULL;
            time_adjusted := TRUE;
            -- RAISE NOTICE 'recursing for closings with final_time: %',final_time;
            final_time := evergreen.find_next_open_time(circ_lib, adjacent.close_end::TIMESTAMPTZ, hourly, initial_time, has_hoo)::TEXT;
        END LOOP;

        EXIT WHEN breakout > 100;
        EXIT WHEN NOT time_adjusted;

    END LOOP;

    RETURN final_time;
END;
$$ LANGUAGE PLPGSQL;

-- SELECT evergreen.upgrade_deps_block_check('1398', :eg_version);

CREATE OR REPLACE FUNCTION search.symspell_lookup(
    raw_input       TEXT,
    search_class    TEXT,
    verbosity       INT DEFAULT NULL,
    xfer_case       BOOL DEFAULT NULL,
    count_threshold INT DEFAULT NULL,
    soundex_weight  INT DEFAULT NULL,
    pg_trgm_weight  INT DEFAULT NULL,
    kbdist_weight   INT DEFAULT NULL
) RETURNS SETOF search.symspell_lookup_output AS $F$
DECLARE
    prefix_length INT;
    maxED         INT;
    good_suggs  HSTORE;
    word_list   TEXT[];
    edit_list   TEXT[] := '{}';
    seen_list   TEXT[] := '{}';
    output      search.symspell_lookup_output;
    output_list search.symspell_lookup_output[];
    entry       RECORD;
    entry_key   TEXT;
    prefix_key  TEXT;
    sugg        TEXT;
    input       TEXT;
    word        TEXT;
    w_pos       INT := -1;
    smallest_ed INT := -1;
    global_ed   INT;
    c_symspell_suggestion_verbosity INT;
    c_min_suggestion_use_threshold  INT;
    c_soundex_weight                INT;
    c_pg_trgm_weight                INT;
    c_keyboard_distance_weight      INT;
    c_symspell_transfer_case        BOOL;
BEGIN

    SELECT  cmc.min_suggestion_use_threshold,
            cmc.soundex_weight,
            cmc.pg_trgm_weight,
            cmc.keyboard_distance_weight,
            cmc.symspell_transfer_case,
            cmc.symspell_suggestion_verbosity
      INTO  c_min_suggestion_use_threshold,
            c_soundex_weight,
            c_pg_trgm_weight,
            c_keyboard_distance_weight,
            c_symspell_transfer_case,
            c_symspell_suggestion_verbosity
      FROM  config.metabib_class cmc
      WHERE cmc.name = search_class;

    c_min_suggestion_use_threshold := COALESCE(count_threshold,c_min_suggestion_use_threshold);
    c_symspell_transfer_case := COALESCE(xfer_case,c_symspell_transfer_case);
    c_symspell_suggestion_verbosity := COALESCE(verbosity,c_symspell_suggestion_verbosity);
    c_soundex_weight := COALESCE(soundex_weight,c_soundex_weight);
    c_pg_trgm_weight := COALESCE(pg_trgm_weight,c_pg_trgm_weight);
    c_keyboard_distance_weight := COALESCE(kbdist_weight,c_keyboard_distance_weight);

    SELECT value::INT INTO prefix_length FROM config.internal_flag WHERE name = 'symspell.prefix_length' AND enabled;
    prefix_length := COALESCE(prefix_length, 6);

    SELECT value::INT INTO maxED FROM config.internal_flag WHERE name = 'symspell.max_edit_distance' AND enabled;
    maxED := COALESCE(maxED, 3);

    -- XXX This should get some more thought ... maybe search_normalize?
    word_list := ARRAY_AGG(x.word) FROM search.query_parse_positions(raw_input) x;

    -- Common case exact match test for preformance
    IF c_symspell_suggestion_verbosity = 0 AND CARDINALITY(word_list) = 1 AND CHARACTER_LENGTH(word_list[1]) <= prefix_length THEN
        EXECUTE
          'SELECT  '||search_class||'_suggestions AS suggestions,
                   '||search_class||'_count AS count,
                   prefix_key
             FROM  search.symspell_dictionary
             WHERE prefix_key = $1
                   AND '||search_class||'_count >= $2 
                   AND '||search_class||'_suggestions @> ARRAY[$1]' 
          INTO entry USING evergreen.lowercase(word_list[1]), c_min_suggestion_use_threshold;
        IF entry.prefix_key IS NOT NULL THEN
            output.lev_distance := 0; -- definitionally
            output.prefix_key := entry.prefix_key;
            output.prefix_key_count := entry.count;
            output.suggestion_count := entry.count;
            output.input := word_list[1];
            IF c_symspell_transfer_case THEN
                output.suggestion := search.symspell_transfer_casing(output.input, entry.prefix_key);
            ELSE
                output.suggestion := entry.prefix_key;
            END IF;
            output.norm_input := entry.prefix_key;
            output.qwerty_kb_match := 1;
            output.pg_trgm_sim := 1;
            output.soundex_sim := 1;
            RETURN NEXT output;
            RETURN;
        END IF;
    END IF;

    <<word_loop>>
    FOREACH word IN ARRAY word_list LOOP
        w_pos := w_pos + 1;
        input := evergreen.lowercase(word);

        IF CHARACTER_LENGTH(input) > prefix_length THEN
            prefix_key := SUBSTRING(input FROM 1 FOR prefix_length);
            edit_list := ARRAY[input,prefix_key] || search.symspell_generate_edits(prefix_key, 1, maxED);
        ELSE
            edit_list := input || search.symspell_generate_edits(input, 1, maxED);
        END IF;

        SELECT ARRAY_AGG(x ORDER BY CHARACTER_LENGTH(x) DESC) INTO edit_list FROM UNNEST(edit_list) x;

        output_list := '{}';
        seen_list := '{}';
        global_ed := NULL;

        <<entry_key_loop>>
        FOREACH entry_key IN ARRAY edit_list LOOP
            smallest_ed := -1;
            IF global_ed IS NOT NULL THEN
                smallest_ed := global_ed;
            END IF;
            FOR entry IN EXECUTE
                'SELECT  '||search_class||'_suggestions AS suggestions,
                         '||search_class||'_count AS count,
                         prefix_key
                   FROM  search.symspell_dictionary
                   WHERE prefix_key = $1
                         AND '||search_class||'_suggestions IS NOT NULL' 
                USING entry_key
            LOOP

                SELECT  HSTORE(
                            ARRAY_AGG(
                                ARRAY[s, evergreen.levenshtein_damerau_edistance(input,s,maxED)::TEXT]
                                    ORDER BY evergreen.levenshtein_damerau_edistance(input,s,maxED) ASC
                            )
                        )
                  INTO  good_suggs
                  FROM  UNNEST(entry.suggestions) s
                  WHERE (ABS(CHARACTER_LENGTH(s) - CHARACTER_LENGTH(input)) <= maxEd
                        AND evergreen.levenshtein_damerau_edistance(input,s,maxED) BETWEEN 0 AND maxED)
                        AND NOT seen_list @> ARRAY[s];

                CONTINUE WHEN good_suggs IS NULL;

                FOR sugg, output.suggestion_count IN EXECUTE
                    'SELECT  prefix_key, '||search_class||'_count
                       FROM  search.symspell_dictionary
                       WHERE prefix_key = ANY ($1)
                             AND '||search_class||'_count >= $2'
                    USING AKEYS(good_suggs), c_min_suggestion_use_threshold
                LOOP

                    IF NOT seen_list @> ARRAY[sugg] THEN
                        output.lev_distance := good_suggs->sugg;
                        seen_list := seen_list || sugg;

                        -- Track the smallest edit distance among suggestions from this prefix key.
                        IF smallest_ed = -1 OR output.lev_distance < smallest_ed THEN
                            smallest_ed := output.lev_distance;
                        END IF;

                        -- Track the smallest edit distance for all prefix keys for this word.
                        IF global_ed IS NULL OR smallest_ed < global_ed THEN
                            global_ed = smallest_ed;
                        END IF;

                        -- Only proceed if the edit distance is <= the max for the dictionary.
                        IF output.lev_distance <= maxED THEN
                            IF output.lev_distance > global_ed AND c_symspell_suggestion_verbosity <= 1 THEN
                                -- Lev distance is our main similarity measure. While
                                -- trgm or soundex similarity could be the main filter,
                                -- Lev is both language agnostic and faster.
                                --
                                -- Here we will skip suggestions that have a longer edit distance
                                -- than the shortest we've already found. This is simply an
                                -- optimization that allows us to avoid further processing
                                -- of this entry. It would be filtered out later.

                                CONTINUE;
                            END IF;

                            -- If we have an exact match on the suggestion key we can also avoid
                            -- some function calls.
                            IF output.lev_distance = 0 THEN
                                output.qwerty_kb_match := 1;
                                output.pg_trgm_sim := 1;
                                output.soundex_sim := 1;
                            ELSE
                                output.qwerty_kb_match := evergreen.qwerty_keyboard_distance_match(input, sugg);
                                output.pg_trgm_sim := similarity(input, sugg);
                                output.soundex_sim := difference(input, sugg) / 4.0;
                            END IF;

                            -- Fill in some fields
                            IF c_symspell_transfer_case THEN
                                output.suggestion := search.symspell_transfer_casing(word, sugg);
                            ELSE
                                output.suggestion := sugg;
                            END IF;
                            output.prefix_key := entry.prefix_key;
                            output.prefix_key_count := entry.count;
                            output.input := word;
                            output.norm_input := input;
                            output.word_pos := w_pos;

                            -- We can't "cache" a set of generated records directly, so
                            -- here we build up an array of search.symspell_lookup_output
                            -- records that we can revivicate later as a table using UNNEST().
                            output_list := output_list || output;

                            EXIT entry_key_loop WHEN smallest_ed = 0 AND c_symspell_suggestion_verbosity = 0; -- exact match early exit
                            CONTINUE entry_key_loop WHEN smallest_ed = 0 AND c_symspell_suggestion_verbosity = 1; -- exact match early jump to the next key
                        END IF; -- maxED test
                    END IF; -- suggestion not seen test
                END LOOP; -- loop over suggestions
            END LOOP; -- loop over entries
        END LOOP; -- loop over entry_keys

        -- Now we're done examining this word
        IF c_symspell_suggestion_verbosity = 0 THEN
            -- Return the "best" suggestion from the smallest edit
            -- distance group.  We define best based on the weighting
            -- of the non-lev similarity measures and use the suggestion
            -- use count to break ties.
            RETURN QUERY
                SELECT * FROM UNNEST(output_list)
                    ORDER BY lev_distance,
                        (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC
                        LIMIT 1;
        ELSIF c_symspell_suggestion_verbosity = 1 THEN
            -- Return all suggestions from the smallest
            -- edit distance group.
            RETURN QUERY
                SELECT * FROM UNNEST(output_list) WHERE lev_distance = smallest_ed
                    ORDER BY (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC;
        ELSIF c_symspell_suggestion_verbosity = 2 THEN
            -- Return everything we find, along with relevant stats
            RETURN QUERY
                SELECT * FROM UNNEST(output_list)
                    ORDER BY lev_distance,
                        (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC;
        ELSIF c_symspell_suggestion_verbosity = 3 THEN
            -- Return everything we find from the two smallest edit distance groups
            RETURN QUERY
                SELECT * FROM UNNEST(output_list)
                    WHERE lev_distance IN (SELECT DISTINCT lev_distance FROM UNNEST(output_list) ORDER BY 1 LIMIT 2)
                    ORDER BY lev_distance,
                        (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC;
        ELSIF c_symspell_suggestion_verbosity = 4 THEN
            -- Return everything we find from the two smallest edit distance groups that are NOT 0 distance
            RETURN QUERY
                SELECT * FROM UNNEST(output_list)
                    WHERE lev_distance IN (SELECT DISTINCT lev_distance FROM UNNEST(output_list) WHERE lev_distance > 0 ORDER BY 1 LIMIT 2)
                    ORDER BY lev_distance,
                        (soundex_sim * c_soundex_weight)
                            + (pg_trgm_sim * c_pg_trgm_weight)
                            + (qwerty_kb_match * c_keyboard_distance_weight) DESC,
                        suggestion_count DESC;
        END IF;
    END LOOP; -- loop over words
END;
$F$ LANGUAGE PLPGSQL;



-----------------------------------------------------------------------------
-- START INSERT
-----------------------------------------------------------------------------
DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN
-----------------------------------------------------------------------------

PERFORM evergreen.upgrade_deps_block_check('1342', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1343', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1344', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1345', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1346', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1347', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1348', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1349', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1350', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1351', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1352', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1353', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1354', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1355', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1356', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1357', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1358', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1359', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1360', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1361', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1362', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1363', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1364', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1365', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1366', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1367', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1368', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1369', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1370', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1371', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1372', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1373', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1374', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1376', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1377', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1378', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1379', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1382', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1388', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1391', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1398', '3.11-upgrade');

PERFORM evergreen.upgrade_deps_block_check('1329', '3.11-upgrade');
-- already have this one
--PERFORM evergreen.upgrade_deps_block_check('1330', '3.11-upgrade');
-- don't need this one
PERFORM evergreen.upgrade_deps_block_check('1331', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1332', '3.11-upgrade');

-- already have this one
PERFORM evergreen.upgrade_deps_block_check('1333', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1334', '3.11-upgrade');
PERFORM evergreen.upgrade_deps_block_check('1336', '3.11-upgrade');

INSERT INTO config.openathens_uid_field
    (id, name)
VALUES
    (1,'id'),
    (2,'usrname')
;

PERFORM SETVAL('config.openathens_uid_field_id_seq'::TEXT, 100);

INSERT INTO config.openathens_name_field
    (id, name)
VALUES
    (1,'id'),
    (2,'usrname'),
    (3,'fullname')
;

PERFORM SETVAL('config.openathens_name_field_id_seq'::TEXT, 100);

INSERT INTO permission.perm_list ( id, code, description) VALUES 
  ( 639, 'ADMIN_OPENATHENS', oils_i18n_gettext(639,
     'Allow a user to administer OpenAthens authentication service', 'ppl', 'description'));

INSERT into config.org_unit_setting_type
( name, grp, label, description, datatype, fm_class ) VALUES

( 'acq.default_owning_lib_for_auto_lids_strategy', 'acq',
    oils_i18n_gettext('acq.default_owning_lib_for_auto_lids_strategy',
        'How to set default owning library for auto-created line item items',
        'coust', 'label'),
    oils_i18n_gettext('acq.default_owning_lib_for_auto_lids_strategy',
        'Stategy to use to set default owning library to set when line item items are auto-created because the provider''s default copy count has been set. Valid values are "workstation" to use the workstation library, "blank" to leave it blank, and "use_setting" to use the "Default owning library for auto-created line item items" setting. If not set, the workstation library will be used.',
        'coust', 'description'),
    'string', null)
,( 'acq.default_owning_lib_for_auto_lids', 'acq',
    oils_i18n_gettext('acq.default_owning_lib_for_auto_lids',
        'Default owning library for auto-created line item items',
        'coust', 'label'),
    oils_i18n_gettext('acq.default_owning_lib_for_auto_lids',
        'The default owning library to set when line item items are auto-created because the provider''s default copy count has been set. This applies if the "How to set default owning library for auto-created line item items" setting is set to "use_setting".',
        'coust', 'description'),
    'link', 'aou')
;

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.acq.picklist.upload.templates','acq','object',
    oils_i18n_gettext(
        'eg.acq.picklist.upload.templates',
        'Acq Picklist Uploader Templates',
        'cwst','label'
    )
);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'acq.lineitem.sort_order', 'gui', 'integer',
    oils_i18n_gettext(
        'acq.lineitem.sort_order',
        'ACQ Lineitem List Sort Order',
        'cwst', 'label'
    )
);

INSERT INTO config.org_unit_setting_type (name, grp, datatype, label)
VALUES (
    'ui.staff.acq.show_deprecated_links', 'gui', 'bool',
    oils_i18n_gettext(
        'ui.staff.acq.show_deprecated_links',
        'Display Links to Deprecated Acquisitions Interfaces',
        'cwst', 'label'
    )
);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label) 
VALUES (
    'eg.grid.admin.actor.org_unit_settings', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.admin.actor.org_unit_settings',
        'Grid Config: admin.actor.org_unit_settings',
        'cwst', 'label'
    )
);



-- SELECT evergreen.upgrade_deps_block_check('1351', :eg_version);
INSERT INTO permission.perm_list ( id, code, description )
    VALUES (
        641,
        'ADMIN_FUND_ROLLOVER',
        oils_i18n_gettext(
            641,
            'Allow a user to perform fund propagation and rollover',
            'ppl',
            'description'
        )
    );

-- ensure that permission groups that are able to
-- rollover funds can continue to do so
WITH perms_to_add AS
    (SELECT id FROM
    permission.perm_list
    WHERE code IN ('ADMIN_FUND_ROLLOVER'))
INSERT INTO permission.grp_perm_map (grp, perm, depth, grantable)
    SELECT grp, perms_to_add.id as perm, depth, grantable
        FROM perms_to_add,
        permission.grp_perm_map
        
        --- Don't add the permissions if they have already been assigned
        WHERE grp NOT IN
            (SELECT DISTINCT grp FROM permission.grp_perm_map
            INNER JOIN perms_to_add ON perm=perms_to_add.id)
            
        --- Anybody who can view resources should also see reservations
        --- at the same level
        AND perm = (
            SELECT id
                FROM permission.perm_list
                WHERE code = 'ADMIN_FUND'
        );


-- SELECT evergreen.upgrade_deps_block_check('1352', :eg_version);

INSERT into config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.grid.admin.local.cash_reports.desk_payments', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.admin.local.cash_reports.desk_payments',
        'Grid Config: admin.local.cash_reports.desk_payments',
        'cwst', 'label'
    )
), (
    'eg.grid.admin.local.cash_reports.user_payments', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.admin.local.cash_reports.user_payments',
        'Grid Config: admin.local.cash_reports.user_payments',
        'cwst', 'label'
    )
);

-- SELECT evergreen.upgrade_deps_block_check('1361', :eg_version);

INSERT INTO config.global_flag (name, value, enabled, label)
VALUES (
    'opac.max_concurrent_search.query',
    '20',
    TRUE,
    oils_i18n_gettext(
        'opac.max_concurrent_search.query',
        'Limit the number of global concurrent matching search queries',
        'cgf', 'label'
    )
);

INSERT INTO config.global_flag (name, value, enabled, label)
VALUES (
    'opac.max_concurrent_search.ip',
    '0',
    TRUE,
    oils_i18n_gettext(
        'opac.max_concurrent_search.ip',
        'Limit the number of global concurrent searches per client IP address',
        'cgf', 'label'
    )
);

-- SELECT evergreen.upgrade_deps_block_check('1363', :eg_version);
UPDATE action.hold_request_cancel_cause SET manual = TRUE
  WHERE id IN (
    2, -- Hold Shelf expiration
    3, -- Patron via phone
    4, -- Patron in person
    5  -- Staff forced
  );

INSERT INTO action.hold_request_cancel_cause (id, label, manual)
  VALUES (9, oils_i18n_gettext(9, 'Patron via email', 'ahrcc', 'label'), TRUE);

INSERT INTO action.hold_request_cancel_cause (id, label, manual)
  VALUES (10, oils_i18n_gettext(10, 'Patron via SMS', 'ahrcc', 'label'), TRUE);

-- SELECT evergreen.upgrade_deps_block_check('1364', :eg_version);

INSERT INTO permission.perm_list ( id, code, description ) VALUES
 ( 642, 'UPDATE_COPY_BARCODE', oils_i18n_gettext(642,
    'Update the barcode for an item.', 'ppl', 'description'))
;

-- give this perm to perm groups that already have UPDATE_COPY
WITH perms_to_add AS
    (SELECT id FROM
    permission.perm_list
    WHERE code IN ('UPDATE_COPY_BARCODE'))
INSERT INTO permission.grp_perm_map (grp, perm, depth, grantable)
    SELECT grp, perms_to_add.id as perm, depth, grantable
        FROM perms_to_add,
        permission.grp_perm_map

        --- Don't add the permissions if they have already been assigned
        WHERE grp NOT IN
            (SELECT DISTINCT grp FROM permission.grp_perm_map
            INNER JOIN perms_to_add ON perm=perms_to_add.id)

        --- we're going to match the depth of their existing perm
        AND perm = (
            SELECT id
                FROM permission.perm_list
                WHERE code = 'UPDATE_COPY'
        );

-- SELECT evergreen.upgrade_deps_block_check('1369', :eg_version);

INSERT INTO config.global_flag (name, enabled, label) VALUES (
    'ingest.queued.max_threads',  TRUE,
    oils_i18n_gettext(
        'ingest.queued.max_threads',
        'Queued Ingest: Maximum number of database workers allowed for queued ingest processes',
        'cgf',
        'label'
    )),(
    'ingest.queued.abort_on_error',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.abort_on_error',
        'Queued Ingest: Abort transaction on ingest error rather than simply logging an error',
        'cgf',
        'label'
    )),(
    'ingest.queued.authority.propagate',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.authority.propagate',
        'Queued Ingest: Queue all bib record updates on authority change propagation, even if bib queuing is not generally enabled',
        'cgf',
        'label'
    )),(
    'ingest.queued.all',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.all',
        'Queued Ingest: Use Queued Ingest for all bib and authority record ingest',
        'cgf',
        'label'
    )),(
    'ingest.queued.biblio.all',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.biblio.all',
        'Queued Ingest: Use Queued Ingest for all bib record ingest',
        'cgf',
        'label'
    )),(
    'ingest.queued.authority.all',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.authority.all',
        'Queued Ingest: Use Queued Ingest for all authority record ingest',
        'cgf',
        'label'
    )),(
    'ingest.queued.biblio.insert.marc_edit_inline',  TRUE,
    oils_i18n_gettext(
        'ingest.queued.biblio.insert.marc_edit_inline',
        'Queued Ingest: Do NOT use Queued Ingest when creating a new bib, or undeleting a bib, via the MARC editor',
        'cgf',
        'label'
    )),(
    'ingest.queued.biblio.insert',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.biblio.insert',
        'Queued Ingest: Use Queued Ingest for bib record ingest on insert and undelete',
        'cgf',
        'label'
    )),(
    'ingest.queued.authority.insert',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.authority.insert',
        'Queued Ingest: Use Queued Ingest for authority record ingest on insert and undelete',
        'cgf',
        'label'
    )),(
    'ingest.queued.biblio.update.marc_edit_inline',  TRUE,
    oils_i18n_gettext(
        'ingest.queued.biblio.update.marc_edit_inline',
        'Queued Ingest: Do NOT Use Queued Ingest when editing bib records via the MARC Editor',
        'cgf',
        'label'
    )),(
    'ingest.queued.biblio.update',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.biblio.update',
        'Queued Ingest: Use Queued Ingest for bib record ingest on update',
        'cgf',
        'label'
    )),(
    'ingest.queued.authority.update',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.authority.update',
        'Queued Ingest: Use Queued Ingest for authority record ingest on update',
        'cgf',
        'label'
    )),(
    'ingest.queued.biblio.delete',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.biblio.delete',
        'Queued Ingest: Use Queued Ingest for bib record ingest on delete',
        'cgf',
        'label'
    )),(
    'ingest.queued.authority.delete',  FALSE,
    oils_i18n_gettext(
        'ingest.queued.authority.delete',
        'Queued Ingest: Use Queued Ingest for authority record ingest on delete',
        'cgf',
        'label'
    )
);

-- SELECT evergreen.upgrade_deps_block_check('1370', :eg_version);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES
    (
        'eg.orgselect.admin.stat_cat.owner', 'gui', 'integer',
        oils_i18n_gettext(
            'eg.orgselect.admin.stat_cat.owner',
            'Default org unit for stat cat and stat cat entry editors',
            'cwst', 'label'
        )
    ), (
        'eg.orgfamilyselect.admin.item_stat_cat.main_org_selector', 'gui', 'integer',
        oils_i18n_gettext(
            'eg.orgfamilyselect.admin.item_stat_cat.main_org_selector',
            'Default org unit for the main org select in the item stat cat and stat cat entry admin interfaces.',
            'cwst', 'label'
        )
    ), (
        'eg.orgfamilyselect.admin.patron_stat_cat.main_org_selector', 'gui', 'integer',
        oils_i18n_gettext(
            'eg.orgfamilyselect.admin.patron_stat_cat.main_org_selector',
            'Default org unit for the main org select in the patron stat cat and stat cat entry admin interfaces.',
            'cwst', 'label'
        )
    );

-- SELECT evergreen.upgrade_deps_block_check('1371', :eg_version);

INSERT into config.org_unit_setting_type
( name, grp, label, description, datatype, fm_class ) VALUES

    ( 'credit.processor.smartpay.enabled', 'credit',
    oils_i18n_gettext('credit.processor.smartpay.enabled',
        'Enable SmartPAY payments',
        'coust', 'label'),
    oils_i18n_gettext('credit.processor.smartpay.enabled',
        'Enable SmartPAY payments',
        'coust', 'description'),
    'bool', null)

,( 'credit.processor.smartpay.location_id', 'credit',
    oils_i18n_gettext('credit.processor.smartpay.location_id',
        'SmartPAY location ID',
        'coust', 'label'),
    oils_i18n_gettext('credit.processor.smartpay.location_id',
        'SmartPAY location ID")',
        'coust', 'description'),
    'string', null)

,( 'credit.processor.smartpay.customer_id', 'credit',
    oils_i18n_gettext('credit.processor.smartpay.customer_id',
        'SmartPAY customer ID',
        'coust', 'label'),
    oils_i18n_gettext('credit.processor.smartpay.customer_id',
        'SmartPAY customer ID',
        'coust', 'description'),
    'string', null)

,( 'credit.processor.smartpay.login', 'credit',
    oils_i18n_gettext('credit.processor.smartpay.login',
        'SmartPAY login name',
        'coust', 'label'),
    oils_i18n_gettext('credit.processor.smartpay.login',
        'SmartPAY login name',
        'coust', 'description'),
    'string', null)

,( 'credit.processor.smartpay.password', 'credit',
    oils_i18n_gettext('credit.processor.smartpay.password',
        'SmartPAY password',
        'coust', 'label'),
    oils_i18n_gettext('credit.processor.smartpay.password',
        'SmartPAY password',
        'coust', 'description'),
    'string', null)

,( 'credit.processor.smartpay.api_key', 'credit',
    oils_i18n_gettext('credit.processor.smartpay.api_key',
        'SmartPAY API key',
        'coust', 'label'),
    oils_i18n_gettext('credit.processor.smartpay.api_key',
        'SmartPAY API key',
        'coust', 'description'),
    'string', null)

,( 'credit.processor.smartpay.server', 'credit',
    oils_i18n_gettext('credit.processor.smartpay.server',
        'SmartPAY server name',
        'coust', 'label'),
    oils_i18n_gettext('credit.processor.smartpay.server',
        'SmartPAY server name',
        'coust', 'description'),
    'string', null)

,( 'credit.processor.smartpay.port', 'credit',
    oils_i18n_gettext('credit.processor.smartpay.port',
        'SmartPAY server port',
        'coust', 'label'),
    oils_i18n_gettext('credit.processor.smartpay.port',
        'SmartPAY server port',
        'coust', 'description'),
    'string', null)
;

UPDATE config.org_unit_setting_type
SET description = oils_i18n_gettext('credit.processor.default',
        'This might be "AuthorizeNet", "PayPal", "PayflowPro", "SmartPAY", or "Stripe".',
        'coust', 'description')
WHERE name = 'credit.processor.default' AND description = 'This might be "AuthorizeNet", "PayPal", "PayflowPro", or "Stripe".'; -- don't clobber local edits or i18n

UPDATE config.org_unit_setting_type
    SET view_perm = (SELECT id FROM permission.perm_list
        WHERE code = 'VIEW_CREDIT_CARD_PROCESSING' LIMIT 1)
    WHERE name LIKE 'credit.processor.smartpay.%' AND view_perm IS NULL;

UPDATE config.org_unit_setting_type
    SET update_perm = (SELECT id FROM permission.perm_list
        WHERE code = 'ADMIN_CREDIT_CARD_PROCESSING' LIMIT 1)
    WHERE name LIKE 'credit.processor.smartpay.%' AND update_perm IS NULL;


-- SELECT evergreen.upgrade_deps_block_check('1372', :eg_version);

INSERT INTO permission.perm_list (id, code, description) VALUES
 ( 643, 'VIEW_HOLD_PULL_LIST', oils_i18n_gettext(643,
    'View hold pull list', 'ppl', 'description'));

-- by default, assign VIEW_HOLD_PULL_LIST to everyone who has VIEW_HOLDS
INSERT INTO permission.grp_perm_map (perm, grp, depth, grantable)
    SELECT 643, grp, depth, grantable
    FROM permission.grp_perm_map
    WHERE perm = 9;

INSERT INTO permission.usr_perm_map (perm, usr, depth, grantable)
    SELECT 643, usr, depth, grantable
    FROM permission.usr_perm_map
    WHERE perm = 9;

-- SELECT evergreen.upgrade_deps_block_check('1373', :eg_version);

-- 950.data.seed-values.sql

INSERT INTO config.global_flag (name, value, enabled, label)
VALUES (
    'circ.holds.api_require_monographic_part_when_present',
    NULL,
    FALSE,
    oils_i18n_gettext(
        'circ.holds.api_require_monographic_part_when_present',
        'Holds: Require Monographic Part When Present for hold check.',
        'cgf', 'label'
    )
);

INSERT INTO config.org_unit_setting_type (name, label, grp, description, datatype)
VALUES (
    'circ.holds.ui_require_monographic_part_when_present',
    oils_i18n_gettext('circ.holds.ui_require_monographic_part_when_present',
        'Require Monographic Part when Present',
        'coust', 'label'),
    'circ',
    oils_i18n_gettext('circ.holds.ui_require_monographic_part_when_present',
        'Normally the selection of a monographic part during hold placement is optional if there is at least one copy on the bib without a monographic part.  A true value for this setting will require part selection even under this condition.',
        'coust', 'description'),
    'bool'
);

-- SELECT evergreen.upgrade_deps_block_check('1374', :eg_version);

INSERT INTO config.org_unit_setting_type (name, label, grp, description, datatype, fm_class) VALUES
(   'circ.custom_penalty_override.PATRON_EXCEEDS_FINES',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_FINES',
        'Custom PATRON_EXCEEDS_FINES penalty',
        'coust', 'label'),
    'circ',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_FINES',
        'Specifies a non-default standing penalty to apply to patrons that exceed the max-fine threshold for their group.',
        'coust', 'description'),
    'link', 'csp'),
(   'circ.custom_penalty_override.PATRON_EXCEEDS_OVERDUE_COUNT',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_OVERDUE_COUNT',
        'Custom PATRON_EXCEEDS_OVERDUE_COUNT penalty',
        'coust', 'label'),
    'circ',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_OVERDUE_COUNT',
        'Specifies a non-default standing penalty to apply to patrons that exceed the overdue count threshold for their group.',
        'coust', 'description'),
    'link', 'csp'),
(   'circ.custom_penalty_override.PATRON_EXCEEDS_CHECKOUT_COUNT',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_CHECKOUT_COUNT',
        'Custom PATRON_EXCEEDS_CHECKOUT_COUNT penalty',
        'coust', 'label'),
    'circ',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_CHECKOUT_COUNT',
        'Specifies a non-default standing penalty to apply to patrons that exceed the checkout count threshold for their group.',
        'coust', 'description'),
    'link', 'csp'),
(   'circ.custom_penalty_override.PATRON_EXCEEDS_COLLECTIONS_WARNING',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_COLLECTIONS_WARNING',
        'Custom PATRON_EXCEEDS_COLLECTIONS_WARNING penalty',
        'coust', 'label'),
    'circ',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_COLLECTIONS_WARNING',
        'Specifies a non-default standing penalty to apply to patrons that exceed the collections fine warning threshold for their group.',
        'coust', 'description'),
    'link', 'csp'),
(   'circ.custom_penalty_override.PATRON_EXCEEDS_LOST_COUNT',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_LOST_COUNT',
        'Custom PATRON_EXCEEDS_LOST_COUNT penalty',
        'coust', 'label'),
    'circ',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_LOST_COUNT',
        'Specifies a non-default standing penalty to apply to patrons that exceed the lost item count threshold for their group.',
        'coust', 'description'),
    'link', 'csp'),
(   'circ.custom_penalty_override.PATRON_EXCEEDS_LONGOVERDUE_COUNT',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_LONGOVERDUE_COUNT',
        'Custom PATRON_EXCEEDS_LONGOVERDUE_COUNT penalty',
        'coust', 'label'),
    'circ',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_EXCEEDS_LONGOVERDUE_COUNT',
        'Specifies a non-default standing penalty to apply to patrons that exceed the long-overdue item count threshold for their group.',
        'coust', 'description'),
    'link', 'csp'),
(   'circ.custom_penalty_override.PATRON_IN_COLLECTIONS',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_IN_COLLECTIONS',
        'Custom PATRON_IN_COLLECTIONS penalty',
        'coust', 'label'),
    'circ',
    oils_i18n_gettext('circ.custom_penalty_override.PATRON_IN_COLLECTIONS',
        'Specifies a non-default standing penalty that may have been applied to patrons that have been placed into collections and that should be automatically removed if they have paid down their balance below the threshold for their group. Use of this feature will likely require configuration and coordination with an external collection agency.',
        'coust', 'description'),
    'link', 'csp')
;

-- SELECT evergreen.upgrade_deps_block_check('1376', :eg_version);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
SELECT
    'eg.staffcat.exclude_electronic', 'gui', 'bool',
    oils_i18n_gettext(
        'eg.staffcat.exclude_electronic',
        'Staff Catalog "Exclude Electronic Resources" Option',
        'cwst', 'label'
    )
WHERE NOT EXISTS (
    SELECT 1
    FROM config.workstation_setting_type
    WHERE name = 'eg.staffcat.exclude_electronic'
);

-- 1238

INSERT INTO permission.perm_list ( id, code, description ) SELECT
 625, 'VIEW_BOOKING_RESERVATION', oils_i18n_gettext(625,
    'View booking reservations', 'ppl', 'description')
WHERE NOT EXISTS (
    SELECT 1
    FROM permission.perm_list
    WHERE id = 625
    AND   code = 'VIEW_BOOKING_RESERVATION'
);

INSERT INTO permission.perm_list ( id, code, description ) SELECT
 626, 'VIEW_BOOKING_RESERVATION_ATTR_MAP', oils_i18n_gettext(626,
    'View booking reservation attribute maps', 'ppl', 'description')
WHERE NOT EXISTS (
    SELECT 1
    FROM permission.perm_list
    WHERE id = 626
    AND   code = 'VIEW_BOOKING_RESERVATION_ATTR_MAP'
);

-- reprise 1269 just in case now that the perms should definitely exist

WITH perms_to_add AS
    (SELECT id FROM
    permission.perm_list
    WHERE code IN ('VIEW_BOOKING_RESERVATION', 'VIEW_BOOKING_RESERVATION_ATTR_MAP'))

INSERT INTO permission.grp_perm_map (grp, perm, depth, grantable)
    SELECT grp, perms_to_add.id as perm, depth, grantable
        FROM perms_to_add,
        permission.grp_perm_map
        
        --- Don't add the permissions if they have already been assigned
        WHERE grp NOT IN
            (SELECT DISTINCT grp FROM permission.grp_perm_map
            INNER JOIN perms_to_add ON perm=perms_to_add.id)
            
        --- Anybody who can view resources should also see reservations
        --- at the same level
        AND perm = (
            SELECT id
                FROM permission.perm_list
                WHERE code = 'VIEW_BOOKING_RESOURCE'
        );

-- 1239

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
SELECT
    'eg.grid.booking.pull_list', 'gui', 'object',
    oils_i18n_gettext(
        'booking.pull_list',
        'Grid Config: Booking Pull List',
        'cwst', 'label')
WHERE NOT EXISTS (
    SELECT 1
    FROM config.workstation_setting_type
    WHERE name = 'eg.grid.booking.pull_list'
);

-- 1240

INSERT INTO action_trigger.event_params (event_def, param, value)
SELECT id, 'check_sms_notify', 1
FROM action_trigger.event_definition
WHERE reactor = 'SendSMS'
AND validator IN ('HoldIsAvailable', 'HoldIsCancelled', 'HoldNotifyCheck')
AND NOT EXISTS (
    SELECT * FROM action_trigger.event_params
    WHERE param = 'check_sms_notify'
);

-- SELECT evergreen.upgrade_deps_block_check('1377', :eg_version);

-- 950.data.seed-values.sql

INSERT INTO config.global_flag (name, value, enabled, label)
VALUES (
    'opac.login_redirect_domains',
    '',
    TRUE,
    oils_i18n_gettext(
        'opac.login_redirect_domains',
        'Restrict post-login redirection to local URLs, or those that match the supplied comma-separated list of foreign domains or host names.',
        'cgf', 'label'
    )
);


-- SKIPPING
-- SELECT evergreen.upgrade_deps_block_check('1388', :eg_version);

-----------------------------------------------------------------------------
END IF; END $INSERT$;
-----------------------------------------------------------------------------

COMMIT;
--ROLLBACK;

SELECT 'Analyzing hold_req', CLOCK_TIMESTAMP();

ANALYZE action.hold_request;

SELECT 'Update Complete', CLOCK_TIMESTAMP();
