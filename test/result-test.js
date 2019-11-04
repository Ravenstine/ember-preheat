var expect = require('chai').expect;
var Result = require('./../src/result.js');
var FastBootInfo = require('./../src/fastboot-info.js');
var puppeteer = require('puppeteer');


describe('Result', async function() {
  var result, browser;

  before(async function(){
    browser = await puppeteer.launch({ devtools: false, args: [ '--disable-web-security' ] });
  });

  after(async function(){
    if(typeof browser !== 'undefined') browser.close();
  });

  beforeEach(async function () {
    var req = { headers: {}, get() {} };
    const page = await browser.newPage();

    result = new Result({
      page,
      fastbootInfo: new FastBootInfo(req, {}, [ 'example.com' ])
    });

    await result.setContent(`
      <html>
        <head>
          <!-- EMBER_CLI_FASTBOOT_HEAD -->
        </head>
        <body>
          <!-- EMBER_CLI_FASTBOOT_BODY -->
        </body>
      </html>
    `);
  });

  it('constructor', function () {
    expect(result).to.be.a('object');
    expect(result._page).to.be.a('object');
    expect(result._html).to.be.a('string');
    expect(result._fastbootInfo).to.be.an.instanceOf(FastBootInfo);
  });

  describe('html()', async function () {

    describe('when the response status code is 204', function () {
      beforeEach(function () {
        result._fastbootInfo.response.statusCode = 204;
        result._finalize();
      });

      it('should return an empty message body', function () {
        return result.html()
          .then(function (result) {
            expect(result).to.equal('');
          });
      });
    });

    describe('when the response status code is 3XX', function () {
      beforeEach(function () {
        result._fastbootInfo.response.headers.set('location', 'http://some.example.com/page');
        result._fastbootInfo.response.statusCode = 307;
        result._finalize();
      });

      it('should return a document body with redirect information', function () {
        return result.html()
        .then(function (result) {
          expect(result).to.include('<body>');
          expect(result).to.include('Redirecting to');
          expect(result).to.include('http://some.example.com/page');
          expect(result).to.include('</body>');
        });
      });
    });

    describe('when the response status code is not 3XX or 204', function () {
      var HEAD = '<meta name="foo" content="bar">';
      var BODY = '<h1>A normal response document</h1>';
      var HTML = `
        <html>
        <head>
          ${HEAD}
        </head>
        <body>
          ${BODY}
        </body>
        </html
      `;

      beforeEach(async function () {
        await result.setContent(HTML);
        result._fastbootInfo.response.statusCode = 418;
        result._finalize();
      });

      it('should return the FastBoot-rendered document body', function () {
        return result.html()
        .then(function (result) {
          expect(result).to.include(HEAD);
          expect(result).to.include(BODY);
        });
      });
    });

    describe('when the document has special-case content', async function () {
      var BODY = '<h1>A special response document: $$</h1>';
      beforeEach(async function () {
        await result.evaluate((BODY) => {
          document.body.insertAdjacentHTML('beforeend', BODY);
        }, BODY);
        result._fastbootInfo.response.statusCode = 418;
        await result._finalize();
      });

      it('it should handle \'$$\' correctly (due to `String.replace()` gotcha)', function () {
        return result.html()
        .then(function (result) {
          expect(result).to.include(BODY);
        });
      });
    });
    
  });

  describe('chunks()', function() {
    var HEAD = '<meta name="foo" content="bar">';
    var BODY = '<h1>A normal response document</h1>';
    var HTML = `
      <html>
      <head>
        ${HEAD}
      </head>
      <body>
        ${BODY}
      </body>
      </html
    `;

    beforeEach(async function () {
      await result.setContent(HTML);
      result._fastbootInfo.response.statusCode = 200;
      result._finalize();
    });

    describe('when there is no shoebox', function() {
      beforeEach(async function () {
        await result.setContent(HTML);
        // await result._finalize();
      });

      it('returns chunks for the head and body', function() {
        return result.chunks()
        .then(function (result) {
          expect(result.length).to.eq(2);
          expect(result[0]).to.match(new RegExp(`<html>\\s*<head>\\s*${HEAD}\\s*</head>\\s*`, 'im'));
          expect(result[1]).to.match(new RegExp(`\\s*<body>\\s*<script type="x/boundary" id="fastboot-body-start">\\s*</script>\\s*${BODY}\\s*<script type="x/boundary" id="fastboot-body-end">\\s*</script>\\s*</body>\\s*</html>`, 'im'));
        });
      });
    });

    describe('when there is a shoebox', function() {
      beforeEach(async function () {
        await result.setContent(HTML);
        await result.evaluate(() => {
          document.body.insertAdjacentHTML('beforeend', '<script type="fastboot/shoebox" id="shoebox-something">{ "some": "data" }</script>');
        });
      });

      it('returns a chunks for the head, body and shoebox', function() {
        return result.chunks()
        .then(function (result) {
          expect(result.length).to.eq(3);
          expect(result[0]).to.match(new RegExp(`<html>\\s*<head>\\s*${HEAD}\\s*</head>\\s*`, 'im'));
          expect(result[1]).to.match(new RegExp(`\\s*<body>\\s*<script type="x/boundary" id="fastboot-body-start">\\s*</script>\\s*${BODY}`, 'im'));
          expect(result[2]).to.eq('<script type="fastboot/shoebox" id="shoebox-something">{ "some": "data" }</script><script type="x/boundary" id="fastboot-body-end"></script></body></html>');
        });
      });
    });

    describe('when there are multiple shoeboxes', function() {
      beforeEach(async function () {
        await result.setContent(HTML);
        await result.evaluate(() => {
          document.body.insertAdjacentHTML('beforeend', '<script type="fastboot/shoebox" id="shoebox-something-a">{ "some": "data" }</script>');
          document.body.insertAdjacentHTML('beforeend', '<script type="fastboot/shoebox" id="shoebox-something-b">{ "some": "data" }</script>');
          document.body.insertAdjacentHTML('beforeend', '<script type="fastboot/shoebox" id="shoebox-something-c">{ "some": "data" }</script>');
        });
      });

      it('returns a chunks for the head, body and shoebox', function() {
        return result.chunks()
        .then(function (result) {
          expect(result.length).to.eq(5);
          expect(result[0]).to.match(new RegExp(`<html>\\s*<head>\\s*${HEAD}\\s*</head>\\s*`, 'im'));
          expect(result[1]).to.match(new RegExp(`\\s*<body>\\s*<script type="x/boundary" id="fastboot-body-start">\\s*</script>\\s*${BODY}`, 'im'));
          expect(result[2]).to.eq('<script type="fastboot/shoebox" id="shoebox-something-a">{ "some": "data" }</script>');
          expect(result[3]).to.eq('<script type="fastboot/shoebox" id="shoebox-something-b">{ "some": "data" }</script>');
          expect(result[4]).to.eq('<script type="fastboot/shoebox" id="shoebox-something-c">{ "some": "data" }</script><script type="x/boundary" id="fastboot-body-end"></script></body></html>');
        });
      });
      
    });
  });

  describe('domContents()', function() {
    var HEAD = '<meta name="foo" content="bar">';
    var BODY = '<h1>A normal response document</h1>';
    var HTML = `
      <html>
      <head>
        ${HEAD}
      </head>
      <body>
        ${BODY}
      </body>
      </html
    `;
    var boundaryStartTag = '<script type="x/boundary" id="fastboot-body-start"></script>';
    var boundaryEndTag = '<script type="x/boundary" id="fastboot-body-end"></script>';

    beforeEach(async function () {
      await result.setContent(HTML);
    });

    it('should return the FastBoot-rendered document body', function () {
      var domContents = result.domContents();
      expect(domContents.head).to.include(HEAD);
      expect(domContents.body).to.include(BODY);
      expect(domContents.body).to.include(boundaryStartTag);
      expect(domContents.body).to.include(boundaryEndTag);
      expect(domContents.body).to.match(new RegExp(`\\s*${boundaryStartTag}\\s*${BODY}\\s*${boundaryEndTag}`));
    });
  });
});
