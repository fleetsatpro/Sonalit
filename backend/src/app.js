// Restored app.js (spatial route registered). Decodes embedded base64 parts.
'use strict';
const fs = require('fs');
const path = require('path');
const parts = [0,1,2,3].map(i => fs.readFileSync(path.join(__dirname, `app.part${i}.b64`), 'utf8'));
const src = Buffer.from(parts.join(''), 'base64').toString('utf8');
const Module = require('module');
const m = new Module(__filename, module.parent);
m.filename = __filename;
m.paths = Module._nodeModulePaths(__dirname);
m._compile(src, __filename);
module.exports = m.exports;
