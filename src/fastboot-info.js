'use strict';

const FastBootRequest = require('./fastboot-request');
const FastBootResponse = require('./fastboot-response');

/**
 * A class that encapsulates information about the
 * current HTTP request from FastBoot. This is injected
 * on to the FastBoot service.
 *
 * @class FastBootInfo
 * @param {ClientRequest} request - the incoming request object
 * @param {ClientResponse} response - response object
 * @param {Object} options - additional options passed to fastboot info
 * @param {Array} [options.hostWhitelist] - expected hosts in your application
 * @param {Object} [options.metaData] - per request meta data
 */
class FastBootInfo {
  constructor(request, response, options, shoebox) {
    this._options = options;
    this.deferredPromise = Promise.resolve();
    let hostWhitelist = options.hostWhitelist;
    let metadata = options.metadata;
    if (request) {
      this.request = new FastBootRequest(request, hostWhitelist);
    }
    this.response = new FastBootResponse(response || {});
    this.metadata = metadata;
    this.shoebox = shoebox;
  }

  /**
   * Defers rendering until the provided promise resolves.
   * 
   * @method deferRendering
   * @param {Promise} promise
   * @returns {Promise}
   */
  deferRendering(promise) {
    this.deferredPromise = this.deferredPromise.then(function() {
      return promise;
    });
  }
  
  /**
   * Converts all info contained in the FastBootInfo instance to
   * a plain old JavaScript object.
   * 
   * @method serialize
   * @returns {Object}
   */
  serialize(){
    return [
      this.request ? this.request.serialize() : undefined,
      this.response ? this.response.serialize() : undefined,
      {
        hostWhitelist: (this.request || {}).hostWhitelist,
        metadata: this.metadata
      },
      this.shoebox
    ];
  }

}


module.exports = FastBootInfo;
