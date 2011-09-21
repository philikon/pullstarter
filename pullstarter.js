/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Pullstarter.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Philipp von Weitershausen <philipp@weitershausen.de>
 *   Edward Lee <edilee@mozilla.com>
 *   Erik Vold <erikvvold@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

/**
 * A collection of helpers that allow you to register various things while
 * making sure that they clean up after themselves when the add-on gets
 * unloaded or its context (e.g. DOM windows) get destroyed otherwise.
 * 
 * Call the various PullStarter.register* methods from your startup() function
 * and/or other places in your code.
 */
let PullStarter = {

  /**
   * Unload everything that has been registered with PullStarter.
   * This is called in PullStarter's default shutdown(), so if you're
   * redefining that you want to make sure you call PullStarter.unload().
   */
  _unloaders: [],
  unload: function unload() {
    this._unloaders.reverse();
    this._unloaders.forEach(function(func) {
      func.call(this);
    }, this);
    this._unloaders = [];
  },

  /**
   * Register an unloader function.
   * 
   * @param callback
   *        A function that performs some sort of unloading action.
   * @param window [optional]
   *        A DOM window object that, when closed, will also call the unloader.
   * 
   * @return a function that removes the unregisters unloader.
   */
  registerUnloader: function registerUnloader(callback, window) {
    let unloaders = this._unloaders;

    // Wrap the callback in a function that ignores failures.
    function unloader() {
      try {
        callback();
      } catch(ex) {
        // Ignore.
      }
    }
    unloaders.push(unloader);

    // Provide a way to remove the unloader
    function removeUnloader() {
      let index = unloaders.indexOf(unloader);
      if (index != -1) {
        unloaders.splice(index, 1);
      }
    }

    // If an associated window was specificed, we want to call the
    // unloader when the window dies, or when the extension unloads.
    if (window) {
      // That means when the window gets unloaded, we want to call the unloader
      // and remove it from the global unloader list.
      let onWindowUnload = function onWindowUnload() {
        unloader();
        removeUnloader();
      };
      window.addEventListener("unload", onWindowUnload, false);

      // When the unloader is called, we want to remove the window unload event
      // listener, too.
      let origCallback = callback;
      callback = function callback() {
        window.removeEventListener("unload", onWindowUnload, false);
        origCallback();
      };
    }

    return removeUnloader;
  },

  /**
   * Register a 'chrome.manifest'
   * 
   * @param data
   *        The add-on data object passed into the startup() function.
   */
  registerChromeManifest: function registerChromeManifest(data) {
    Components.manager.addBootstrappedManifestLocation(data.installPath);
    this.registerUnloader(function () {
      Components.manager.removeBootstrappedManifestLocation(data.installPath);
    });
  },

  /**
   * Register the addon's directory as a resource protocol host. This will
   * allow you to refer to files packaged in the add-on as
   * resource://<host>/<filename>.
   * 
   * @param host
   *        The name of the resource protocol host.
   * @param data
   *        The add-on data object passed into the startup() function.
   */
  registerResourceHost: function registerResourceHost(host, data) {
    this._resProtocolHandler.setSubstitution(host, data.resourceURI);
    this.registerUnloader(function () {
      this._resProtocolHandler.setSubstitution(host, null);
    });
  },

  /**
   * Define default preferences.
   * 
   * @param prefix
   *        The prefix to be used for all prefs, e.g. "extensions.foobar."
   * @param prefs
   *        An object containing a mapping from pref names to their default
   *        values, e.g. {number: 1, string: "hai", bool: true}
   * 
   * @note At clean up time, the entire pref branch denoted by @param prefix
   * is removed.
   */
  registerDefaultPrefs: function registerDefaultPrefs(prefix, prefs) {
    let branch = Services.prefs.getDefaultBranch(prefix);
    for (let [name, value] in Iterator(prefs)) {
      switch (typeof value) {
        case "boolean":
          branch.setBoolPref(name, value);
          break;
        case "number":
          branch.setIntPref(name, value);
          break;
        case "string":
          branch.setCharPref(name, value);
          break;
      }
    }
    this.registerUnloader(function () {
      branch.deleteBranch("");
    });
  },

  /**
   * Register an 'about:...' page.
   * 
   * @param name
   *        The name of the 'about' page.
   * @param uri
   *        The URI (string) of the page that should appear. Typically this is
   *        a chrome:// URI.
   */
  registerAboutPage: function registerAboutPage(name, uri) {
    let cid = this._uuidGenerator.generateUUID();
    let redirector = new AboutRedirector(cid, name, uri);
    redirector.register();
    this.registerUnloader(function () {
      redirector.unload();
    });
  },

  /**
   * Register an observer with the nsIObserverService.
   * 
   * @param topic
   *        Topic to listen to.
   * @param callback
   *        Function that gets called when notifications for the topic fire.
   */
  registerObserver: function registerObserver(topic, callback) {
    Services.obs.addObserver(callback, topic, false);
    this.registerUnloader(function () {
      Services.obs.removeObserver(callback, topic);
    });
  },

  /**
   * Register an event handler on a DOM node.
   * 
   * @param element
   *        The DOM node.
   * @param event
   *        The name of the event, e.g. 'click'.
   * @param callback
   *        The event handler function.
   * @param capture
   *        Boolean flag to indicate whether to use capture or not.
   * 
   * @return a function that, when called, removes the event handler again.
   * 
   * @note When the window that the DOM node belongs to is closed, the
   * event handler will automatically be removed. It will not be removed
   * if the DOM node is removed from the document. The returned function
   * must be called in this case.
   */
  registerEventListener:
  function registerEventListener(element, event, callback, capture) {
    node.addEventListener(event, func, !!capture);
    let window = element.ownerDocument.defaultView;
    function removeListener() {
      node.removeEventListener(event, func, !!capture);
    }
    let removeUnloader = this.registerUnloader(removeListener, window);
    return function removeEventListener() {
      removeListener();
      removeUnloader();
    };
  },

  /**
   * Apply callback to all existing and future windows of a certain type.
   * 
   * @param type
   *        The window type, e.g. "navigator:browser" for the browser window.
   * @param callback
   *        The function to invoke. It will be called with the window object
   *        as its only parameter.
   */
  watchWindows: function watchWindows(type, callback) {
    // Wrap the callback in a function that ignores failures.
    function watcher(window) {
      try {
        let documentElement = window.document.documentElement;
        if (documentElement.getAttribute("windowtype") == type) {
          callback(window);
        }
      } catch(ex) {
        // Ignore.
      }
    }

    // Wait for the window to finish loading before running the callback.
    function runOnLoad(window) {
      // Listen for one load event before checking the window type
      window.addEventListener("load", function runOnce() {
        window.removeEventListener("load", runOnce, false);
        watcher(window);
      }, false);
    }

    // Enumerating existing windows.
    let windows = Services.wm.getEnumerator(type);
    while (windows.hasMoreElements()) {
      // Only run the watcher immediately if the window is completely loaded
      let window = windows.getNext();
      if (window.document.readyState == "complete") {
        watcher(window);
      } else {
        // Wait for the window to load before continuing
        runOnLoad(window);
      }
    }

    // Watch for new browser windows opening.
    function windowWatcher(subject, topic) {
      if (topic == "domwindowopened") {
        runOnLoad(subject);
      }
    }
    Services.ww.registerNotification(windowWatcher);
    this.registerUnloader(function () {
      Services.ww.unregisterNotification(windowWatcher);
    });
  },

  //TODO import + unload JSMs?
  //TODO l10n stringbundles
  //TODO stylesheets?
};
XPCOMUtils.defineLazyGetter(PullStarter, "_resProtocolHandler", function () {
  return Services.io.getProtocolHandler("resource")
                 .QueryInterface(Components.interfaces.nsIResProtocolHandler);
});
XPCOMUtils.defineLazyServiceGetter(PullStarter, "_uuidGenerator",
                                   "@mozilla.org/uuid-generator;1",
                                   "nsIUUIDGenerator");


/**
 * An XPCOM thing to help redirector about:... pages to an underlying URI.
 */
function AboutRedirector(cid, name, uri) {
  this.cid = cid;
  this.name = name;
  this.uri = Services.io.newURI(uri);
}
AboutRedirector.prototype = {
  QueryInterface: XPCOMUtils.generateQI([
    Components.interfaces..nsIAboutModule,
    Components.interfaces..nsISupportsWeakReference
  ]),

  register: function register() {
    let registrar = Components.manager.QueryInterface(
      Components.interfaces.nsIComponentRegistrar);
    registrar.registerFactory(
      this.cid, "AboutSyncKey",
      "@mozilla.org/network/protocol/about;1?what=" + this.name, this);
  },

  unload: function unload() {
    let registrar = Components.manager.QueryInterface(
      Components.interfaces.nsIComponentRegistrar);
    registrar.unregisterFactory(this.cid, this);
  },

  // nsIAboutModule

  getURIFlags: function getURIFlags(aURI) {
    return 0;
  },

  newChannel: function newChannel(aURI) {
    let channel = Services.io.newChannelFromURI(this.uri);
    channel.originalURI = aURI;
    return channel;
  },

  // nsIFactory

  createInstance: function createInstance(outer, iid) {
    if (outer != null) {
      throw Comopnents.results.NS_ERROR_NO_AGGREGATION;
    }
    return this.QueryInterface(iid);
  }
};


/*** Default implementations for bootstrapping functions ***/

function shutdown() {
  if (reason == APP_SHUTDOWN) {
    return;
  }
  PullStarter.unload();
}

function install() {
}

function uninstall() {
}
