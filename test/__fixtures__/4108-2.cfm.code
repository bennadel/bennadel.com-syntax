<cfscript>

	// The SPA experience is gated by the current session. If the user is not yet
	// authenticated, we need to bounce them out to the login page.
	if ( ! session.isLoggedIn ) {

		// After the user logs-in, we want to redirect them to this page. As such, we
		// have to pass the CURRENT URL to the login page as a parameter (redirectTo).
		redirectTo = new DynamicUrl( cgi.script_name )
			.addUrlParams( url )
			.toUrl()
		;

		// NOTE: If the current URL has a FRAGMENT on it, that FRAGMENT will be
		// maintained through this redirect (even though it is not sent to the server).
		// The login page will then grab the fragment and convert it into a "spaRoute"
		// URL parameter for safer passage.
		location(
			url = "./index.cfm?redirectTo=#encodeForUrl( redirectTo )#",
			addToken = false
		);

	}

	// ------------------------------------------------------------------------------- //
	// ------------------------------------------------------------------------------- //

	// The SPA (Single-Page Application) works by using client-side routing that is - in
	// this example - driven by the URL fragment (ie, not using HTML5-mode routing).
	// Since URL fragments are notoriously hard to pass-around (since they are never sent
	// to the server), we'll send a URL-based "spaRoute" to be passed-around instead
	// (which will get sent to the server). If this parameter exists, we're going to
	// convert it to the current SPA fragment as part of the initial SPA rendering.
	if ( url.keyExists( "spaRoute" ) ) {

		// Pull the spaRoute out of the current URL.
		nextLocation = new DynamicUrl( cgi.script_name )
			.addUrlParams( url )
			.deleteUrlParam( "spaRoute" )
			// Move the spaRoute parameter into the next URL fragment.
			.addFragment( url.spaRoute )
			.toUrl()
		;

		location( url = nextLocation, addToken = false );

	}

</cfscript>
<cfoutput>

	<!doctype html>
	<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>
			Main SPA (Single-Page App) Experience
		</title>
	</head>
	<body>

		<h1>
			Main SPA (Single-Page App) Experience
		</h1>

		<p>
			Your current route:
			<code class="route" style="background: yellow ;"></code>
		</p>

		<p>
			<a href="./logout.cfm">Logout</a>
		</p>

		<script type="text/javascript">

			// Output the current spa-route fragment in the view.
			document
				.querySelector( ".route" )
				.textContent = window.location.hash
			;

		</script>

	</body>
	</html>

</cfoutput>
