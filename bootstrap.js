/**
 * This is an example bootstrap.js
 */

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

let GLOBAL_SCOPE = this;

function startup(data, reason) {

  // Load pullstarter.js. Doing URI path concatenation here manually may appear
  // a bit clunky. The alternative would be to do retrieve the addon information
  // from the AddonManager using `AddonManager.getAddon()` and then
  // `addon.getResourceURI("pullstarter.js")`, but this will in all likelihood
  // perform disk I/O (a SQLite query), and it's probably a good idea to avoid
  // that at startup if we can.
  Cu.import("resource://gre/modules/Services.jsm");
  Services.scriptloader.loadSubScript(data.resourceURI.spec + "pullstarter.js",
                                      GLOBAL_SCOPE);

  // Register the add-on's directory under the resource://myaddon URI. This will
  // allow you to refer to files packaged in this add-on as
  // resource://myaddon/filename, e.g. when importing a JSM via
  // `Cu.import("resource://myaddon/foobar.jsm");`
  PullStarter.registerResourceHost("myaddon", data);

  // Register a chrome.manifest (requires Firefox 8+). This will allow you to
  // register chrome:// URLs in a chrome.manifest which is necessary for XUL
  // windows or tabs.
  PullStarter.registerChromeManifest(data);

  // Let's add a stylesheet to all browser windows.
  PullStarter.watchWindows("navigator:browser", function (window) {
    // This is just standard DOM manipulation stuff...
    let document = window.document;
    let css = "chrome://myaddon/skin/foobar.css";
    let pi = document.createProcessingInstruction(
      "xml-stylesheet", "href=\"" + css + "\" type=\"text/css\"");
    document.insertBefore(pi, document.documentElement);

    // Register an unloader that removes the stylesheet when the add-on is
    // deactivated or removed.
    PullStarter.registerUnloader(function () {
      document.removeChild(pi);
    }, window);
  });

}

// pullstarter.js already defines default shutdown(), install(), uninstall()
// functions.
