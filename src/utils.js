const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const debug = require('debug')('fastboot:ember-app');
const FastBootSchemaVersions = require('./fastboot-schema-versions');

/** 
 * Indicates if the argument doesn't exist, whether it's undefined, null, or NaN.
 * 
 * @function isNil
 * @param {*} object
 * @returns {Boolean}
 */
exports.isNil = function isNil(object) {
  const type = typeof object;
  return type === 'undefined' || type === 'NaN' || object === null;
};


/**
 * Given the path to a built Ember app, reads the FastBoot manifest
 * information from its `package.json` file.
 * 
 * @function readPackageJSON
 * @param {string} distPath
 */
exports.readPackageJSON = function readPackageJSON(distPath) {
  let pkgPath = path.join(path.resolve(distPath), 'package.json');
  let file;

  try {
    file = fs.readFileSync(pkgPath);
  } catch (e) {
    throw new Error(`Couldn't find ${pkgPath}. You may need to update your version of ember-cli-fastboot.`);
  }

  let manifest;
  let schemaVersion;
  let pkg;

  try {
    pkg = JSON.parse(file);
    manifest = pkg.fastboot.manifest;
    schemaVersion = pkg.fastboot.schemaVersion;
  } catch (e) {
    throw new Error(`${pkgPath} was malformed or did not contain a manifest. Ensure that you have a compatible version of ember-cli-fastboot.`);
  }

  const currentSchemaVersion = FastBootSchemaVersions.latest;
  // set schema version to 1 if not defined
  schemaVersion = schemaVersion || FastBootSchemaVersions.base;
  debug('Current schemaVersion from `ember-cli-fastboot` is %s while latest schema version is %s', (schemaVersion, currentSchemaVersion));

  if (schemaVersion > currentSchemaVersion) {
    let errorMsg = chalk.bold.red('An incompatible version between `ember-cli-fastboot` and `fastboot` was found. Please update the version of fastboot library that is compatible with ember-cli-fastboot.');
    throw new Error(errorMsg);
  }

  if (schemaVersion < FastBootSchemaVersions.manifestFileArrays) {
    // transform app and vendor file to array of files
    manifest = transformManifestFiles(manifest);
  }

  let config = pkg.fastboot.config;
  let appName = pkg.fastboot.appName;
  if (schemaVersion < FastBootSchemaVersions.configExtension) {
    // read from the appConfig tree
    if (pkg.fastboot.appConfig) {
      appName = pkg.fastboot.appConfig.modulePrefix;
      config = {};
      config[appName] = pkg.fastboot.appConfig;
    }
  }

  debug("reading array of app file paths from manifest");
  var appFiles = manifest.appFiles.map(function(appFile) {
    return path.join(distPath, appFile);
  });

  debug("reading array of vendor file paths from manifest");
  var vendorFiles = manifest.vendorFiles.map(function(vendorFile) {
    return path.join(distPath, vendorFile);
  });

  if (process.env.APP_CONFIG) {
    let appConfig = JSON.parse(process.env.APP_CONFIG);
    let appConfigKey = appName;
    if (!appConfig.hasOwnProperty(appConfigKey)) {
      config[appConfigKey] = appConfig;
    }
  }

  if (process.env.ALL_CONFIG) {
    let allConfig = JSON.parse(process.env.ALL_CONFIG);
    config = allConfig;
  }

  return {
    appFiles,
    vendorFiles,
    htmlFile: path.join(distPath, manifest.htmlFile),
    moduleWhitelist: pkg.fastboot.moduleWhitelist,
    hostWhitelist: pkg.fastboot.hostWhitelist,
    config,
    appName,
    schemaVersion,
  };
};

/**
 * Function to transform the manifest app and vendor files to an array.
 * 
 * @function transformManifestFiles
 * @param {Object} manifest
 */
function transformManifestFiles(manifest) {
  manifest.appFiles = [manifest.appFile];
  manifest.vendorFiles = [manifest.vendorFile];

  return manifest;
}

exports.CHROMIUM_FLAGS = [
  // Disable antialiasing on 2d canvas
 '--disable-canvas-aa',
  // Disable antialiasing on 2d canvas clips
 '--disable-2d-canvas-clip-aa',
 // BEST OPTION EVER! Disables GL drawing operations which produce pixel output. With this the GL output will not be correct but tests will run faster.
 '--disable-gl-drawing-for-tests',
 '--disable-dev-shm-usage',
 // Disables the use of a zygote process for forking child processes. Instead, child processes will be forked and exec'd directly. Note that --no-sandbox should also be used together with this flag because the sandbox needs the zygote to work.
 '--no-zygote',
 // better cpu usage with --use-gl=desktop rather than --use-gl=swiftshader
 '--use-gl=desktop',
 '--enable-webgl',
 '--hide-scrollbars',
 '--mute-audio',
 '--no-first-run',
 '--disable-infobars',
 '--disable-breakpad',
 '--disable-web-security',
 // see defaultViewport
 '--window-size=1280,1024',
 '--mute-audio',
 // the following are necessary for tests to work in Travis
 '--disable-setuid-sandbox',
 '--no-sandbox'
];