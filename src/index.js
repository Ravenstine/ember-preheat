'use strict';

const EmberApp  = require('./ember-app'),
      puppeteer = require('puppeteer'),
      http      = require('http'),
      { 
        CHROMIUM_FLAGS,
        readPackageJSON,
        isNil
      } = require('./utils'),
      DEFAULT_PUPPETEER_OPTIONS = { 
                                    devtools: false, 
                                    args:  CHROMIUM_FLAGS,
                                    pipe: true
                                  },
      { assign } = Object;

/**
 * PowerBoot renders your Ember.js applications in Node.js using
 * headless Chromium. Start by instantiating this class with the
 * path to your compiled Ember app:
 *
 *
 * By default, this browser is the built-in browser object created by
 * Puppeteer. You may provide your own browser implementation by
 * passing the `browser` option or add and/or override global/window 
 * variables by passing the `sandboxGlobals` option.
 *
 * @example
 * const PowerBoot = require('powerboot');
 *
 * let app = new PowerBoot({
 *   distPath: 'path/to/dist',
 *   browser: '<puppeteer browser instance>'
 *   sandboxGlobals: {...}
 * });
 *
 * app.visit('/photos')
 *   .then(result => result.html())
 *   .then(html => res.send(html));
 */

class PowerBoot {
  /**
   * Create a new FastBoot instance.
   * @param {Object} options
   * @param {string} options.distPath the path to the built Ember application
   * @param {Boolean} [options.resilient=false] if true, errors during rendering won't reject the `visit()` promise but instead resolve to a {@link Result}
   * @param {Sandbox} [options.browser=Puppeteer.Browser] the browser instance to use
   * @param {Object} [options.sandboxGlobals={}] any additional sandbox variables that an app server wants to override and/or add in the browser
   * @param {Object} [options.puppeteer] Options for Puppeteer that will override the default options.  This won't apply if you pass your own Puppeteer.Browser instance through `options.browser`.
   */
  constructor(options={}) {
    this._cleanupListener = this.close.bind(this, { cleanup: true });
    this._exitListener    = this.close.bind(this, { exit: true });
    this._isWorking = false;
    this._instance = null;
    this._appConfig = null;
    this._shouldDestroyInstance = false;

    options.distPath = options.distPath || null;

    this._setOptions(options);

    process.on('exit', this._cleanupListener);
    process.on('SIGINT', this._exitListener);
    process.on('SIGUSR1', this._exitListener);
    process.on('SIGUSR2', this._exitListener);
    process.on('uncaughtException', this._exitListener);
  }

  /**
   * Renders the Ember app at a specific URL, returning a promise that resolves
   * to a {@link Result}, giving you access to the rendered HTML as well as
   * metadata about the request such as the HTTP status code.
   * 
   * Will create a new browser instance with Puppeteer if none provided by either the
   * PowerBoot instance or the options passed.
   *
   * @param {string} path the URL path to render, like `/photos/1`
   * @param {Object} options
   * @param {Boolean} [options.resilient] whether to reject the returned promise if there is an error during rendering. Overrides the instance's `resilient` setting
   * @param {string} [options.html] the HTML document to insert the rendered app into. Uses the built app's index.html by default.
   * @param {Object} [options.metadata] per request meta data that need to be exposed in the app.
   * @param {Boolean} [options.shouldRender] whether the app should do rendering or not. If set to false, it puts the app in routing-only.
   * @param {Boolean} [options.disableShoebox] whether we should send the API data in the shoebox. If set to false, it will not send the API data used for rendering the app on server side in the index.html.
   * @param {Integer} [options.destroyAppInstanceInMs] whether to destroy the instance(i.e. the browser page) in the given number of ms. This is a failure mechanism to not wedge the Node process (See: https://github.com/ember-fastboot/fastboot/issues/90)
   * @returns {Promise<Result>} result
   */
  async visit(path, options) {
    options = options || {};

    let resilient = options.resilient;

    if (resilient === undefined) {
      resilient = this.config.resilient;
    }

    /*
     * We create an HTTP server on a random port so that the
     * browser page can navigate to an actual host, thereby
     * allowing the Ember app to use features like localStorage
     * without causing SecurityError exceptions to be thrown.
     */
    this._httpServer = this._httpServer || await new Promise(resolve => {
      const server = http.createServer((req, res) => res.end());
      server.listen(0, '0.0.0.0', resolve(server));
    });

    if(!options.browser && !this.config.browser){
      const puppeteerOptions = assign({}, DEFAULT_PUPPETEER_OPTIONS, this.config.puppeteer || {});
      this.config.browser = await puppeteer.launch(puppeteerOptions);
    }

    let instance;
    for (const promise of this._getAvailableOrNewInstance()) {
      instance = await promise;
      if (instance) break;
    }

    const result = await instance.visit(path, options);
    this._releaseInstance();

    if (!resilient && result.error) {
      throw result.error;
    } else {
      return result;
    }
  }

  /**
   * Destroys available app instances and sets working instances to
   * be destroyed when they are done with their current work.
   * 
   * Can also be used to modify the options for the PowerBoot instance,
   * which will be applied to new Ember app instances that take the
   * place of the ones being destroyed here.
   * 
   * @param {Object|null} options 
   */
  async reload(options={}) {
    this._setOptions(options);
    this._shouldDestroyInstance = true;
    if (!this._instance) return;
    if (this._isWorking) {
      this._shouldDestroyInstance = true;
      return;
    }
    this._releaseInstance();
  }

  /** 
   * Terminates the browser instance and removes cleanup listeners.
   * 
   * @method close
   * @returns {Promise}
   */
  async close(){
    if(!isNil(this.config.browser)) await this.config.browser.close();
    if(!isNil(this._httpServer)) await this._httpServer.close();
    if (process && process.off) {
      process.off('exit', this._cleanupListener);
      process.off('SIGINT', this._exitListener);
      process.off('SIGUSR1', this._exitListener);
      process.off('SIGUSR2', this._exitListener);
      process.off('uncaughtException', this._exitListener);
    }
  }

  /**
   * Sets options from an options-object and either throws an error
   * or sets a default value for the option.
   * 
   * @method _setProperties
   * @private
   * @param {Object} options 
   */
  _setOptions(options) {
    this.config = assign({}, this.config || {});
    if (!options) throw new Error('An `options` object was expected but not found.');
    if (options.hasOwnProperty('distPath')) {
      if (isNil(options.distPath)) {
        throw new Error('You must provide PowerBoot with a distPath ' +
                        'option that contains a path to a dist directory ' +
                        'produced by running ember fastboot:build in your Ember app:' +
                        '\n\n' +
                        'new PowerBoot({\n' +
                        '  distPath: \'path/to/dist\'\n' +
                        '});');
      }
      this.config.distPath = options.distPath;
      this._appConfig = readPackageJSON(options.distPath);
    }
    this._setOption(options, 'browser', null);
    this._setOption(options, 'sandboxGlobals', {});
    this._setOption(options, 'resilient', false);
    this._setOption(options, 'disableShoebox', false);
    this._setOption(options, 'puppeteer', {});
  }

  /**
   * Sets an option, sets a default(if one is provided), or throws an error.
   * 
   * @method _setOption
   * @private
   * @param {Object} options 
   * @param {string} key 
   * @param {*} _default 
   */
  _setOption(options, key, _default) {
    const hasDefault = arguments.length === 3;
    setOption: if (options.hasOwnProperty(key)) {
      if (options[key]) {
        this.config[key] = options[key];
      } else if (hasDefault) {
        break setOption;
      } else {
        throw new Error(`The option \`${key}\` was provided is null or undefined.`);
      }
      return;
    }
    if (hasDefault) this.config[key] = this.config[key] || _default;
  }

  /**
   * Waits for the app instance to become available, or creates one, and yields it.
   * Otherwise, it will yield a promise to be waited on.
   * 
   * @method _getAvailableOrNewInstance
   * @private
   * @yields {EmberApp|Promise}
   */
  *_getAvailableOrNewInstance() {
    const { _appConfig, config: { sandboxGlobals } } = this;
    while(true) {
      if (!this._instance && this._httpServer) {
        yield this.config.browser.newPage().then(async page => {
          const { address, port } = this._httpServer.address();
          await page.goto(`http://${address}:${port}`);
          this._instance = new EmberApp({ page, config: _appConfig, sandboxGlobals });
          return this._instance;
        });
      }
      if (this._instance && !this.isWorking) {
        this.isWorking = true;
        yield true;
        break;
      }
      yield new Promise(resolve => {
        setImmediate(() => resolve(null));
      });
    }
  }

  /**
   * Takes a formerly-working app instance and makes it available for other use,
   * unless that instance has been marked for destruction, in which case it is
   * destroyed and disposed of.
   * 
   * @method _releaseInstance
   * @private
   */
  _releaseInstance() {
    if (this._shouldDestroyInstance) {
      this._instance.destroy();
      this._instance = null;
      this._shouldDestroyInstance = false;
    }
    this.isWorking = false;
  }

}

module.exports = PowerBoot;
