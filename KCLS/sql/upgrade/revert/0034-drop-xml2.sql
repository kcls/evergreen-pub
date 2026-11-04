-- Revert kcls-evergreen:0034-drop-xml2 from pg
--
-- Must run as a superuser.  Requires contrib/xml2 (pgxml.so) to be
-- installed for the running PG major version.

BEGIN;

CREATE EXTENSION IF NOT EXISTS xml2 WITH SCHEMA evergreen;
COMMENT ON EXTENSION xml2 IS 'XPath querying and XSLT';

-- Original bodies, as in 0000-kcls-base-schema-3.9.sql / upstream Evergreen.

CREATE OR REPLACE FUNCTION evergreen.xml_pretty_print(input XML)
    RETURNS XML
    LANGUAGE SQL AS
$func$
SELECT xslt_process($1::text,
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

CREATE OR REPLACE FUNCTION evergreen.marc_to (marc text, xfrm text) RETURNS TEXT AS $$
    SELECT evergreen.xml_pretty_print(xslt_process($1,xslt)::XML)::TEXT FROM config.xml_transform WHERE name = $2;
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION biblio.check_marcxml_well_formed () RETURNS TRIGGER AS $func$
BEGIN

    IF xml_is_well_formed(NEW.marc) THEN
        RETURN NEW;
    ELSE
        RAISE EXCEPTION 'Attempted to % MARCXML that is not well formed', TG_OP;
    END IF;
    
END;
$func$ LANGUAGE PLPGSQL;

-- Legacy loose public.* pgxml functions, verbatim from the 3.9 base dump.

--
-- Name: xml_encode_special_chars(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xml_encode_special_chars(text) RETURNS text
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xml_encode_special_chars';


ALTER FUNCTION public.xml_encode_special_chars(text) OWNER TO postgres;

--
-- Name: xml_is_well_formed(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xml_is_well_formed(text) RETURNS boolean
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xml_is_well_formed';


ALTER FUNCTION public.xml_is_well_formed(text) OWNER TO postgres;

--
-- Name: xml_valid(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xml_valid(text) RETURNS boolean
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xml_is_well_formed';


ALTER FUNCTION public.xml_valid(text) OWNER TO postgres;

--
-- Name: xpath_bool(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_bool(text, text) RETURNS boolean
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xpath_bool';


ALTER FUNCTION public.xpath_bool(text, text) OWNER TO postgres;

--
-- Name: xpath_list(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_list(text, text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$SELECT xpath_list($1,$2,',')$_$;


ALTER FUNCTION public.xpath_list(text, text) OWNER TO postgres;

--
-- Name: xpath_list(text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_list(text, text, text) RETURNS text
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xpath_list';


ALTER FUNCTION public.xpath_list(text, text, text) OWNER TO postgres;

--
-- Name: xpath_nodeset(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_nodeset(text, text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$SELECT xpath_nodeset($1,$2,'','')$_$;


ALTER FUNCTION public.xpath_nodeset(text, text) OWNER TO postgres;

--
-- Name: xpath_nodeset(text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_nodeset(text, text, text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$SELECT xpath_nodeset($1,$2,'',$3)$_$;


ALTER FUNCTION public.xpath_nodeset(text, text, text) OWNER TO postgres;

--
-- Name: xpath_nodeset(text, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_nodeset(text, text, text, text) RETURNS text
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xpath_nodeset';


ALTER FUNCTION public.xpath_nodeset(text, text, text, text) OWNER TO postgres;

--
-- Name: xpath_number(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_number(text, text) RETURNS real
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xpath_number';


ALTER FUNCTION public.xpath_number(text, text) OWNER TO postgres;

--
-- Name: xpath_string(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_string(text, text) RETURNS text
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xpath_string';


ALTER FUNCTION public.xpath_string(text, text) OWNER TO postgres;

--
-- Name: xpath_table(text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xpath_table(text, text, text, text, text) RETURNS SETOF record
    LANGUAGE c STABLE STRICT
    AS '$libdir/pgxml', 'xpath_table';


ALTER FUNCTION public.xpath_table(text, text, text, text, text) OWNER TO postgres;

--
-- Name: xslt_process(text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xslt_process(text, text) RETURNS text
    LANGUAGE c IMMUTABLE STRICT
    AS '$libdir/pgxml', 'xslt_process';


ALTER FUNCTION public.xslt_process(text, text) OWNER TO postgres;

--
-- Name: xslt_process(text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.xslt_process(text, text, text) RETURNS text
    LANGUAGE c STRICT
    AS '$libdir/pgxml', 'xslt_process';


ALTER FUNCTION public.xslt_process(text, text, text) OWNER TO postgres;


COMMIT;
