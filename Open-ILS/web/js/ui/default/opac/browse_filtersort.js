function sort_browse( element ) {
        var sortValue = element.value;
	var url = document.URL;
	url = url.replace(/sort=[a-z]*(\.descending)?/, '');
	url = url.replace(/;sort=[a-z]*(\.descending)?/, '');
	url += ";sort=" + sortValue;

        //Return to first page when sorting
        url = url.replace(/;page=[\d]+/, '');

	window.location.href = url;
}

