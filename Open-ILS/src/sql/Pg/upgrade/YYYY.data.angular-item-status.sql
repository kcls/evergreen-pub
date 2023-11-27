BEGIN;

-- SELECT evergreen.upgrade_deps_block_check('TODO', :eg_version); 

INSERT into config.workstation_setting_type (name, grp, datatype, label)
VALUES ( 
    'eg.grid.cat.item.status.list', 'gui', 'object',
    oils_i18n_gettext(
        'eg.grid.cat.item.status.list',
        'Grid Config: eg.grid.cat.item.status.list',
        'coust', 'label'
    )
);

COMMIT;
