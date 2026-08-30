<cfscript>

	// NOTE: In order to test the URL redirection, I want to make sure that our target
	// URL contains nested encoding. This way, I can see if our URL management is being
	// overly clinical in its sanitization practices (and not allowing what would
	// otherwise be a totally valid target URL).
	banner = encodeForUrl( "S&P" );

</cfscript>
<cfoutput>

	<h1>
		Ways A URL Can Be Sent
	</h1>

	<p>
		Copy-Pasted From Co-Worker (using URL fragment):
		<a href="./spa.cfm?showBanner=#banner###/path/to/thing">Goto the Thing</a> &rarr;
	</p>

	<p>
		Transactional Email (using spaRoute URL parameter):
		<a href="./spa.cfm?showBanner=#banner#&spaRoute=/path/to/thing">Goto the Thing</a> &rarr;
	</p>

</cfoutput>
