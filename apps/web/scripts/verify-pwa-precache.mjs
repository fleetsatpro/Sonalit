import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, '../dist');
const serviceWorkerPath = resolve(distDir, 'sw.js');

if (!existsSync(serviceWorkerPath)) {
  throw new Error('PWA precache verification failed: dist/sw.js was not emitted.');
}

const serviceWorker = readFileSync(serviceWorkerPath, 'utf8');
const match = serviceWorker.match(/precacheAndRoute\(\s*\[([\s\S]*?)\]\s*,/);

if (!match) {
  throw new Error('PWA precache verification failed: no static precache manifest was found.');
}

const entries = [...match[1].matchAll(/url:\s*["']([^"']+)["']/g)].map((item) => item[1]);
const hasAppShell = entries.includes('app-shell.html');
const hasIndex = entries.includes('index.html');
const hasJavaScript = entries.some((url) => /(?:^|\/)assets\/[^"']+\.js$/.test(url));
const hasCss = entries.some((url) => /(?:^|\/)assets\/[^"']+\.css$/.test(url));

const failures = [];
if (entries.length < 10) failures.push('expected at least 10 precache entries; found ' + entries.length);
if (!hasIndex) failures.push('index.html is absent from the precache');
if (!hasAppShell) failures.push('app-shell.html is absent from the precache');
if (!hasJavaScript) failures.push('no generated JavaScript chunk is precached');
if (!hasCss) failures.push('no generated CSS asset is precached');

if (failures.length) {
  throw new Error('PWA precache verification failed: ' + failures.join('; '));
}

console.log('PWA precache verified: ' + entries.length + ' entries (HTML shell, JavaScript and CSS included).');
