⚡Ember PowerBoot⚡
=============
[![Build Status](https://travis-ci.org/Ravenstine/powerboot.svg?branch=master)](https://travis-ci.org/ravenstine/powerboot)


**PowerBoot** is a drop-in replacement for [FastBoot](https://www.ember-fastboot.com) that uses Headless Chromium to provide server-side rendering for Ember.js applications in Node.js.  It's like FastBoot... but with *more power*. 💪

## Features

- Easy server-side rendering that's Ember-aware. 🐹
- A complete set of DOM and Browser APIs.  No more littering your code with `if (this.fastboot.isFastBoot)`.†
- The entire component lifecycle is supported, including `didInsertElement` and `willInsertElement` hooks!
- If you really need them, Ajax and [jQuery](https://jquery.com) *just work*.
- Works with existing tooling designed around FastBoot such as [Prember](https://github.com/ef4/prember))

## Why clone FastBoot?

If your application is simple enough, then the [SimpleDOM](https://github.com/ember-fastboot/simple-dom) environment that ships with FastBoot may be suitable.

Before using FastBoot, consider the following:

- There's no `addEventListener`, `querySelector`, `insertAdjacentElement`, `innerHTML`, etc.
- Custom elements don't work at all, even with the [Web Components polyfill](https://github.com/webcomponents/polyfills/tree/master/packages/custom-elements).  This is especially bad if your custom elements manipulate content in ways that could be easily prerenderd, such as code-highlighting.
- Calls to `localStorage`, `sessionStorage`, etc., aren't possible.

If those are problems for you, then you might want to use PowerBoot.

## Installation

PowerBoot requires Node.js v8.0.0 or later.

```sh
npm install --save-dev powerboot
```

If you intend on using PowerBoot in place of FastBoot when using [ember-cli-fastboot](https://github.com/ember-fastboot/ember-cli-fastboot), you will need to somehow alias the PowerBoot package with the name `fastboot`.

This can be accomplished using [link-module-alias](https://github.com/Rush/link-module-alias).  Once you have this installed as a dev-dependency, add the following to the `package.json` file in your Ember app.

```json
  "scripts": {
    "postinstall": "rm -rf ./node_modules/fastboot && link-module-alias",
  },
  "_moduleAliases": {
    "fastboot": "./node_modules/powerboot"
  },
```

Then run `npm install` and you should be good to go.

Essentially, this setup removes any version of FastBoot installed and replaces it with a symbolic link to PowerBoot.

## Usage

```js
const PowerBoot = require('powerboot');

let app = new PowerBoot({
  distPath: 'path/to/dist',
  // optional boolean flag when set to true does not reject the promise if there are rendering errors (defaults to false)
  resilient: <boolean>
});

app.visit('/photos', options)
  .then(result => result.html())
  .then(html => res.send(html));
```

In order to get a `dist` directory, you will first need to build your
Ember application, which packages it up for using in both the browser
and in Node.js.

### Additional configuration

`app.visit` takes a second parameter as `options` above which a map and allows to define additional optional per request
configuration:

- `resilient`: whether to reject the returned promise if there is an error during rendering. If not defined, defaults to the app's resilient setting.
- `html`: the HTML document to insert the rendered app into. Uses the built app's index.html by default.
- `metadata`: per request meta data that is exposed in the app via the [fastboot service](https://github.com/ember-fastboot/ember-cli-fastboot/blob/master/app/services/fastboot.js).
- `shouldRender`: boolean to indicate whether the app should do rendering or not. If set to false, it puts the app in routing-only. Defaults to true.
- `disableShoebox`: boolean to indicate whether we should send the API data in the shoebox. If set to false, it will not send the API data used for rendering the app on server side in the index.html. Defaults to false.
- `destroyAppInstanceInMs`: whether to destroy the instance in the given number of ms. This is a failure mechanism to not wedge the Node process
- `browser`: an instance of Browser.Puppeteer that will be used to render HTML.

### Build Your App

To get your Ember.js application ready to both run in your user's
browsers and run inside the PowerBoot environment, run the Ember CLI
build command:

```sh
$ ember build --environment production
```

(You will need to have already set up the Ember CLI FastBoot addon. For
more information, see the [FastBoot quickstart][quickstart].)

[quickstart]: https://www.ember-fastboot.com/quickstart

Once this is done, you will have a `dist` directory that contains the
multi-environment build of your app. Upload this file to your FastBoot
server.

### Command Line

You can start a simple HTTP server that responds to incoming requests by
rendering your Ember.js application using the [FastBoot App Server](https://github.com/ember-fastboot/fastboot-app-server#ember-fastboot-app-server)

### Debugging

Run `powerboot` with the `DEBUG` environment variable set to `powerboot:*`
for detailed logging.

### The Shoebox

You can pass application state from the PowerBoot rendered application to
the browser rendered application using a feature called the "Shoebox".
This allows you to leverage server API calls made by the PowerBoot rendered
application on the browser rendered application. Thus preventing you from
duplicating work that the PowerBoot application is performing. This should
result in a performance benefit for your browser application, as it does
not need to issue server API calls whose results are available from the
Shoebox.

The contents of the Shoebox are written to the HTML as strings within
`<script>` tags by the server rendered application, which are then consumed
by the browser rendered application.

This looks like:
```html
.
.
<script type="fastboot/shoebox" id="shoebox-main-store">
{"data":[{"attributes":{"name":"AEC Professionals"},"id":106,"type":"audience"},
{"attributes":{"name":"Components"},"id":111,"type":"audience"},
{"attributes":{"name":"Emerging Professionals"},"id":116,"type":"audience"},
{"attributes":{"name":"Independent Voters"},"id":2801,"type":"audience"},
{"attributes":{"name":"Members"},"id":121,"type":"audience"},
{"attributes":{"name":"Partners"},"id":126,"type":"audience"},
{"attributes":{"name":"Prospective Members"},"id":131,"type":"audience"},
{"attributes":{"name":"Public"},"id":136,"type":"audience"},
{"attributes":{"name":"Staff"},"id":141,"type":"audience"},
{"attributes":{"name":"Students"},"id":146,"type":"audience"}]}
</script>
.
.
```

### Cleanup

PowerBoot will automatically close the browser instance when the Node.js process is exited or terminated for any reason, but the browser may not be closed if a PowerBoot instance is removed via garbage collection.  If you plan on creating and destroying multiple PowerBoot instances, you must call `.close()` on each instance to shut down its browser instance.  Altenratively, you can have multiple PowerBoot instances share the same browser instance and shut that browser down manually.

## Caveats

The goal is to replicate the existing FastBoot API, but the nature of using Chromium means that some of the options that FastBoot supports can't be easily supported by PowerBoot.  For instance, equivalents to the `sandbox` and `sandboxGlobals` options are not fully supported and may not ever have parity with their FastBoot counterparts.  `sandboxGlobals` don't share the same memory space in Chromium as they do in Node.js, thus the values in the browser environment are serialized.  The provided FastBoot service may also not support all the behaviors of the original. *This, however, probably won't be a problem given that PowerBoot should allow most apps to "just work" without any special guards or polyfills in the first palce.*

The name "FastBoot" still appears in parts of the code to reduce backwards compatibility issues with other FastBoot tooling that might be expecting it.