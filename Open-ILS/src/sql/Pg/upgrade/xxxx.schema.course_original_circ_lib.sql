BEGIN;

-- SELECT evergreen.upgrade_deps_block_check('XXXX', :eg_version);

ALTER TABLE asset.course_module_course_materials
    ADD COLUMN original_circ_lib INT REFERENCES actor.org_unit (id);

COMMIT;