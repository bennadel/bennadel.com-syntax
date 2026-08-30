component
	output = false
	hint = "I provide methods for building-up and then serializing a dynamic URL."
	{

	/**
	* I initialize the dynamic URL with the given path and query-string.
	*/
	public void function init(
		string scriptName = "",
		string queryString = ""
		) {

		variables.scriptName = arguments.scriptName;
		variables.urlParams = parseQueryString( queryString );
		variables.fragment = "";

	}

	// ---
	// PUBLIC METHODS.
	// ---

	/**
	* I add the given fragment to the dynamic URL.
	*/
	public any function addFragment( required string fragment ) {

		variables.fragment = arguments.fragment;
		return( this );

	}


	/**
	* I add the given URL parameter to the dynamic URL.
	*/
	public any function addUrlParam(
		required string name,
		required string value
		) {

		urlParams[ name ] = value;
		return( this );

	}


	/**
	* I add the given URL parameter to the dynamic URL if the parameter is not-empty.
	*/
	public any function addUrlParamIfPopulated(
		required string name,
		required string value
		) {

		if ( value.len() ) {

			urlParams[ name ] = value;

		}

		return( this );

	}


	/**
	* I add the given URL parameters struct to the dynamic URL.
	*/
	public any function addUrlParams( required struct newParams ) {

		urlParams.append( newParams );
		return( this );

	}


	/**
	* I remove the given URL parameter from the dynamic URL.
	*/
	public any function deleteUrlParam( required string name ) {

		urlParams.delete( name );
		return( this );

	}


	/**
	* I parse the given URL string and use it construct the dynamic URL components.
	*/
	public any function parseUrl( required string newUrl ) {

		var baseUrl = newUrl.listFirst( "##" );

		variables.fragment = newUrl.listRest( "##" );
		variables.scriptName = baseUrl.listFirst( "?" );
		variables.urlParams = parseQueryString( baseUrl.listRest( "?" ) );

		return( this );

	}


	/**
	* I serialize the dynamic URL into a composite string.
	*/
	public string function toUrl() {

		var queryStringPairs = [];

		loop
			key = "local.key"
			value = "local.value"
			struct = urlParams
			{

			queryStringPairs.append( encodeForUrl( key ) & "=" & encodeForUrl( value ) );

		}

		var baseUrl = scriptName;

		if ( queryStringPairs.len() ) {

			baseUrl &= ( "?" & queryStringPairs.toList( "&" ) );

		}

		if ( fragment.len() ) {

			baseUrl &= ( "##" & fragment );

		}

		return( baseUrl );

	}

	// ---
	// PRIVATE METHODS.
	// ---

	/**
	* I parse the given query-string value into a collection of key-value pairs.
	*/
	private struct function parseQueryString( required string queryString ) {

		var params = [:];

		if ( ! queryString.len() ) {

			return( params );

		}

		for ( var pair in queryString.listToArray( "&" ) ) {

			var encodedKey = pair.listFirst( "=" );
			var encodedValue = pair.listRest( "=" );

			var decodedKey = canonicalize( encodedKey, true, true );
			// CAUTION: We need to be more relaxed with the VALUE of the URL parameter
			// since it may contain nested encodings, especially if the parameter is
			// pointing to another full URL (that may also contain encoded values).
			var decodedValue = urlDecode( encodedValue );

			params[ decodedKey ] = decodedValue;

		}

		return( params );

	}

}
