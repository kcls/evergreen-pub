-- Deploy kcls-evergreen:XXXX-eg-3.14-upgrade to pg
-- requires: 0019-pr-filters

SELECT CLOCK_TIMESTAMP(), 'Starting 3.14 upgrade';

BEGIN;

-- SELECT evergreen.upgrade_deps_block_check('1399', :eg_version);

ALTER TABLE asset.copy_template DROP CONSTRAINT valid_fine_level;
ALTER TABLE asset.copy_template ADD CONSTRAINT valid_fine_level
      CHECK (fine_level IS NULL OR fine_level IN (1,2,3));

--SELECT evergreen.upgrade_deps_block_check('1405', :eg_version);

SELECT CLOCK_TIMESTAMP(), 'Adding hold canceled by fields';

ALTER TABLE action.hold_request 
ADD COLUMN canceled_by INT REFERENCES actor.usr (id) DEFERRABLE INITIALLY DEFERRED,
ADD COLUMN canceling_ws INT REFERENCES actor.workstation (id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX hold_request_canceled_by_idx ON action.hold_request (canceled_by);
CREATE INDEX hold_request_canceling_ws_idx ON action.hold_request (canceling_ws);

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
    UPDATE action.hold_request SET canceled_by = dest_usr WHERE canceled_by = src_usr;
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
	UPDATE action.hold_request SET canceled_by = dest_usr WHERE canceled_by = src_usr;
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


-- SELECT evergreen.upgrade_deps_block_check('1408', :eg_version);

CREATE TABLE vandelay.background_import (
    id              SERIAL      PRIMARY KEY,
    owner           INT         NOT NULL REFERENCES actor.usr (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    workstation     INT         REFERENCES actor.workstation (id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    import_type     TEXT        NOT NULL DEFAULT 'bib' CHECK (import_type IN ('bib','acq','authority')),
    params          TEXT,
    email           TEXT,
    state           TEXT        NOT NULL DEFAULT 'new' CHECK (state IN ('new','running','complete')),
    request_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    complete_time   TIMESTAMPTZ,
    queue           BIGINT      -- no fkey, could be either bib_queue or authority_queue, based on import_type
);

--SELECT evergreen.upgrade_deps_block_check('1417', :eg_version);

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
        IF qe.record_type = 'biblio' THEN
            PERFORM reporter.simple_rec_update(qe.record, qe.action = 'delete');
        END IF;
        UPDATE action.ingest_queue_entry SET ingest_time = NOW() WHERE id = qe.id;
    END IF;

    RETURN ingest_success;
END;
$func$ LANGUAGE PLPGSQL;



------------------------------------------------------------------------------
DO $INSERT$ BEGIN IF evergreen.insert_on_deploy() THEN
------------------------------------------------------------------------------

SELECT evergreen.upgrade_deps_block_check('1399', :eg_version);

SELECT evergreen.upgrade_deps_block_check('1400', :eg_version);

INSERT into config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.grid.admin.local.actor.stat_cat_entry', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.admin.local.actor.stat_cat_entry',
        'Grid Config: admin.local.actor.stat_cat_entry',
        'cwst', 'label'
    )
), (
    'eg.grid.admin.local.asset.stat_cat_entry', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.admin.local.asset.stat_cat_entry',
        'Grid Config: admin.local.asset.stat_cat_entry',
        'cwst', 'label'
    )
);

SELECT evergreen.upgrade_deps_block_check('1401', :eg_version);

INSERT INTO permission.perm_list ( id, code, description ) SELECT DISTINCT
  648,
  'ADMIN_BIB_BUCKET',
  oils_i18n_gettext(648,
    'Administer bibliographic record buckets', 'ppl', 'description'
  )
  FROM permission.perm_list
  WHERE NOT EXISTS (SELECT 1 FROM permission.perm_list WHERE code = 'ADMIN_BIB_BUCKET');
 
INSERT INTO permission.perm_list ( id, code, description )  SELECT DISTINCT
  649,
  'CREATE_BIB_BUCKET',
  oils_i18n_gettext(649,
    'Create bibliographic record buckets', 'ppl', 'description'
  )
  FROM permission.perm_list
  WHERE NOT EXISTS (SELECT 1 FROM permission.perm_list WHERE code = 'CREATE_BIB_BUCKET');

SELECT evergreen.upgrade_deps_block_check('1402', :eg_version);

INSERT INTO config.org_unit_setting_type (
  name, grp, label, description, datatype
) VALUES (
  'cat.patron_view_discovery_layer_url',
  'cat',
  oils_i18n_gettext(
    'cat.patron_view_discovery_layer_url',
    'Patron view discovery layer URL',
    'coust',
    'label'
  ),
  oils_i18n_gettext(
    'cat.patron_view_discovery_layer_url',
    'URL for displaying an item in the "patron view" discovery layer with a placeholder for the bib record ID: {eg_record_id}. For example: https://example.com/Record/{eg_record_id}',
    'coust',
    'description'
  ),
  'string'
);


SELECT evergreen.upgrade_deps_block_check('1403', :eg_version);

UPDATE action_trigger.event_definition SET template = 

$$
[%-
# target is the book list itself. The 'items' variable does not need to be in
# the environment because a special reactor will take care of filling it in.

FOR item IN items;
    bibxml = helpers.unapi_bre(item.target_biblio_record_entry, {flesh => '{mra}'});
    title = "";
    FOR part IN bibxml.findnodes('//*[@tag="245"]/*[@code="a" or @code="b" or @code="n" or @code="p"]');
        title = title _ part.textContent;
    END;
    author = bibxml.findnodes('//*[@tag="100"]/*[@code="a"]').textContent;
    item_type = bibxml.findnodes('//*[local-name()="attributes"]/*[local-name()="field"][@name="item_type"]').getAttribute('coded-value');
    pub_date = "";
    FOR pdatum IN bibxml.findnodes('//*[@tag="260"]/*[@code="c"]');
        IF pub_date ;
            pub_date = pub_date _ ", " _ pdatum.textContent;
        ELSE ;
            pub_date = pdatum.textContent;
        END;
    END;
    helpers.csv_datum(title) %],[% helpers.csv_datum(author) %],[% helpers.csv_datum(pub_date) %],[% helpers.csv_datum(item_type) %],[% FOR note IN item.notes; helpers.csv_datum(note.note); ","; END; "\n";
END -%]
$$

WHERE hook = 'container.biblio_record_entry_bucket.csv' AND MD5(template) = '386d7ab2a78a69a44a47e2b0b8c5699b';

SELECT evergreen.upgrade_deps_block_check('1404', :eg_version);

UPDATE config.org_unit_setting_type
SET description = oils_i18n_gettext('acq.default_owning_lib_for_auto_lids_strategy',
        'Strategy to use when setting the default owning library for line item items that are auto-created due to the provider''s default copy count being set. Valid values are "workstation" to use the workstation library, "blank" to leave it blank, and "use_setting" to use the "Default owning library for auto-created line item items" setting. If not set, the workstation library will be used.',
        'coust', 'description')
WHERE name = 'acq.default_owning_lib_for_auto_lids_strategy'
AND description = 'Stategy to use to set default owning library to set when line item items are auto-created because the provider''s default copy count has been set. Valid values are "workstation" to use the workstation library, "blank" to leave it blank, and "use_setting" to use the "Default owning library for auto-created line item items" setting. If not set, the workstation library will be used.';

SELECT evergreen.upgrade_deps_block_check('1405', :eg_version);

SELECT evergreen.upgrade_deps_block_check('1406', :eg_version);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label) 
VALUES (
    'eg.grid.admin.config.circ_matrix_matchpoint', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.admin.config.circ_matrix_matchpoint',
        'Grid Config: admin.config.circ_matrix_matchpoint',
        'cwst', 'label'
    )
);

SELECT evergreen.upgrade_deps_block_check('1406', :eg_version);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label) 
VALUES (
    'eg.grid.admin.config.circ_matrix_matchpoint', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.admin.config.circ_matrix_matchpoint',
        'Grid Config: admin.config.circ_matrix_matchpoint',
        'cwst', 'label'
    )
);

SELECT evergreen.upgrade_deps_block_check('1407', :eg_version);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES 
(
    'acq.lineitem.sort_order.claims', 'gui', 'integer',
    oils_i18n_gettext(
        'acq.lineitem.sort_order.claims',
        'ACQ Claim-Ready Lineitem List Sort Order',
        'cwst', 'label')
),
(
    'acq.lineitem.page_size.claims', 'gui', 'integer',
    oils_i18n_gettext(
        'acq.lineitem.page_size.claims',
        'ACQ Claim-Ready Lineitem List Page Size',
        'cwst', 'label')
),
(
    'eg.acq.search.lineitems.filter_to_invoiceable', 'gui', 'bool',
    oils_i18n_gettext(
        'eg.acq.search.lineitems.filter_to_invoiceable',
        'ACQ Lineitem Search Filter to Invoiceable',
        'cwst', 'label')
),
(
    'eg.acq.search.lineitems.keep_results', 'gui', 'bool',
    oils_i18n_gettext(
        'eg.acq.search.lineitems.keep_results',
        'ACQ Lineitem Search Keep Results Between Searches',
        'cwst', 'label')
),
(
    'eg.acq.search.lineitems.trim_list', 'gui', 'bool',
    oils_i18n_gettext(
        'eg.acq.search.lineitems.trim_list',
        'ACQ Lineitem Search Trim List When Keeping Results',
        'cwst', 'label')
);

INSERT INTO permission.perm_list ( id, code, description ) VALUES
 ( 650, 'ACQ_ALLOW_OVERSPEND', oils_i18n_gettext(650,
    'Allow a user to ignore a fund''s stop percentage.', 'ppl', 'description'))
;

SELECT evergreen.upgrade_deps_block_check('1408', :eg_version);

INSERT INTO config.usr_setting_type (name, grp, datatype, label)
VALUES
(
    'eg.cat.z3950.default_field', 'gui', 'string',
    oils_i18n_gettext(
        'eg.cat.z3950.default_field',
        'Z39.50 Search default field',
        'cust', 'label')
),(
    'eg.cat.z3950.default_targets', 'gui', 'object',
    oils_i18n_gettext(
        'eg.cat.z3950.default_targets',
        'Z39.50 Search default targets',
        'cust', 'label')
);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES
(
    'eg.grid.global_z3950.search_results', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.global_z3950.search_results',
        'Grid Config: Z39.50 Search Results',
        'cwst', 'label')
),(
    'acq.default_bib_marc_template', 'gui', 'integer',
    oils_i18n_gettext(
        'acq.default_bib_marc_template',
        'Default ACQ Brief Record Bibliographic Template',
        'cwst', 'label')
),(
    'eg.grid.cat.vandelay.queue.list.acq', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.cat.vandelay.queue.list.acq',
        'Grid Config: Vandelay ACQ Queue List',
        'cwst', 'label'
    )
),(
    'eg.grid.cat.vandelay.background-import.list', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.cat.vandelay.background-import.list',
        'Grid Config: Vandelay Background Import List',
        'cwst', 'label'
    )
);

INSERT into config.org_unit_setting_type
    (name, datatype, grp, label, description)
VALUES (
    'acq.import_tab_display', 'string', 'gui',
    oils_i18n_gettext(
        'acq.import_tab_display',
        'ACQ: Which import tab(s) display in general Import/Export?',
        'coust', 'label'
    ),
    oils_i18n_gettext(
        'acq.import_tab_display',
        'Valid values are: "cat" for Import for Cataloging, '
        || '"acq" for Import for Acquisitions, "both" or unset to display both.',
        'coust', 'description'
    )
);

INSERT INTO permission.perm_list ( id, code, description ) VALUES
 ( 651, 'VIEW_BACKGROUND_IMPORT', oils_i18n_gettext(651,
                    'View background record import jobs', 'ppl', 'description')),
 ( 652, 'CREATE_BACKGROUND_IMPORT', oils_i18n_gettext(652,
                    'Create background record import jobs', 'ppl', 'description')),
 ( 653, 'UPDATE_BACKGROUND_IMPORT', oils_i18n_gettext(653,
                    'Update background record import jobs', 'ppl', 'description'))
;

INSERT INTO action_trigger.hook (key, core_type, passive, description) VALUES
(  'vandelay.background_import.requested', 'vbi', TRUE,
   oils_i18n_gettext('vandelay.background_import.requested','A Import/Overlay background job was requested','ath', 'description')
),('vandelay.background_import.completed', 'vbi', TRUE,
   oils_i18n_gettext('vandelay.background_import.completed','A Import/Overlay background job was completed','ath', 'description')
);

INSERT INTO action_trigger.event_definition (active, owner, name, hook, validator, reactor, group_field, usr_field, template)
    VALUES ('f', 1, 'Vandelay Background Import Requested', 'vandelay.background_import.requested', 'NOOP_True', 'SendEmail', 'email', 'owner',
$$
[%- USE date -%]
[%- hostname = '' # set this in order to generate a link -%]
To: [%- target.0.email || params.recipient_email %]
From: [%- params.sender_email || default_sender %]
Date: [%- date.format(date.now, '%a, %d %b %Y %T -0000', gmt => 1) %]
Subject: Background Import Requested
Auto-Submitted: auto-generated

[% target.size %] new background import requests were added:

[% FOR bi IN target %]
    [%- IF bi.queue; summary = helpers.fetch_vbi_queue_summary(bi)%]
  * Queue: [% summary.queue.name %] ([% bi.import_type %])
    Records in queue: [% summary.total %]
    Items in queue: [% summary.total_items %]
     [% IF bi.state != 'new' %]
     - Records imported: [% summary.imported %]
     - Items imported: [% summary.total_items_imported %]
     - Records import errors: [% summary.rec_import_errors %]
     - Items import errors: [% summary.item_import_errors %]
     [% END %]
    [% END %]
  [% IF hostname %]View queue at: https://[% hostname %]/eg2/staff/cat/vandelay/queue/[% bi.import_type %]/[% bi.queue %][% END %]

[% END %]

[% IF hostname %]Manage background imports at: https://[% hostname %]/eg2/staff/cat/vandelay/background-import[% END %]

$$);

INSERT INTO action_trigger.event_definition (active, owner, name, hook, validator, reactor, group_field, usr_field, template)
    VALUES ('f', 1, 'Vandelay Background Import Completed', 'vandelay.background_import.completed', 'NOOP_True', 'SendEmail', 'email', 'owner',
$$
[%- USE date -%]
[%- hostname = '' # set this in order to generate a link -%]
To: [%- target.0.email || params.recipient_email %]
From: [%- params.sender_email || default_sender %]
Date: [%- date.format(date.now, '%a, %d %b %Y %T -0000', gmt => 1) %]
Subject: Background Import Completed
Auto-Submitted: auto-generated

[% target.size %] new background import requests were completed:

[% FOR bi IN target %]
    [%- summary = helpers.fetch_vbi_queue_summary(bi) -%]
  * Queue: [% summary.queue.name %] ([% bi.import_type %])
    Records in queue: [% summary.total %]
    Items in queue: [% summary.total_items %]
     - Records imported: [% summary.imported %]
     - Items imported: [% summary.total_items_imported %]
     - Records import errors: [% summary.rec_import_errors %]
     - Items import errors: [% summary.item_import_errors %]
  [% IF hostname %]View queue at: https://[% hostname %]/eg2/staff/cat/vandelay/queue/[% bi.import_type %]/[% bi.queue %][% END %]

[% END %]

[% IF hostname %]Manage background imports at: https://[% hostname %]/eg2/staff/cat/vandelay/background-import[% END %]

$$);

SELECT evergreen.upgrade_deps_block_check('1409', :eg_version);

INSERT INTO config.global_flag (name, enabled, label)
    VALUES (
        'staff.search.shelving_location_groups_with_lassos', TRUE,
        oils_i18n_gettext(
            'staff.search.shelving_location_groups_with_lassos',
            'Staff Catalog Search: Display shelving location groups with library groups',
            'cgf',
            'label'
        )
);

SELECT evergreen.upgrade_deps_block_check('1410', :eg_version);

INSERT INTO config.org_unit_setting_type (
  name, grp, label, description, datatype
) VALUES (
  'ui.patron.edit.aus.default_phone.regex',
  'gui',
  oils_i18n_gettext(
    'ui.patron.edit.aus.default_phone.regex',
    'Regex for default_phone field on patron registration',
    'coust',
    'label'
  ),
  oils_i18n_gettext(
    'ui.patron.edit.aus.default_phone.regex',
    'The Regular Expression for validation on the default_phone field in patron registration.',
    'coust',
    'description'
  ),
  'string'
), (
  'ui.patron.edit.aus.default_phone.example',
  'gui',
  oils_i18n_gettext(
    'ui.patron.edit.aus.default_phone.example',
    'Example for default_phone field on patron registration',
    'coust',
    'label'
  ),
  oils_i18n_gettext(
    'ui.patron.edit.aus.default_phone.example',
    'The Example for validation on the default_phone field in patron registration.',
    'coust',
    'description'
  ),
  'string'
), (
  'ui.patron.edit.aus.default_sms_notify.regex',
  'gui',
  oils_i18n_gettext(
    'ui.patron.edit.aus.default_sms_notify.regex',
    'Regex for default_sms_notify field on patron registration',
    'coust',
    'label'
  ),
  oils_i18n_gettext(
    'ui.patron.edit.aus.default_sms_notify.regex',
    'The Regular Expression for validation on the default_sms_notify field in patron registration.',
    'coust',
    'description'
  ),
  'string'
), (
  'ui.patron.edit.aus.default_sms_notify.example',
  'gui',
  oils_i18n_gettext(
    'ui.patron.edit.aus.default_sms_notify.example',
    'Example for default_sms_notify field on patron registration',
    'coust',
    'label'
  ),
  oils_i18n_gettext(
    'ui.patron.edit.aus.default_sms_notify.example',
    'The Example for validation on the default_sms_notify field in patron registration.',
    'coust',
    'description'
  ),
  'string'
);

SELECT evergreen.upgrade_deps_block_check('1411', :eg_version);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.grid.reporter.full.outputs.pending', 'gui', 'object', 
    oils_i18n_gettext( 'eg.grid.reporter.full.outputs.pending', 'Pending report output grid settings', 'cwst', 'label')
), (
    'eg.grid.reporter.full.outputs.complete', 'gui', 'object', 
    oils_i18n_gettext( 'eg.grid.reporter.full.outputs.complete', 'Completed report output grid settings', 'cwst', 'label')
), (
    'eg.grid.reporter.full.templates', 'gui', 'object', 
    oils_i18n_gettext( 'eg.grid.reporter.full.templates', 'Report template grid settings', 'cwst', 'label')
), (
    'eg.grid.reporter.full.reports', 'gui', 'object', 
    oils_i18n_gettext( 'eg.grid.reporter.full.reports', 'Report definition grid settings', 'cwst', 'label')
);

UPDATE  config.ui_staff_portal_page_entry
  SET   target_url = '/eg2/staff/reporter/full'
  WHERE id = 12
        AND entry_type = 'menuitem'
        AND target_url = '/eg/staff/reporter/legacy/main'
;


-- SIP stuff we already have
SELECT evergreen.upgrade_deps_block_check('1412', :eg_version);
SELECT evergreen.upgrade_deps_block_check('1413', :eg_version);

SELECT evergreen.upgrade_deps_block_check('1414', :eg_version);

INSERT INTO permission.perm_list ( id, code, description ) SELECT DISTINCT
  654,
  'VIEW_SHIPMENT_NOTIFICATION',
  oils_i18n_gettext(654,
    'View shipment notifications', 'ppl', 'description'
  )
  FROM permission.perm_list
  WHERE NOT EXISTS (SELECT 1 FROM permission.perm_list WHERE code = 'VIEW_SHIPMENT_NOTIFICATION');
 
INSERT INTO permission.perm_list ( id, code, description )  SELECT DISTINCT
  655,
  'MANAGE_SHIPMENT_NOTIFICATION',
  oils_i18n_gettext(655,
    'Manage shipment notifications', 'ppl', 'description'
  )
  FROM permission.perm_list
  WHERE NOT EXISTS (SELECT 1 FROM permission.perm_list WHERE code = 'MANAGE_SHIPMENT_NOTIFICATION');

SELECT evergreen.upgrade_deps_block_check('1415', :eg_version);
INSERT INTO permission.perm_list ( id, code, description ) SELECT DISTINCT
   656,
   'PATRON_BARRED.override',
   oils_i18n_gettext(656,
     'Override the PATRON_BARRED event', 'ppl', 'description'
   )
   FROM permission.perm_list
   WHERE NOT EXISTS (SELECT 1 FROM permission.perm_list WHERE code = 'PATRON_BARRED.override');


SELECT evergreen.upgrade_deps_block_check('1417', :eg_version);

SELECT evergreen.upgrade_deps_block_check('1418', :eg_version);

INSERT INTO config.global_flag (name, enabled, value, label) 
    VALUES (
        'search.max_suggestion_search_terms',
        TRUE,
        3,
        oils_i18n_gettext(
            'search.max_suggestion_search_terms',
            'Limit suggestion generation to searches with this many terms or less',
            'cgf',
            'label'
        )
    );

COMMIT;

SELECT evergreen.upgrade_deps_block_check('1419', :eg_version);

INSERT INTO config.usr_setting_type (name,grp,opac_visible,label,description,datatype) VALUES (
    'ui.show_search_highlight',
    'gui',
    TRUE,
    oils_i18n_gettext(
        'ui.show_search_highlight',
        'Search Highlight',
        'cust',
        'label'
    ),
    oils_i18n_gettext(
        'ui.show_search_highlight',
        'A toggle deciding whether to highlight strings in a keyword search result matching the searched term(s)',
        'cust',
        'description'
    ),
    'bool'
);

SELECT evergreen.upgrade_deps_block_check('1420', :eg_version);

INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.search.sort_order', 'gui', 'string',
    oils_i18n_gettext(
        'eg.search.sort_order',
        'Default sort order upon first opening a catalog search',
        'cwst', 'label'
    )
), 
(
    'eg.search.available_only', 'gui', 'bool',
    oils_i18n_gettext(
        'eg.search.available_only',
        'Whether to search for only bibs with available items upon first opening a catalog search',
        'cwst', 'label'
    )
),
(
    'eg.search.group_formats', 'gui', 'bool',
    oils_i18n_gettext(
        'eg.search.group_formats',
        'Whether to group formats/editions upon first opening a catalog search',
        'cwst', 'label'
    )
);
------------------------------------------------------------------------------
END IF; END $INSERT$;
------------------------------------------------------------------------------

SELECT CLOCK_TIMESTAMP(), 'INSERTS complete';

ROLLBACK;
--COMMIT;
