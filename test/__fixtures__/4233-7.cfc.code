component
	output = false
	hint = "I define the application settings and event handlers."
	{

	// Define the application settings.
	this.name = "MySqlXDevApiTesting";
	this.applicationTimeout = createTimeSpan( 0, 1, 0, 0 );
	this.sessionManagement = false;

	// ---
	// LIFE-CYCLE METHODS.
	// ---

	/**
	* I get called once to initialize the application state.
	*/
	public void function onApplicationStart() {

		application.xDevApi = new XDevApiHelper(
			username = "root",
			password = "password",
			databaseServer = "127.0.0.1",
			defaultSchema = "doc_demo",
			jarPaths = [
				expandPath( "./jars/mysql-connector-java-8.0.22.jar" ),
				expandPath( "./jars/protobuf-java-3.19.4.jar" )
			]
		);

	}


	/**
	* I get called once to teardown the application state.
	*/
	public void function onApplicationEnd( required struct applicationScope ) {

		applicationScope.xDevApi?.teardown();

	}


	/**
	* I get called once to initialize the request state.
	*/
	public void function onRequestStart() {

		// If the reset flag exists, re-initialize the ColdFusion application.
		if ( url.keyExists( "init" ) ) {

			// It's important that we call the applicationStop() function so that our
			// onApplicationEnd() method is called and we can clean-up the database
			// connections being held-open by X DevAPI before we create a new connection
			// pool in the onApplicationStart() event handler.
			applicationStop();
			location( url = cgi.script_name, addToken = false );

		}

	}

}
