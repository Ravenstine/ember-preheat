'use strict';

const expect = require('chai').expect;
const fs = require('fs');
const path = require('path');
const fixture = require('./helpers/fixture-path');
const PowerBoot = require('../src/index');

describe("PowerBoot", function() {

  var powerboot;

  afterEach(async function() {
    if(!powerboot || !powerboot.close) return;
    await powerboot.close();
  });

  it("throws an exception if no distPath is provided", function() {
    var fn = function() {
      powerboot = new PowerBoot({});
      return powerboot;
    };
    expect(fn).to.throw(/You must provide PowerBoot with a distPath option/);
  });

  it("throws an exception if no package.json exists in the provided distPath", function() {
    var distPath = fixture('no-package-json');
    var fn = function() {
      powerboot = new PowerBoot({
        distPath: distPath
      });
      return powerboot;
    };

    expect(fn).to.throw(/Couldn't find (.+)\/fixtures\/no-package-json/);
  });

  it('throws an error when manifest schema version is higher than fastboot schema version', function() {
    var distPath = fixture('higher-schema-version');
    var fn = function() {
      powerboot = new PowerBoot({
        distPath: distPath
      });
      return powerboot;
    };

    expect(fn).to.throw(/An incompatible version between `ember-cli-fastboot` and `fastboot` was found/);
  });

  it("doesn't throw an exception if a package.json is provided", function() {
    var distPath = fixture('empty-package-json');
    var fn = function() {
      powerboot = new PowerBoot({
        distPath: distPath
      });
      return powerboot;
    };

    expect(fn).to.throw(/(.+)\/fixtures\/empty-package-json\/package.json was malformed or did not contain a manifest/);
  });

  it("can render HTML", function() {
    powerboot = new PowerBoot({
      distPath: fixture('basic-app')
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => {
        expect(html).to.match(/Welcome to Ember/);
      });
  });

  it("can render HTML with array of app files defined in package.json", function() {
    powerboot = new PowerBoot({
      distPath: fixture('multiple-app-files')
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => {
        expect(html).to.match(/Welcome to Ember/);
      });
  });

  it("cannot not render app HTML with shouldRender set as false", function() {
    powerboot = new PowerBoot({
      distPath: fixture('basic-app')
    });

    return powerboot.visit('/', {
      shouldRender: false
    })
      .then(r => r.html())
      .then(html => {
        expect(html).to.not.match(/Welcome to Ember/);
      });
  });

  it("outputs html attributes from the fastboot app", function() {
    powerboot = new PowerBoot({
      distPath: fixture('custom-html-attrs')
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => {
        expect(html).to.match(/<html data-foo="1" class="it-works"/);
      });
  });

  it("outputs body attributes from the fastboot app", function() {
    powerboot = new PowerBoot({
      distPath: fixture('custom-body-attrs')
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => {
        expect(html).to.match(/<body data-foo="1" class="it-works"/);
      });
  });

  it("can serialize the head and body", function() {
    powerboot = new PowerBoot({
      distPath: fixture('basic-app')
    });

    return powerboot.visit('/')
      .then((r) => {
        let contents = r.domContents();
        expect(contents.body).to.match(/Welcome to Ember/);
      });
  });

  it("can forcefully destroy the app instance using destroyAppInstanceInMs", async function() {
    powerboot = new PowerBoot({
      distPath: fixture('basic-app')
    });

    try {
      await powerboot.visit('/', {
        destroyAppInstanceInMs: 5
      });
    } catch(e) {
      expect(e.message).to.equal('App instance was forcefully destroyed in 5ms');
    }
  });

  it("can render HTML when sandboxGlobals is provided", function() {
    powerboot = new PowerBoot({
      distPath: fixture('custom-sandbox'),
      sandboxGlobals: {
        foo: 5,
        najax: 'undefined',
        myVar: 'undefined'
      }
    });

    return powerboot.visit('/foo')
      .then(r => r.html())
      .then(html => {
        expect(html).to.match(/foo from sandbox: 5/);
        expect(html).to.match(/najax in sandbox: undefined/);
      });
  });

  it("rejects the promise if an error occurs", function() {
    powerboot = new PowerBoot({
      distPath: fixture('rejected-promise')
    });

    return expect(powerboot.visit('/')).to.be.rejected;
  });

  it("catches the error if an error occurs", function() {
    powerboot = new PowerBoot({
      distPath: fixture('rejected-promise')
    });

    return powerboot.visit('/')
      .catch(function(err) {
        return expect(err).to.be.not.null;
      });
  });

  it("renders an empty page if the resilient flag is set", function() {
    powerboot = new PowerBoot({
      distPath: fixture('rejected-promise'),
      resilient: true
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => {
        expect(html).to.match(/<body>/);
      });
  });

  it("can reload the distPath", async function() {
    powerboot = new PowerBoot({
      distPath: fixture('basic-app')
    });

    function hotReloadApp() {
      powerboot.reload({
        distPath: fixture('hot-swap-app')
      });
    }

    let result = await powerboot.visit('/');
    let html = await result.html(); 

    expect(html).to.match(/Welcome to Ember/);

    hotReloadApp();

    result = await powerboot.visit('/');
    html = await result.html(); 
    
    expect(html).to.match(/Goodbye from Ember/);
  });

  it("can reload the app using the same sandboxGlobals", function() {
    powerboot = new PowerBoot({
      distPath: fixture('basic-app'),
      sandboxGlobals: {
        foo: 5,
        najax: 'undefined',
        myVar: 'undefined'
      }
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => expect(html).to.match(/Welcome to Ember/))
      .then(hotReloadApp)
      .then(() => powerboot.visit('/foo'))
      .then(r => r.html())
      .then((html) => {
        expect(html).to.match(/foo from sandbox: 5/);
        expect(html).to.match(/najax in sandbox: undefined/);
      });

    function hotReloadApp() {
      powerboot.reload({
        distPath: fixture('custom-sandbox')
      });
    }
  });
  
  it("reads the config from package.json", function() {
    powerboot = new PowerBoot({
      distPath: fixture('config-app')
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => expect(html).to.match(/Config foo: bar/));
  });

  it("prefers APP_CONFIG environment variable", function() {
    var config = {
      modulePrefix: "fastboot-test",
      environment: "development",
      baseURL: "/",
      locationType: "auto",
      EmberENV: { "FEATURES":{} },
      APP: {
        name: "fastboot-test",
        version: "0.0.0+3e9fe92d",
        autoboot: false,
        foo: "baz"
      },
      exportApplicationGlobal:true
    };

    process.env.APP_CONFIG = JSON.stringify(config);

    powerboot = new PowerBoot({
      distPath: fixture('config-app')
    });

    delete process.env.APP_CONFIG;

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => expect(html).to.match(/Config foo: baz/));
  });

  it("handles apps with config defined in app.js", function() {
    powerboot = new PowerBoot({
      distPath: fixture('config-not-in-meta-app')
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => expect(html).to.match(/Welcome to Ember/));
  });

  it("reloads the config when package.json changes", function() {
    var distPath = fixture('config-swap-app');
    var packagePath = path.join(distPath, 'package.json');
    var package1Path = path.join(distPath, 'package-1.json');
    var package2Path = path.join(distPath, 'package-2.json');

    copyPackage(package1Path);
    powerboot = new PowerBoot({
      distPath: distPath
    });

    return powerboot.visit('/')
      .then(r => r.html())
      .then(html => expect(html).to.match(/Config foo: bar/))
      .then(() => deletePackage())
      .then(() => copyPackage(package2Path))
      .then(hotReloadApp)
      .then(() => powerboot.visit('/'))
      .then(r => r.html())
      .then(html => expect(html).to.match(/Config foo: boo/))
      .finally(() => deletePackage());

    function hotReloadApp() {
      powerboot.reload({
        distPath: distPath
      });
    }

    function copyPackage(sourcePackage) {
      fs.symlinkSync(sourcePackage, packagePath);
    }

    function deletePackage() {
      fs.unlinkSync(packagePath);
    }
  });

  it("handles apps boot-time failures by throwing Errors", function() {
    powerboot = new PowerBoot({
      distPath: fixture('boot-time-failing-app')
    });

    return powerboot.visit('/')
    .catch((e) => expect(e).to.be.an('error'));
  });

  it("can read multiple configs", function() {
    powerboot = new PowerBoot({
      distPath: fixture('app-with-multiple-config')
    });

    return powerboot.visit('/')
    .then(r => r.html())
    .then(html => {
      expect(html).to.match(/App Name: app-with-multiple-configs/);
      expect(html).to.match(/Other Config {"default":"bar"}/);
    });
  });

  it("sets document.cookie", function() {
    powerboot = new PowerBoot({
      distPath: fixture('app-with-cookies')
    });

    return powerboot.visit('/', {
      request: {
        headers: {
          'Cookie': 'foo=bar;'
        }
      }
    })
      .then(r => r.html())
      .then(html => {
        expect(html).to.match(/foo=bar/);
      });
  });

});
