

var g = {};
var templateList = [];
var template;
var DEFAULT = "--Default--";
var myPackageDir = 'open_ils_staff_client';

function getSearchStash() {
    return JSON.parse(window.localStorage.getItem('eg.catalog.staff.search_templates')) || [];
}

function getXULSearchStash() {
    try {
        if (typeof JSAN == 'undefined') {
            throw( document.getElementById("commonStrings").getString('common.jsan.missing') );
        }
        JSAN.errorLevel = "die"; // none, warn, or die
        JSAN.addRepository('/xul/server/');
        JSAN.use('util.error');
        g.error = new util.error();
        g.error.sdump('D_TRACE', 'getSearchStash() from search_settings.tt2 or search.tt2');

        JSAN.use('OpenILS.data');
        g.data = new OpenILS.data();
        g.data.stash_retrieve();

        //populate templateList, or not.
        if (g.data.search_templates) {
            templateList = g.data.search_templates;

            //check for current template
            if (g.data.current_search_template) {
                template = g.data.current_search_template;
            }
        }
        else {
            templateList = new Array();
        }
    } catch (E) {
        try { g.error.standard_unexpected_error_alert('search_settings.tt2', E); } catch (F) { alert(E); }
        return 0;
    }
}

function templateActionSave() {
    var nameInput = document.getElementById('nameInput').value;
    create_template(nameInput);
    templateSelected();
}

// Removes template from templateList and localStorage if it exists and if user wants it deleted
function templateActionDelete() {
    var nameInput = document.getElementById('nameInput').value;
    var templateList = getSearchStash();
    var tempTemplate = getTemplateByName(nameInput, templateList);
    if (tempTemplate) {
        if (confirm("Are you sure you want to delete Template '" + nameInput + "'?")) {
            deleteTemplatefromTemplateList(nameInput, templateList);
            populateTemplateOptions(templateList);
        }
    } else {
        alert("Template '" + nameInput + "' does not exist.");
    }
}

//Creates, or edits, a search template based off the currently selected values
function create_template(tName) {
    var template;
    var templateList = getSearchStash();
    if (!tName || tName == DEFAULT)
    {
        alert("That is not a valid name.");
        return;
    }
    template = getTemplateByName(tName, templateList);

    if (template == null)
    {
        var isNew = 1;
        template = new Object();
        populateTemplate(template);
        // this.template = template;
        templateList.push(template);
        templateList.sort(compareTemplateNames)
    }
    else
    {
        if (confirm("Do you want to overwrite " + template.name + " template?"))
        {
            populateTemplate(template);
            this.template = template;
        }
        else
        { return;}
    }
    // saveCurrentTemplate( template );
    saveCurrentTemplateToLocal(template);
    // saveTemplateList(templateList);
    saveTemplateListToLocal(templateList);

    //Add to templateSel and select if new template
    if(isNew)
    {
        populateTemplateOptions(templateList);
        selectOptionValue(templateSel, template.name);
    }
}

//Returns the selected values of of a given element
function getSelectedValues(elmnt)   {
elmntVals = [];
    var x = 0;
    for (x=0;x<elmnt.length;x++)
    {
        if (elmnt[x].selected)
        {
            elmntVals.push(elmnt[x].value);
        }
    }
return elmntVals;
}

//Select options in element whose values are equal to the values submitted
function selectOptionValues(elmnt, values){
    elmnt.selectedIndex = -1;
    for(var i=0; i < elmnt.options.length; i++)
    {
        for (v in values)
        {
            if(elmnt.options[i].value == values[v])
            {
            elmnt.options[i].selected = true;
            break;
            }
        }
    }
}

//Saves templateList to local storage in JSON format
function saveTemplateListToLocal(templateList) {
    window.localStorage.setItem('eg.catalog.staff.search_templates', JSON.stringify(templateList));
    alert("Template List has been updated.");
}

//Saves templateList to File in JSON format.
function saveTemplateListToFile( templateList ) {
    try {
        JSAN.use('util.file');
        var file = new util.file('search_templates');
        file.write_content( 'truncate', String( JSON.stringify(templateList) ) );
        file.close();
        alert("Template List has been updated.");
        } catch(E) {
            try { g.error.standard_unexpected_error_alert('saving in search_settings.tt2',E); } catch(F) { alert(E); }
        }
}

//Saves current template name to local storage
function saveCurrentTemplateToLocal(template) {
    window.localStorage.setItem('eg.catalog.staff.search_templates', JSON.stringify(template));
}

//Saves current template name to file
function saveCurrentTemplateToFile( template ) {
    try {
        JSAN.use('util.file');
        var file = new util.file('yesterdays_search_template');
        file.write_content( 'truncate', String( JSON.stringify(template) ) );
        file.close();
    } catch(E) {
        try { g.error.standard_unexpected_error_alert('saving in search_settings.tt2',E); } catch(F) { alert(E); }
    }
}

//Populates template dropdown from given template list
function populateTemplateOptions(templateList)  {
    var templateList = getSearchStash();
    templateSel.options.length = 0;
    templateSel.options[0]= new Option(DEFAULT, "");

    if (templateList)
    {
        var len = templateList.length;
        for(var i=1; i<=len; i++)
        {
            templateSel.options[i]= new Option(templateList[i-1].name, templateList[i-1].name);
            if (template && template.name == templateList[i-1].name)
            {
                templateSel.options[i].selected= true;
            }
        }
    }
}

//returns template with a given name from templatelist
function getTemplateByName(templateName, templateList)  {
    var len = templateList.length;

    for(var i=0; i<len; i++)
    {
        if (templateList[i].name == templateName)
        {
            return templateList[i];
        }
    }
    return null;
}

//returns template's index value in templateList with a given name from templatelist
function getTemplateIndex(templateName, templateList)   {
    var len = templateList.length;

    for(var i=0; i<len; i++)
    {
        if (templateList[i].name == templateName)
        {
            return i;
        }
    }
    return null;
}

//Saves selected values to a search template
function populateTemplate(template) {
    template.name = document.getElementById("nameInput").value;
    template.gRows = getGlobalRowValues();
    template.advFilters = getFilterValues();
    template.pubdate = pubdateSel.value;
    template.org = orgSel.value;
    template.sort = sortBySel.value;
    template.view = resultViewSel.value;
    template.modifier = document.getElementById("modifier").checked;
}

//returns array containing the selected values of the global rows
function getGlobalRowValues(){
    var tBody = document.getElementById("adv_global_tbody");
    var rows = tBody.getElementsByTagName("tr");
    var gRows = [];
    for (var i=0; i<rows.length; i++)
    {
        gRows[i] = {};
        var gSels = rows[i].getElementsByTagName("select");
        for (var s = 0; s<gSels.length; s++)
        {
            gRows[i][gSels[s].name] = gSels[s].value;
        }
    }
    return gRows;
}

//returns array containing the selected values of the search filters
function getFilterValues()   {
    var filters = [];
    for (var s = 0; s < searchFilters.length; s++)
    {
        filters[s] = getSelectedValues(searchFilters[s]);
    }
    return filters;
}

// Takes name of selected template and adds to Template Name input field
function populateTemplateNameValue(tName) {
    var target = document.getElementById('nameInput');
    target.value = tName;
}

//Select the apropriate search options given a search template
function populateSearchOptions(template) {
    setFilterValues(template);
    selectOptionValue(pubdateSel, template.pubdate);
    if (template.pubdate == "between")
        { unHideMe(document.getElementById("adv_global_pub_date_2_span")); }
    else
        { hideMe(document.getElementById("adv_global_pub_date_2_span")); }

    selectOptionValue(orgSel, template.org);
    selectOptionValue(sortBySel, template.sort);

    selectOptionValue(resultViewSel, template.view);
    modCheck.checked = template.modifier;
    setGlobalRowValues(template);
}
//clears all selects and inputs, except the templateList select
function clearOptions() {
    resultViewSel.selectedIndex = 0;
    modCheck.checked = false;
    clearGlobalRowValues();
    clearSearchFilters();
    hideMe(document.getElementById("adv_global_pub_date_2_span"));
}
//removes any selections in the searchFilter table
function clearSearchFilters() {
    for (var s = 0; s < searchFilters.length; s++)
    {
        if (searchFilters[s].multiple)
        { searchFilters[s].selectedIndex = -1; }
        else
        { searchFilters[s].selectedIndex = 0; }
    }
}

// Adds "selected" attribute to chosen template from list
function templateSelected() {
    var templateSelector = document.getElementById('templateList');
    var templateOptions = templateSelector.getElementsByTagName('option');
    for (var i = 0; i < templateOptions.length; i++) {
        if (!templateOptions[i].selected) {
            templateOptions[i].removeAttribute('selected');
        }
        if (templateOptions[i].value == templateSelector.value) {
            templateOptions[i].setAttribute('selected', '');
            var selectedTemplate = templateOptions[i].value;
            window.localStorage.setItem('eg.catalog.staff.search_templates.last_used', selectedTemplate);
        }
    }
}

// Retrieves and populates selected template from localStorage
function retrieveSelectedTemplate() {
    var selectedTemplate = window.localStorage.getItem('eg.catalog.staff.search_templates.last_used');
    var templateList = JSON.parse(window.localStorage.getItem('eg.catalog.staff.search_templates')) || [];
    var templateSelector = document.getElementById('templateList');
    var templateOptions = templateSelector.getElementsByTagName('option');

    for (var i = 0; i < templateList.length; i++) {
        if (templateList[i].name == selectedTemplate) {
            populateSearchOptions(templateList[i]);
        }
    }
    // ensures template stays selected on reload
    for (var j = 0; j < templateOptions.length; j++) {
        if (templateOptions[j].value == selectedTemplate) {
            templateOptions[j].setAttribute('selected', '');
        }
    }
}

window.onload = function () {
    retrieveSelectedTemplate();
}

//Given a template name, saves template as the current search template if name found in TemplateList
//Populates options, or not, accordingly
function selectSearchTemplateOrClear(tName) {
    var templateList = getSearchStash();
    template = getTemplateByName(tName, templateList);
    // saveCurrentTemplate( template )
    // saveCurrentTemplateToLocal(template);

    if (template)
    {
        populateSearchOptions(template);
    } else {
        clearOptions();
    }
}
//Given a template name, saves template as the current search template if name found in TemplateList
//Populates options, or not, accordingly. Then clears search text fields
function selectSearchTemplateOrClearAll(tName)  {
    selectSearchTemplateOrClear(tName);
    populateTemplateNameValue(tName);
    templateSelected();
    clearGlobalRowInputs();
    clearPubDateInputs();
}

//Unselects all search options, clears text inputs
function clearAll()     {
    clearOptions();
    clearGlobalRowInputs();
    clearPubDateInputs();
}

//Make selections in the "global_row.tt2" according to the given search template
function setGlobalRowValues(template){
    var tBody = document.getElementById("adv_global_tbody");
    var rows = tBody.getElementsByTagName("tr");
    var gRows = [];
    for (var i=0; i<rows.length; i++)
    {
        var gRowSels = rows[i].getElementsByTagName("select");
        gRow = template.gRows[i];
        var qtypeSel;
        var containsSel;
        for (var s = 0; s<gRowSels.length; s++)
        {
            selectOptionValue(gRowSels[s], gRow[gRowSels[s].name]);
        }
    }
}
//Sets the values of the adv_attr and adv_filter filters from a template
function setFilterValues(template) {
    var t = 0;
    for (var s = 0; s < searchFilters.length; s++)
    {
        //determining adv_attr or adv_filter by checking if select is multiple, there may be a better way...
        if(searchFilters[s].multiple)
        {
            selectOptionValues(searchFilters[s], template.advFilters[t]);
            t++;
        }
    }
}
//select the first option in each Select in the "global_row.tt2)
function clearGlobalRowValues() {
    var tBody = document.getElementById("adv_global_tbody");
    var rows = tBody.getElementsByTagName("tr");
    for (var i=0; i<rows.length; i++)
    {
        var gRowSels = rows[i].getElementsByTagName("select");
        for (var s = 0; s<gRowSels.length; s++)
        {
            gRowSels[s].selectedIndex = 0;
        }
    }
}

//Select a single value in an element
function selectOptionValue(elmnt, value) {
    for(var i=0; i < elmnt.options.length; i++)
    {
        if(elmnt.options[i].value == value)
        {
            elmnt.options[i].selected = true;
            break;
        }
    }
}
//sort comparator for template names
function compareTemplateNames(templateA,templateB) {
    if (templateA.name < templateB.name)
        { return -1; }
    if (templateA.name > templateB.name)
        { return 1; }
    else
        { return 0; }
}

//removes a template from the templateList object
function deleteTemplatefromTemplateList(tName, templateList) {
    var index = getTemplateIndex(tName, templateList);
    templateList.splice(index,1);
    // saveTemplateList(templateList);
    saveTemplateListToLocal(templateList);
    return templateList;
}

//Removes template from templateList and saved file if it exists and user wants it deleted
function removeTemplate(templateList, currentTemplate)  {
    var tempTemplate = getTemplateByName(textIn.value, templateList);
    if (tempTemplate)
    {
        if(confirm("Are you sure you want to delete Template '" + tempTemplate.name + "'?"))
        {
            deleteTemplatefromTemplateList(tempTemplate.name, templateList);
            populateTemplateOptions(templateList);

            //deleted template is the current template in use
            if (currentTemplate.name == tempTemplate.name)
            {
                // saveCurrentTemplate(null);
                saveCurrentTemplateToLocal(null);
                clearOptions();
                templateSel.selectedIndex = 0;
            }
            else
            {
                selectOptionValue(templateSel, currentTemplate.name);
            }
            textIn.value = "";
        }
        else {
            return;
        }
    }
    else {
        alert("Template '" + textIn.value + "' does not exist.");
    }
}
//caches templateList and saves to file for posterity
function saveTemplateList(templateList) {
    g.data.search_templates = templateList;
    g.data.stash('search_templates');
    saveTemplateListToFile(templateList);
}

//caches template currently in use and saves it to file
function saveCurrentTemplate(template)  {
    g.data.current_search_template = template;
    g.data.stash('current_search_template');
    saveCurrentTemplateToFile(template);
}

//clears all global row input fields
function clearGlobalRowInputs() {
    var tBody = document.getElementById("adv_global_tbody");
    if(tBody)
    {
        var rows = tBody.getElementsByTagName("tr");
        if(rows.length > 0)
        for (var i=0; i<rows.length; i++)
        {
            var inputs = rows[i].getElementsByTagName("input");
            if (inputs.length > 0) {
                inputs[0].value = '';
            }
        }
    }
}
//clears input fields associated with the pubdate
function clearPubDateInputs()
    {
        document.getElementById("adv_global_pub_date_1_input").value = '';
        document.getElementById("adv_global_pub_date_2_input").value = '';
    }
