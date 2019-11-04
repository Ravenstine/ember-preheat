const webpack  = require('webpack'),
      MemoryFS = require('memory-fs'),
    { promisify } = require('util'),
      realFS   = require('fs');

async function compile(_path) {
  const fs = new MemoryFS(),
        compiler = webpack({
          mode: 'development',
          target: 'web',
          entry: _path,
          output: {
            path: '/build',
            filename: '[name].js',
            globalObject: 'this'
          },
          module: {
            rules: [

            ]
          },
          plugins: [
          ]
        });
  compiler.run = promisify(compiler.run);
  compiler.inputFileSystem = realFS;
  compiler.resolvers.normal.fileSystem = fs;
  compiler.outputFileSystem = fs;
  const stats = await compiler.run();
  const res = stats.compilation.assets['main.js'].source();
  return res;
}

module.exports = function bundle(){
  return compile(`${__dirname}/browser-env.js`);
};

