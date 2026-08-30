component
	output = false
	hint = "I provide methods that facilitate interacting with the X-DevAPI aspect of the MySQL 8 driver."
	{

	/**
	* I initialize the MySQL 8 X-DevAPI helper.
	*/
	public void function init(
		required string username,
		required string password,
		required string databaseServer,
		required string defaultSchema,
		required array jarPaths
		) {

		variables.defaultSchema = arguments.defaultSchema;
		variables.jarPaths = arguments.jarPaths;

		// Unlike with the CFQuery tag, we have to manage our own connection pool when
		// using the X-DevAPI. Or, at least, we have to instantiate it and let the client
		// take care of it.
		// --
		// https://dev.mysql.com/doc/x-devapi-userguide/en/connecting-connection-pool.html
		var pooling = {
			// Connection pooling enabled. When the option is set to false, a regular,
			// non-pooled connection is returned, and the other connection pool options
			// listed below are ignored. Default true.
			enabled: true,
			// The maximum number of connections allowed in the pool. Default 25.
			maxSize: 25,
			// The maximum number of milliseconds a connection is allowed to idle in the
			// queue before being closed. A zero value means infinite. Default 0.
			maxIdleTime: 30000,
			// The maximum number of milliseconds a request is allowed to wait for a
			// connection to become available. A zero value means infinite. Default 0.
			queueTimeout: 10000
		};

		// NOTE: The X-DevAPI uses a different PROTOCOL and PORT.
		variables.dbClient = javaNew( "com.mysql.cj.xdevapi.ClientFactory" )
			.init()
			.getClient(
				"mysqlx://#username#:#password#@#databaseServer#:33060",
				serializeJson({ pooling: pooling })
			)
		;

	}

	// ---
	// PUBLIC METHODS.
	// ---

	/**
	* I load the given class from the MySQL JAR files.
	* 
	* CAUTION: While the ColdFusion application already has the Connector/J JAR files, it
	* didn't have the ProtoBuf JAR files. I had to download those from Maven.
	*/
	public any function javaNew( required string className ) {

		return( createObject( "java", className, jarPaths ) );

	}


	/**
	* Many values that comes out of the X-DevAPI results seems to be a "JsonValue" class
	* instance. We need to convert those to native ColdFusion data structures. This
	* recurses through the given value and maps it onto native Structs, Strings, Numbers,
	* etc.
	*/
	public any function jsonResultToCFML( required any input ) {

		if ( isStruct( input ) ) {

			return input.map(
				( key, value ) => {

					return( jsonResultToCFML( value ) );

				}
			);

		} else if ( isArray( input ) ) {

			return input.map(
				( value, index ) => {

					return( jsonResultToCFML( value ) );

				}
			);

		} else if ( isInstanceOf( input, "com.mysql.cj.xdevapi.JsonValue" ) ) {

			return( deserializeJson( input.toString() ) );

		} else {

			return( input );

		}

	}


	/**
	* I parse the given _id value into its individual parts.
	* 
	* CAUTION: The date in the _id is NOT the date that the document was created - it's
	* the date that the SERVER was STARTED. If you want to know when a document was
	* created, you have to store that as a property on the document (it seems).
	*/
	public struct function parseID( required string id ) {

		// All aspects of the "_id" object are HEX-encoded numbers.
		// --
		// https://dev.mysql.com/doc/x-devapi-userguide/en/understanding-automatic-document-ids.html
		var prefix = inputBaseN( id.left( 4 ), 16 );
		var epochSeconds = inputBaseN( id.mid( 5, 8 ), 16 );
		var serial = inputBaseN( id.right( 16 ), 16 );

		// The "server startup" value is the Epoch Seconds. Let's convert that to a date
		// using Epoch milliseconds.
		var serverStartedAt = createObject( "java", "java.util.Date" )
			.init( epochSeconds * 1000 )
		;

		return({
			prefix: prefix,
			startedAt: serverStartedAt,
			serial: serial
		});

	}


	/**
	* I shutdown the database client, closing all session and disconnecting from the
	* MySQL database.
	*/
	public void function teardown() {

		dbClient?.close();

	}


	/**
	* I get a new Session from the Client's connection pool and pass it to the given
	* callback operator (along with the correct schema and a reference to this component).
	* The session is automatically returned to the pool once the operator has completed.
	* Any result returned from the operator is passed-back up to the calling context.
	*/
	public any function withSession(
		required function operator,
		string databaseSchema = defaultSchema
		) {

		try {

			var dbSession = dbClient.getSession();
			var dbSchema = dbSession.getSchema( databaseSchema );

			return( operator( dbSession, dbSchema, this ) );

		} finally {

			dbSession?.close();

		}

	}


	/**
	* I add the given document to the collection. Returns the generated ID.
	*/
	public string function xAdd(
		required string into,
		required struct value
		) {

		var results = withSession(
			( dbSession, dbSchema ) => {

				var addStatement = dbSchema
					.createCollection( into, true )
					.add([ serializeJson( value ) ])
				;

				return( addStatement.execute() );

			}
		);

		return( results.getGeneratedIds().first() );

	}


	/**
	* I return the documents that match the given where clause.
	*/
	public array function xFind(
		required string from,
		string where = "",
		struct params = {},
		numeric limit = 0
		) {

		var results = withSession(
			( dbSession, dbSchema ) => {

				var findStatement = dbSchema
					.createCollection( from, true )
					.find( where )
					.bind( params )
				;

				if ( limit ) {

					findStatement.limit( limit );

				}

				return( jsonResultToCFML( findStatement.execute().fetchAll() ) );

			}
		);

		return( results );

	}


	/**
	* I get the document with the given ID. If the document doesn't exist, an error is
	* thrown.
	*/
	public struct function xGetOne(
		required string from,
		required string id
		) {

		var results = withSession(
			( dbSession, dbSchema ) => {

				var dbDoc = dbSchema
					.createCollection( from, true )
					.getOne( id )
				;

				if ( isNull( dbDoc ) ) {

					throw(
						type = "Database.DocumentNotFound",
						message = "The document could not be found."
					);

				}

				return( jsonResultToCFML( dbDoc ) );

			}
		);

		return( results );

	}


	/**
	* I remove the document with the given ID. Returns the number of documents affected by
	* the operation.
	*/
	public numeric function xRemoveOne(
		required string from,
		required string id
		) {

		var itemCount = withSession(
			( dbSession, dbSchema ) => {

				var result = dbSchema
					.createCollection( from, true )
					.removeOne( id )
				;

				return( result.getAffectedItemsCount() );

			}
		);

		return( itemCount );

	}


	/**
	* I update documents that match the given where clause. Returns the number of
	* documents affected by the operation.
	*/
	public numeric function xUpdate(
		required string from,
		required string where,
		required struct set,
		struct params = {}
		) {

		var itemCount = withSession(
			( dbSession, dbSchema ) => {

				var modifyStatement = dbSchema
					.createCollection( from, true )
					.modify( where )
					.patch( serializeJson( set ) )
					.bind( params )
				;

				return( modifyStatement.execute().getAffectedItemsCount() );

			}
		);

		// NOTE: If the targeted object exists but the operation didn't actually change
		// any of the properties, this count will be zero.
		return( itemCount );

	}

}
