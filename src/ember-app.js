'use strict';

const fs = require('fs');

const debug = require('debug')('fastboot:ember-app');

const FastBootInfo = require('./fastboot-info');
const Result = require('./result');
const bundle = require('./bundle');

const hasOwnProperty = Object.prototype.hasOwnProperty; // jshint ignore:line

/**
 * The `EmberApp` class serves as a non-sandboxed wrapper around a sandboxed
 * `Ember.Application`. This bridge allows the PowerBoot to quickly spin up new
 * `ApplicationInstances` initialized at a particular route, then destroy them
 * once the route has finished rendering.
 *
 * @class EmberApp 
 * @private
 */
class EmberApp {
  /**
   * Create a new EmberApp.
   * 
   * @param {Object} options
   * @param {string} options.config - The Ember application config.
   * @param {Sandbox} [options.sandbox=VMSandbox] - Sandbox to use.
   * @param {Object} [options.sandboxGlobals] - Sandbox variables that can be added or used for overrides in the sandbox.
   */
  constructor(options) {
    let config = options.config;

    this.appFilePaths = config.appFiles;
    this.vendorFilePaths = config.vendorFiles;
    this.moduleWhitelist = config.moduleWhitelist;
    this.hostWhitelist = config.hostWhitelist;
    this.config = Object.assign({}, config.config);
    this.appName = config.appName;
    this.schemaVersion = config.schemaVersion;
    this.sandboxGlobals = options.sandboxGlobals || {};
    this.page = options.page;
    this.html = fs.readFileSync(config.htmlFile, 'utf8');
    this._hasInitialized = false;
  }

  /**
   * Creates a new application instance and renders the instance at a specific
   * URL, returning a promise that resolves to a {@link Result}. The `Result`
   * gives you access to the rendered HTML as well as metadata about the
   * request such as the HTTP status code.
   *
   * If this call to `visit()` is to service an incoming HTTP request, you may
   * provide Node's `ClientRequest` and `ServerResponse` objects as options
   * (e.g., the `res` and `req` arguments passed to Express middleware).  These
   * are provided to the Ember application via the FastBoot service.
   *
   * @param {string} path the URL path to render, like `/photos/1`
   * @param {Object} options
   * @param {string} [options.html] the HTML document to insert the rendered app into
   * @param {Object} [options.metadata] Per request specific data used in the app.
   * @param {Boolean} [options.shouldRender] whether the app should do rendering or not. If set to false, it puts the app in routing-only.
   * @param {Boolean} [options.disableShoebox] whether we should send the API data in the shoebox. If set to false, it will not send the API data used for rendering the app on server side in the index.html.
   * @param {Integer} [options.destroyAppInstanceInMs] whether to destroy the instance in the given number of ms. This is a failure mechanism to not wedge the Node process (See: https://github.com/ember-fastboot/fastboot/issues/90)
   * @param {ClientRequest} [options.request]
   * @param {ClientResponse} [options.response]
   * @returns {Promise<Result>} result
   */
  async visit(path, options) {
    let {
      request,
      response,
      html,
      disableShoebox,
      destroyAppInstanceInMs,
      shouldRender,
      metadata
    } = options;

    html = html || this.html;
    disableShoebox = disableShoebox || false;
    destroyAppInstanceInMs = parseInt(options.destroyAppInstanceInMs, 10);
    shouldRender = (shouldRender !== undefined) ? shouldRender : true;

    const bootOptions = buildBootOptions(shouldRender);

    const info = new FastBootInfo(
      request,
      response,
      { hostWhitelist: this.hostWhitelist, metadata }
    );

    const result = new Result({ page: this.page });

    await result.setContent(html, { waitUntil: 'load' });

    let destroyAppInstanceTimer,
        didDestroy = false;
    if (destroyAppInstanceInMs > 0) {
      // Start a timer to destroy the appInstance forcefully in the given ms.
      // This is a failure mechanism so that node process doesn't get wedged if the `visit` never completes.
      destroyAppInstanceTimer = setTimeout(async () => {
        didDestroy = true;
        try {
          await this.page.reload({ waitUntil: ['domcontentloaded'] });
          result.error = new Error('App instance was forcefully destroyed in ' + destroyAppInstanceInMs + 'ms');
        } catch(error) {
          // Don't panic on a normal error that can happen here but doesn't seem
          // to affect PowerBoot's capacity to continue serving pages.
          if (!error.message.match(/Navigation failed because browser has disconnected/)) {
            result.error = error;
          }
        }
        this._hasInitialized = false;
      }, destroyAppInstanceInMs);
    }

    try {
      await clearPageStorage(this.page);
      await this._visitRoute(path, info, bootOptions, disableShoebox, result);
    } catch(error) {
      // These are errors that may happen if the destroyAppInstance timer fires,
      // usually while _visitRoute is still performing.
      const isNormalError = didDestroy && (
        error.message.match(/Execution context was destroyed/) ||
        error.message.match(/Navigation failed because browser has disconnected/)
      );
      if (!isNormalError) result.error = error;
    } finally {
      if (destroyAppInstanceTimer) {
        clearTimeout(destroyAppInstanceTimer);
      }
    }
    return result;
  }

  /**
   *
   * Main function that creates the app instance for every `visit` request, boots
   * the app instance and then visits the given route and destroys the app instance
   * when the route is finished its render cycle.
   *
   * Ember apps can manually defer rendering in FastBoot mode if they're waiting
   * on something async the router doesn't know about. This function fetches
   * that promise for deferred rendering from the app.
   *
   * @method _visitRoute
   * @private
   * 
   * @param {string} path the URL path to render, like `/photos/1`
   * @param {Object} fastbootInfo An object holding per request info
   * @param {Object} bootOptions An object containing the boot options that are used by
   *                             by ember to decide whether it needs to do rendering or not.
   * @param {Object} result
   * @return {Promise<instance>} instance
   */
  async _visitRoute(path, info, bootOptions, disableShoebox, result) {
    if (!this.hasInitialized) {
      this.hasInitialized = true;
      await result.evaluate(sandboxGlobals => {
        Object.assign(window, sandboxGlobals);
      }, this.sandboxGlobals);
      await initializeAppEnvironment(result, this.appName, this.config);
      await loadAppFiles(result, this.appFilePaths, this.vendorFilePaths);
      this._bundle = this._bundle || await bundle();
      // Define FastBootInfo
      await result.evaluate(this._bundle);
    }
    let returnedInfo = [{ headers: {} },{},{}], error;
    try {
      // If runAppInstance returns nothing, that means the page
      // was terminated early.
      returnedInfo = (await runAppInstance(result, path, bootOptions, info)) || returnedInfo;
    } catch(err){
      error = err;
    }
    const fastbootInfo = new FastBootInfo(...returnedInfo);
    result._fastbootInfo = fastbootInfo;
    if (!disableShoebox) {
      // if shoebox is not disabled, then create the shoebox and send API data
      await createShoebox(result, fastbootInfo);
    }
    await result._finalize();
    if(error) throw error;
  }

  /**
   * Destroys the app instance by closing the browser page and
   * setting the `page` property to null.
   * 
   * @method destroy
   */
  destroy() {
    this.page.close();
    this.page = null;
  }
}

/**
 * Loads the app and vendor files in the sandbox (Node vm).
 * 
 * @function loadAppFiles
 * @param {Result} result
*/
async function loadAppFiles(result, appFilePaths, vendorFilePaths) {
  debug("evaluating app and vendor files");

  for(const vendorFilePath of vendorFilePaths){
    debug("evaluating vendor file %s", vendorFilePath);
    let vendorFile = fs.readFileSync(vendorFilePath, 'utf8');
    await result.evaluate(vendorFile);
  }
  debug("vendor file evaluated");

  for(const appFilePath of appFilePaths){
    debug("evaluating app file %s", appFilePath);
    let appFile = fs.readFileSync(appFilePath, 'utf8');
    await result.evaluate(appFile);
  }
  debug("app files evaluated");
}

/**
 * Builds an object with the options required to boot an ApplicationInstance in
 * FastBoot mode.
 * 
 * @function buildOptions
 * @param {Boolean} shouldRender
 */
function buildBootOptions(shouldRender) {
  let _renderMode = process.env.EXPERIMENTAL_RENDER_MODE_SERIALIZE ? 'serialize' : undefined;

  return {
    location: 'none',
    isBrowser: true,
    shouldRender,
    _renderMode
  };
}

/**
 * Writes the shoebox into the DOM for the browser rendered app to consume.
 * Uses a script tag with custom type so that the browser will treat as plain
 * text, and not expend effort trying to parse contents of the script tag.
 * Each key is written separately so that the browser rendered app can
 * parse the specific item at the time it is needed instead of everything
 * all at once.
 * 
 * @function createShoebox
 * @param {Result} result
 * @param {FastbootInfo} fastbootInfo
 */
async function createShoebox(result, fastbootInfo) {
  let shoebox = fastbootInfo.shoebox;
  if (!shoebox) { return; }

  for (let key in shoebox) {
    if (!hasOwnProperty.call(shoebox, key)) { continue; } // TODO: remove this later #144, ember-fastboot/ember-cli-fastboot/pull/417
    let value = shoebox[key];
    let textValue = JSON.stringify(value);
    textValue = escapeJSONString(textValue);

    await result.evaluate(async (key, textValue) => {
      document.body.insertAdjacentHTML('beforeend', 
        `<script type="fastboot/shoebox" id="shoebox-${key}">${textValue}</script>`);
    }, key, textValue);
  }
}

const JSON_ESCAPE = {
  '&': '\\u0026',
  '>': '\\u003e',
  '<': '\\u003c',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
};

const JSON_ESCAPE_REGEXP = /[\u2028\u2029&><]/g;

/**
 * Excapes a JSON string using entities so that certain
 * characters don't break the HTML.
 * 
 * @function escapeJSONString
 * @param {string} string
 */
function escapeJSONString(string) {
  return string.replace(JSON_ESCAPE_REGEXP, function(match) {
    return JSON_ESCAPE[match];
  });
}

/**
 * Sets up the browser page so that the actual Ember app has everything
 * it needs in order to run properly.  This currently means adding the 
 * app config to a meta tag and shimming `window.FastBoot`.
 * 
 * @function initializeAppEnvironment
 * @param {Result} result 
 * @param {string} appName 
 * @param {Object} config 
 */
async function initializeAppEnvironment(result, appName, config){
  await result.evaluate(async (appName, config={}) => {
    const envPath   = `${appName}/config/environment`,
          appConfig = document.querySelector(`meta[name="${envPath}"]`) || document.createElement('meta');
    appConfig.setAttribute('name', envPath);
    appConfig.setAttribute('content', encodeURIComponent(JSON.stringify(config[appName])));
    document.head.append(appConfig);
    window.FastBoot = {
      config: function(key){
        if (!key) {
          // default to app key
          key = appName;
        }
        return { default: config[key] };
      },
      require: function(name){
        /**
         * FIXME: We whouldn't have to undo the AbortController or
         * fetch polyfills but for now it's the most expedient way
         * to prevent the application from calling node-fetch in the
         * browser without causing incompatibility with Fastboot.
         */
        if(name === 'abortcontroller-polyfill/dist/cjs-ponyfill') return {
          AbortController: window.AbortController
        };
        if(name === 'node-fetch') return window.fetch;
        return window.require(...arguments);
      }
    };
  }, appName, config);
}

/**
 * Runs the actual Ember app instance in the browser page,
 * injects the Fastboot service, visits the path, and collects
 * response data for FastbootInfo.
 * 
 * @param {Result} result 
 * @param {string} path 
 * @param {Object} bootOptions 
 * @param {FastbootInfo} info 
 */
async function runAppInstance(result, path, bootOptions, info){
  return await result.evaluate(async (path, bootOptions, info) => {
    const fastbootInfo = new FastBootInfo(...info),
          // eslint-disable-next-line node/no-missing-require
          appFactory = require('~fastboot/app-factory'),
          App = appFactory['default']();
    await App.runInitializers();
    const instance = await App.buildInstance();
    instance.register('info:-fastboot', fastbootInfo, { instantiate: false });
    instance.inject('service:fastboot', '_fastbootInfo', 'info:-fastboot');
    document.cookie = fastbootInfo.request ? fastbootInfo.request.headers.get('Cookie') : '';
    await instance.boot(bootOptions);
    await instance.visit(path);
    await fastbootInfo.deferredPromise;
    return fastbootInfo.serialize();
  }, path, bootOptions, Array.isArray(info) ? info : info.serialize());
}

async function clearPageStorage(page) {
  await page.evaluate(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.cookie = '';
    const databases = await window.indexedDB.databases();
    for (const database of databases)
      window.indexedDB.deleteDatabase(databases[database].name);
  });
}

module.exports = EmberApp;
