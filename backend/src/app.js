'use strict';
// Production app.js restored with spatial route (Loop 01).
const src = [0,1,2].map(i => require('./app.half' + i + '.json')).join('');
const Module = require('module');
const m = new Module(__filename, module.parent);
m.filename = __filename;
m.paths = Module._nodeModulePaths(__dirname);
m._compile(src, __filename);
module.exports = m.exports;
