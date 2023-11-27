function set_navigator () {
	
	dojo.require("fieldmapper.Fieldmapper");
	dojo.require("fieldmapper.dojoData");
	dojo.require("fieldmapper.OrgUtils");
	dojo.require('openils.PermaCrud');
    dojo.require('openils.CGI');

	var url = document.URL;
    var cgi = new openils.CGI();

    // metabib.browse_entry.id,config.metabib_field
    var browseEntry = cgi.param('fi:has_browse_entry').split(',')[0];

	// - serch class
    var searchClass = cgi.param('qtype');

    // JBAS-1929
    var mattype = cgi.param('fi:mattype');

	// - browse term
    var searchTerm = cgi.param('bterm');

	// - context_org (locg)
    var locg = cgi.param('locg');

	var retrieve = ['open-ils.search', 'open-ils.search.metabib.browse.setnav'];
	var params = [ browseEntry, searchClass, searchTerm, locg, mattype ];

	fieldmapper.standardRequest(
		retrieve,
		{   async:true,
		    params:params,
		    oncomplete: function(r) {
                var results = openils.Util.readResponse(r);
		        var url = document.URL;
                // Force the 1hit browse redirect
                url = url.replace(/(record)/, 'browse_items');
                // Reset results paging
                url = url.replace(/;page=\d+/, '');

                //Uncomment if you want to reset these options on set navigation.
                // Remove any sorting
                //url = url.replace(/(;sort=[a-z])/, '');
                // Remove Limit to available items
                //url = url.replace(/(;modifier=available)/, '');
                // Remove detail view
                //url = url.replace(/(;detail_record_view=1)/, '');

                //var previousUrl;
                //var nextUrl;

                /*
                var previousUrl = url.replace(/(.*[a-z]+%2C)[0-9]+%2C[0-9]+(.*)/,
                        "$1" + results.previous_browse + '%2C'
                        + results.previous_field + "$2");
                */

                cgi.param('fi:has_browse_entry', 
                    results.previous_browse + ',' + results.previous_field);
                var previousUrl = cgi.url();

                /*
                var nextUrl = url.replace(/(.*[a-z]+%2C)[0-9]+%2C[0-9]+(.*)/,
                        "$1" + results.next_browse + '%2C'
                        + results.next_field + "$2");
                */

                cgi.param('fi:has_browse_entry', 
                    results.next_browse + ',' + results.next_field);
                var nextUrl = cgi.url();


                //if (/.*qtype=id%7Cbibcn;.*/.test(url)) {

                    //previousUrl = url.replace(
                        ////(;fi%3Ahas_browse_entry=id%7Cbibcn%2C)(.*)/,
                        //"$1" + results.previous_browse + '%2C'
                        //+ results.previous_field);

                    //nextUrl = url.replace(
                        ////(;fi%3Ahas_browse_entry=id%7Cbibcn%2C)(.*)/,
                        //"$1" + results.next_browse + '%2C'
                        //+ results.next_field);
                //}

                //else{

                    //previousUrl = url.replace(/(;fi%3Ahas_browse_entry=[a-z]+%2C)([\d+,?]+)/, "$1" + results.previous_browse);
                    //previousUrl = previousUrl.replace(/(;fi%3Ahas_browse_entry=[a-z]+%2C\d+%2C)(\d+,?]+)/, "$1" + results.previous_field);
                    //nextUrl = url.replace(/(;fi%3Ahas_browse_entry=[a-z]+%2C)(\d+,?]+)/, "$1" + results.next_browse);
                    //nextUrl = nextUrl.replace(/(;fi%3Ahas_browse_entry=[a-z]+%2C\d+%2C)(\d+,?]+)/, "$1" + results.next_field);
                //}

                handleNavButton(document.getElementById("previous_set"),
                                previousUrl, results.previous_browse);

                handleNavButton(document.getElementById("next_set"),
                                nextUrl, results.next_browse);

		        document.getElementById("current_set").innerHTML = results.current_value;
		    }
		}
	);
}

function handleNavButton(element, targetUrl, isShown){

    if (isShown){

        element.href = targetUrl;
        element.className = "";
    }

    else{

        element.className = "hidden";
    }
}

function addLoadEvent(func) {
  var oldonload = window.onload;
  if (typeof window.onload != 'function') {
    window.onload = func;
  } else {
    window.onload = function() {
      if (oldonload) {
        oldonload();
      }
      func();
    }
  }
}

addLoadEvent (set_navigator);
