#!/usr/bin/env node
// Generates the photoreal CDS artwork (folder/app icon + cinematic intro frames).
//
// Hand-drawn SVG was tried twice and rejected; these need to be real imagery.
// Claude's sandbox can't reach image APIs (the network policy 403s the CONNECT),
// so this runs where the network is open — a GitHub Actions runner via
// .github/workflows/generate-cds-assets.yml, or your own machine:
//
//   OPENAI_API_KEY=sk-... node scripts/generate-cds-assets.mjs
//
// Writes PNGs into apps/web/public/cds/. Re-run to regenerate; prompts live
// here so the look can be iterated in review rather than by eyeballing output.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'cds');
const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';

if (!KEY) {
  console.error('OPENAI_API_KEY is not set. Nothing generated.');
  process.exit(1);
}

// A shared look so the icon and the frames read as one set rather than stock
// images bolted together: dusk, warm sodium/amber light, cinematic and grounded.
const LOOK =
  'photorealistic, cinematic wide-gamut colour grade, dusk with warm amber ' +
  'sodium lighting against deep blue-black shadow, volumetric haze, shallow ' +
  'depth of field, shot on full-frame with a prime lens, no text, no logos, ' +
  'no watermarks, no people in frame';

const ASSETS = [
  {
    file: 'cds-icon.png',
    size: '1024x1024',
    prompt:
      'A modern container cargo ship at a working port with a red container ' +
      'truck alongside it on the quay, both clearly visible and balanced in ' +
      'frame, three-quarter view, centred product-shot composition on a clean ' +
      'dark background suitable for use as an app icon. ' + LOOK,
  },
  {
    file: 'intro-01-highway.png',
    size: '1536x1024',
    prompt:
      'A container truck on an open highway at dusk, motion-blurred tarmac, ' +
      'headlights cutting through low haze, distant hills. ' + LOOK,
  },
  {
    file: 'intro-02-yard.png',
    size: '1536x1024',
    prompt:
      'A container yard at dusk, stacked shipping containers in long rows ' +
      'under floodlights, a reach stacker working between them. ' + LOOK,
  },
  {
    file: 'intro-03-port.png',
    size: '1536x1024',
    prompt:
      'Gantry cranes loading a container ship at a deepwater port at dusk, ' +
      'quayside floodlights, cranes silhouetted against the sky. ' + LOOK,
  },
  {
    file: 'intro-04-vessel.png',
    size: '1536x1024',
    prompt:
      'A fully laden container vessel at sea at dusk, viewed from slightly ' +
      'astern and above, calm swell, horizon glow. ' + LOOK,
  },
];

async function generate({ file, prompt, size }) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt, size, n: 1 }),
  });

  if (!res.ok) {
    // Surface the provider's own message — "billing hard limit reached" and
    // "model not found" need very different responses from whoever ran this.
    throw new Error(`${res.status} ${(await res.text()).slice(0, 400)}`);
  }

  const body = await res.json();
  const item = body.data?.[0];
  if (!item) throw new Error('no image in response');

  // gpt-image-1 returns b64_json; some models/settings return a URL instead.
  const bytes = item.b64_json
    ? Buffer.from(item.b64_json, 'base64')
    : Buffer.from(await (await fetch(item.url)).arrayBuffer());

  await writeFile(join(OUT, file), bytes);
  console.log(`  ${file} — ${(bytes.length / 1024).toFixed(0)} KB`);
}

await mkdir(OUT, { recursive: true });
console.log(`Generating ${ASSETS.length} assets with ${MODEL} into apps/web/public/cds/`);

const failed = [];
for (const asset of ASSETS) {
  try {
    await generate(asset);
  } catch (err) {
    console.error(`  ${asset.file} FAILED — ${err.message}`);
    failed.push(asset.file);
  }
}

if (failed.length) {
  console.error(`\n${failed.length}/${ASSETS.length} failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nAll assets generated.');
