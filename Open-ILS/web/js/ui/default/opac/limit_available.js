function limit_available( element ) {
    var url = document.URL;
    //always try to remove the available modifier
    url = url.replace(/;modifier=available/, '');

    //if the box is checked add in the availavle modifier
    if(element.checked){
        url += ";modifier=available";
    }
    //Return to first page when sorting
    url = url.replace(/;page=[\d]+/, '');
    window.location.href = url;
}
