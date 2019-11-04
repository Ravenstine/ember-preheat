'use strict';

const SHOEBOX_TAG_PATTERN = '<script type="fastboot/shoebox"';
const HTML_HEAD_REGEX = /^([\s\S]*<\/head>)([\s\S]*)/;

/**
 * Represents the rendered result of visiting an Ember app at a particular URL.
 * A `Result` object is returned from calling {@link FastBoot}'s `visit()`
 * method.
 */
class Result {
  constructor(options) {
    this._page = options.page;
    this._instanceDestroyed = false;
    this._fastbootInfo = options.fastbootInfo;
  }

  /**
   * The status code of the response.
   * 
   * @prperty statusCode
   * @type Number
   */
  get statusCode(){
    if(!this._fastbootInfo || !this._fastbootInfo.response) return undefined;
    return this._fastbootInfo.response.statusCode;
  }

  /**
   * The response headers.
   * 
   * @property headers
   * @type FastBootHeaders
   */
  get headers(){
    if(!this._fastbootInfo || !this._fastbootInfo.response) return undefined;
    return this._fastbootInfo.response.headers;
  }

  /**
   * Sets the content of the page.
   * 
   * @method setContent
   * @returns Promise
   */
  async setContent(){
    if(this._instanceDestroyed) return;
    await tryWithPageAwareness(async () => {
      await this._page.setContent(...arguments, { waitUntil: 'load'});
      await this._reflectContents();
    });
  }

  /**
   * Evaluates JavaScript within the page.
   * 
   * @method evaluate
   * @returns Promise
   */
  async evaluate(){
    if(this._instanceDestroyed) return;
    return await tryWithPageAwareness(async () => {
      const evalResult = await this._page.evaluate(...arguments);
      await this._reflectContents();
      return evalResult;
    });
  }

  async _reflectContents(){
    const [ html, head, body ] = await this._page.evaluate(() => {
      const fastbootBodyStart = document.getElementById('fastboot-body-start');
      if(fastbootBodyStart) fastbootBodyStart.remove();
      const fastbootBodyEnd = document.getElementById('fastboot-body-end');
      if(fastbootBodyEnd) fastbootBodyEnd.remove();
      document.body.insertAdjacentHTML('afterbegin', '<script type="x/boundary" id="fastboot-body-start"></script>');
      document.body.insertAdjacentHTML('beforeend', '<script type="x/boundary" id="fastboot-body-end"></script>');
      const bodyScripts = document.body.querySelectorAll('body > script[src]');
      for(const script of bodyScripts) document.body.append(script);
      return [ document.querySelector('html').outerHTML, 
               document.head.innerHTML,
               document.body.innerHTML ];
    });
    this._html = html;
    this._head = head;
    this._body = body;
  }

  /**
   * Returns the HTML representation of the rendered route, inserted
   * into the application's `index.html`.
   *
   * @returns {Promise<String>} the application's DOM serialized to HTML
   */
  async html() {
    let response = this._fastbootInfo.response;
    let statusCode = response && this._fastbootInfo.response.statusCode;

    if (statusCode === 204) {
      this._html = '';
      this._head = '';
      this._body = '';
    } else if (statusCode >= 300 && statusCode <= 399) {
      let location = response.headers.get('location');

      this._html = '<html><head></head><body><!-- EMBER_CLI_FASTBOOT_BODY --></body></html>';
      this._head = '';
      this._body = '';

      if (location) {
        this._html = `<html><head></head><body><h1>Redirecting to <a href="${location}">${location}</a></h1></body></html>`;
      }
    }

    return this._html;
  }

  /**
   * Returns the HTML representation of the rendered route, inserted
   * into the application's `index.html`, split into chunks.
   * The first chunk contains the document's head, the second contains the body
   * until just before the shoebox tags (if there are any) and the last chunk
   * contains the shoebox tags and the closing `body` tag. If there are no
   * shoebox tags, there are only 2 chunks and the second one contains the
   * complete document body, including the closing `body` tag.
   *
   * @returns {Promise<Array<String>>} the application's DOM serialized to HTML, split into chunks
   */
  async chunks() {
    const html = this._html;
    let docParts = html.match(HTML_HEAD_REGEX);
    if (!docParts || docParts.length === 1) {
      return [html];
    }

    let head = docParts[1];
    let body = docParts[2];

    if (!head || !body) {
      throw new Error('Could not idenfity head and body of the document! Make sure the document is well formed.');
    }

    let chunks = [head];
    let bodyParts = body.split(SHOEBOX_TAG_PATTERN);
    let plainBody = bodyParts[0];
    chunks.push(plainBody);

    let shoeboxes = bodyParts.splice(1);
    
    shoeboxes.forEach((shoebox) => {
      chunks.push(`${SHOEBOX_TAG_PATTERN}${shoebox}`);
    });

    return chunks;
  }

  /**
   * Returns the serialized representation of DOM HEAD and DOM BODY
   *
   * @returns {Object} serialized version of DOM
   */
  domContents() {
    return {
      head: this._head,
      body: this._body
    };
  }

  /**
   * @private
   *
   * Called once the Result has finished being constructed and the application
   * instance has finished rendering. Once `finalize()` is called, state is
   * gathered from the completed application instance and statically copied
   * to this Result instance.
   */
  async _finalize() {
    if (this.finalized) {
      throw new Error("Results cannot be finalized more than once");
    }

    // Grab some metadata from the sandboxed application instance
    // and copy it to this Result object.
    let instance = this.instance;
    if (instance) {
      this._finalizeMetadata(instance);
    }

    await this.evaluate(() => {
      const appElements = document.querySelectorAll('.ember-application');
      for(const element of appElements){
        element.classList.remove('ember-application');
      }
    });

    this.finalized = true;
    return this;
  }

  _finalizeMetadata(instance) {
    if (instance._booted) {
      this.url = instance.getURL();
    }

    let response = this._fastbootInfo.response;

    if (response) {
      this.headers = response.headers;
      this.statusCode = response.statusCode;
    }
  }
}

/* Treats a terminated page as something to be expected. */
async function tryWithPageAwareness(callback){
  try {
    return await callback();
  } catch(err){
    if(err.message && !err.message.match(/(Target|Session) closed\./)) throw err;
  }
}

module.exports = Result;
