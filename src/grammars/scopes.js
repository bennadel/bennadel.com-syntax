/**
* The scope names the vendored cfmleditor grammars declare. A leaf module so
* the loader, the patch modules and core/highlight.js can all import them
* without any of them importing each other.
*/

/** Tag-based CFML: `.cfm` files, and `.cfc` files written with tags. */
export var CFML_TAG = "embedding.cfml";

/** Script-based CFML: `cfscript` blocks and script-style `.cfc` components. */
export var CFML_SCRIPT = "embedding.cfml.cfs";
