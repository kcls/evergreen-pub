-- Deploy kcls-evergreen:0034-drop-xml2 to pg
-- requires: 0033-ecard-welcome-emails
--
-- Remove all dependence on the contrib/xml2 ("pgxml") extension ahead of
-- the PG 14 -> 17 upgrade, so the extension can be dropped on PG 14
-- before pg_upgrade runs.
--
-- Everything else in the schema already goes through the native XPATH()
-- wrappers (evergreen.oils_xpath*) or the plperlu evergreen.oils_xslt_process().
-- Only two functions still call xml2's xslt_process() directly, and one
-- trigger function resolves to a legacy pgxml copy of xml_is_well_formed().
--
-- NOTE: must run as a superuser, e.g.
--     sqitch deploy --db-user postgres
-- The extension and the legacy public.* pgxml functions are owned by postgres.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. evergreen.xml_pretty_print(): xslt_process() -> oils_xslt_process()
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION evergreen.xml_pretty_print(input XML)
    RETURNS XML
    LANGUAGE SQL AS
$func$
SELECT evergreen.oils_xslt_process($1::text,
$$<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" 
    version="1.0">
   <xsl:output method="xml" omit-xml-declaration="yes" indent="yes"/>
   <xsl:strip-space elements="*"/>
   <xsl:template match="@*|node()">
     <xsl:copy>
       <xsl:apply-templates select="@*|node()"/>
     </xsl:copy>
   </xsl:template>
 </xsl:stylesheet>
$$::text)::XML
$func$;

COMMENT ON FUNCTION evergreen.xml_pretty_print(input XML) IS
'Simple pretty printer for XML, as written by Andrew Dunstan at http://goo.gl/zBHIk';

-- ---------------------------------------------------------------------
-- 2. evergreen.marc_to(): xslt_process() -> oils_xslt_process()
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION evergreen.marc_to (marc text, xfrm text) RETURNS TEXT AS $$
    SELECT evergreen.xml_pretty_print(evergreen.oils_xslt_process($1, xslt)::XML)::TEXT
      FROM config.xml_transform WHERE name = $2;
$$ LANGUAGE SQL;

-- ---------------------------------------------------------------------
-- 3. biblio.check_marcxml_well_formed()
--
-- The unqualified xml_is_well_formed(NEW.marc) currently resolves (via
-- search_path evergreen, public, pg_catalog) to the legacy
-- public.xml_is_well_formed(), a pgxml C function that parses the input
-- as a *document*.  Once that is dropped the call would silently fall
-- through to pg_catalog.xml_is_well_formed(), which honors the xmloption
-- GUC (default 'content') and is more permissive.  Pin it to the
-- document-mode core function so behaviour stays the same.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION biblio.check_marcxml_well_formed () RETURNS TRIGGER AS $func$
BEGIN

    IF pg_catalog.xml_is_well_formed_document(NEW.marc) THEN
        RETURN NEW;
    ELSE
        RAISE EXCEPTION 'Attempted to % MARCXML that is not well formed', TG_OP;
    END IF;
    
END;
$func$ LANGUAGE PLPGSQL;

-- ---------------------------------------------------------------------
-- 4. Guard: abort if any *other* function body on this database (including
--    ad-hoc functions that only exist on the live DB) still calls an xml2
--    function.  SQL/plpgsql bodies are not tracked in pg_depend, so
--    DROP EXTENSION would otherwise succeed and leave them broken.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    offenders TEXT;
BEGIN
    SELECT string_agg(p.oid::regprocedure::text, ', ')
      INTO offenders
      FROM pg_proc p
     WHERE p.proname NOT IN (
               'xml_valid', 'xml_encode_special_chars', 'xpath_string',
               'xpath_nodeset', 'xpath_number', 'xpath_bool', 'xpath_list',
               'xpath_table', 'xslt_process'
           )
       AND p.prosrc ~* '\m(xml_valid|xml_encode_special_chars|xpath_string|xpath_nodeset|xpath_number|xpath_bool|xpath_list|xpath_table|xslt_process)\s*\(';

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION 'Refusing to drop xml2: these functions still reference it: %', offenders;
    END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 5. Drop the extension (installed WITH SCHEMA evergreen).
--    No CASCADE on purpose: if a view/index/default depends on an
--    extension member this will fail and roll back.
-- ---------------------------------------------------------------------
DROP EXTENSION IF EXISTS xml2;

-- ---------------------------------------------------------------------
-- 6. Drop the legacy pre-9.1 contrib/xml2 functions that live loose in
--    public (owned by postgres, not extension members; they were carried
--    forward by earlier pg_upgrades).  pg_upgrade checks every probin
--    library, so these would require pgxml.so on the PG 17 cluster too.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.xml_encode_special_chars(text);
DROP FUNCTION IF EXISTS public.xml_is_well_formed(text);
DROP FUNCTION IF EXISTS public.xml_valid(text);
DROP FUNCTION IF EXISTS public.xpath_bool(text, text);
DROP FUNCTION IF EXISTS public.xpath_list(text, text);
DROP FUNCTION IF EXISTS public.xpath_list(text, text, text);
DROP FUNCTION IF EXISTS public.xpath_nodeset(text, text);
DROP FUNCTION IF EXISTS public.xpath_nodeset(text, text, text);
DROP FUNCTION IF EXISTS public.xpath_nodeset(text, text, text, text);
DROP FUNCTION IF EXISTS public.xpath_number(text, text);
DROP FUNCTION IF EXISTS public.xpath_string(text, text);
DROP FUNCTION IF EXISTS public.xpath_table(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.xslt_process(text, text);
DROP FUNCTION IF EXISTS public.xslt_process(text, text, text);

-- ---------------------------------------------------------------------
-- 7. Verify: nothing left loads pgxml.so, and the rewritten functions work.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    leftovers TEXT;
    pretty    TEXT;
BEGIN
    SELECT string_agg(oid::regprocedure::text, ', ')
      INTO leftovers
      FROM pg_proc WHERE probin ~ 'pgxml';

    IF leftovers IS NOT NULL THEN
        RAISE EXCEPTION 'pgxml-backed functions remain: %', leftovers;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'xml2') THEN
        RAISE EXCEPTION 'xml2 extension still installed';
    END IF;

    pretty := evergreen.xml_pretty_print('<a><b>x</b><c/></a>'::XML)::TEXT;
    IF pretty !~ '<b>x</b>' THEN
        RAISE EXCEPTION 'xml_pretty_print smoke test failed: %', pretty;
    END IF;

    IF NOT pg_catalog.xml_is_well_formed_document('<record><leader>x</leader></record>') THEN
        RAISE EXCEPTION 'xml_is_well_formed_document smoke test failed';
    END IF;

    IF pg_catalog.xml_is_well_formed_document('<record><leader>x</record>') THEN
        RAISE EXCEPTION 'xml_is_well_formed_document accepted malformed XML';
    END IF;
END
$$;

COMMIT;
