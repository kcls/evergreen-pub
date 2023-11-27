BEGIN; Select evergreen.upgrade_deps_block_check('XXXX', :eg_version);
INSERT INTO config.workstation_setting_type (name, grp, datatype, label)
VALUES (
    'eg.search.browse_sort_default', 'gui', 'string',
    oils_i18n_gettext(
        'eg.search.browse_sort_default',
        'Staff Catalog Default Browse Library',
        'cwst', 'label' 
    )
);
COMMIT;
