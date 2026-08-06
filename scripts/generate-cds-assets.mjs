#!/usr/bin/env node
// Generates the CDS artwork: a live-action intro film (Sora) and a photoreal
// app icon (image model).
//
// Hand-drawn SVG was tried twice and rejected. This produces real footage, not
// a cartoon and not stills faked into motion. Claude's sandbox can't reach
// image/video APIs — the network policy 403s the CONNECT to api.openai.com —
// so this runs where the network is open: a GitHub Actions runner via
// .github/workflows/generate-cds-assets.yml, or locally:
//
//   OPENAI_API_KEY=sk-... node scripts/generate-cds-assets.mjs
//
// Video generation is slow (minutes per clip) and billed per second, so the
// workflow is manual and opens a PR for review rather than committing blind.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'cds');
const KEY = process.env.OPENAI_API_KEY;
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'sora-2';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';
const SKIP_VIDEO = process.env.SKIP_VIDEO === '1';

if (!KEY) {
  console.error('OPENAI_API_KEY is not set. Nothing generated.');
  process.exit(1);
}

const auth = { Authorization: `Bearer ${KEY}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One grade across every asset so the film and the icon read as the same
// production. "Live-action / shot on film" is doing real work in these prompts:
// without it these models drift toward CGI and 3D-render looks.
const LOOK =
  'live-action documentary cinematography, shot on 35mm film with anamorphic ' +
  'lenses, photorealistic, natural physically-accurate lighting, dusk with ' +
  'warm sodium and amber practicals against deep blue shadow, atmospheric haze, ' +
  'shallow depth of field, subtle handheld camera weight, film grain, ' +
  'no animation, no CGI, no cartoon, no illustration, no text, no logos, no on-screen graphics';

// Four continuous shots, each a single unbroken camera move. Transitions are
// handled in the player as cross-dissolves between real footage — asking the
// model for "a transition" inside a clip is what produces the swipe-wipe look
// that reads as cartoonish.
const SHOTS = [
  {
    file: 'intro-01-highway.mp4',
    prompt:
      'Slow tracking shot alongside a container truck moving on an open highway ' +
      'at dusk. Camera holds pace with the trailer, tarmac streaming past, ' +
      'headlights raking through low haze, hills on the horizon. ' + LOOK,
  },
  {
    file: 'intro-02-yard.mp4',
    prompt:
      'Slow push through a container yard at dusk between tall rows of stacked ' +
      'shipping containers under floodlights, a reach stacker working in the ' +
      'distance, dust drifting in the light beams. ' + LOOK,
  },
  {
    file: 'intro-03-port.mp4',
    prompt:
      'Slow crane-up at a deepwater port at dusk revealing gantry cranes loading ' +
      'a container ship, quayside floodlights flaring, cranes silhouetted ' +
      'against the last light. ' + LOOK,
  },
  {
    file: 'intro-04-vessel.mp4',
    prompt:
      'Slow aerial push toward a fully laden container vessel under way at sea ' +
      'at dusk, seen from astern and above, calm swell breaking at the bow, ' +
      'horizon glow behind. ' + LOOK,
  },
];

const ICON = {
  file: 'cds-icon.png',
  size: '1024x1024',
  prompt:
    'A modern container cargo ship at a working port with a red container truck ' +
    'alongside it on the quay, both clearly visible and balanced in frame, ' +
    'three-quarter view, centred product-shot composition on a clean dark ' +
    'background suitable for an app icon. ' + LOOK,
};

async function generateVideo({ file, prompt }) {
  const start = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VIDEO_MODEL,
      prompt,
      seconds: process.env.VIDEO_SECONDS || '8',
      size: process.env.VIDEO_SIZE || '1280x720',
    }),
  });

  if (!start.ok) {
    // Surface the provider's own words. "model not found" (no Sora access on
    // this account) and "billing hard limit" need very different responses.
    throw new Error(`create ${start.status}: ${(await start.text()).slice(0, 300)}`);
  }

  const job = await start.json();
  process.stdout.write(`  ${file} queued (${job.id}) `);

  // Sora renders asynchronously — poll until terminal. 20 min ceiling so a
  // stuck job fails the run instead of hanging the workflow forever.
  const deadline = Date.now() + 20 * 60 * 1000;
  let state = job;
  while (!['completed', 'failed'].includes(state.status)) {
    if (Date.now() > deadline) throw new Error('timed out after 20 min');
    await sleep(10_000);
    process.stdout.write('.');
    const poll = await fetch(`https://api.openai.com/v1/videos/${job.id}`, { headers: auth });
    if (!poll.ok) throw new Error(`poll ${poll.status}: ${(await poll.text()).slice(0, 200)}`);
    state = await poll.json();
  }
  process.stdout.write('\n');

  if (state.status === 'failed') {
    throw new Error(state.error?.message || 'render failed');
  }

  const content = await fetch(`https://api.openai.com/v1/videos/${job.id}/content`, { headers: auth });
  if (!content.ok) throw new Error(`download ${content.status}`);
  const bytes = Buffer.from(await content.arrayBuffer());
  await writeFile(join(OUT, file), bytes);
  console.log(`  ${file} — ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
}

async function generateImage({ file, prompt, size }) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, n: 1 }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);

  const item = (await res.json()).data?.[0];
  if (!item) throw new Error('no image in response');
  const bytes = item.b64_json
    ? Buffer.from(item.b64_json, 'base64')
    : Buffer.from(await (await fetch(item.url)).arrayBuffer());

  await writeFile(join(OUT, file), bytes);
  console.log(`  ${file} — ${(bytes.length / 1024).toFixed(0)} KB`);
}

await mkdir(OUT, { recursive: true });
const failed = [];

console.log(`Icon — ${IMAGE_MODEL}`);
try { await generateImage(ICON); } catch (e) { console.error(`  FAILED — ${e.message}`); failed.push(ICON.file); }

if (SKIP_VIDEO) {
  console.log('\nSKIP_VIDEO=1 — skipping the intro film.');
} else {
  console.log(`\nIntro film — ${VIDEO_MODEL} (minutes per shot)`);
  for (const shot of SHOTS) {
    try { await generateVideo(shot); } catch (e) { console.error(`  ${shot.file} FAILED — ${e.message}`); failed.push(shot.file); }
  }
}

if (failed.length) {
  console.error(`\n${failed.length} asset(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nAll assets generated.');
