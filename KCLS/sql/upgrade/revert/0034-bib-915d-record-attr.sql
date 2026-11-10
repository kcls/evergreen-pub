-- Revert kcls-evergreen:0034-bib-915d-record-attr from pg

BEGIN;

-- Not ON DELETE CASCADE, so these must go before the attr definition.
DELETE FROM metabib.uncontrolled_record_attr_value WHERE attr = 'marc_915d';

-- Cascades to config.record_attr_index_norm_map and metabib.record_sorter.
DELETE FROM config.record_attr_definition WHERE name = 'marc_915d';

DELETE FROM config.index_normalizer WHERE func = 'iso_date_normalizer';

DROP FUNCTION public.iso_date_normalizer(TEXT);

COMMIT;
