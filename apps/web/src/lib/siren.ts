// Shared siren engine. Five styles play real recorded siren/alarm audio
// files (apps/web/public/sounds/) instead of synthesis — actual recordings
// simply sound more convincing than anything a few oscillators can fake.
// 'chirp' (a short console-notification beep for low-drama alerts) has no
// matching recording among what was supplied, so it stays synthesized.
//
// File-to-style mapping is a best-effort guess from filename/description
// alone (no way to listen to or inspect the source audio in this
// environment) — swap the files in public/sounds/ if any read wrong by ear:
//   wail.mp3    (ship siren)         -> continuous panic/SOS default
//   yelp.mp3    (generic siren sfx)  -> geofence breach
//   klaxon.mp3  (security alarm)     -> security alerts
//   classic.mp3 (sirena)             -> default/general alert
//   mayday.mp3  (alien base siren)   -> voice_distress panic (most urgent)
//
// One siren plays at a time (a new call stops whatever's currently playing).

export type SirenId = 'wail' | 'yelp' | 'klaxon' | 'chirp' | 'classic' | 'mayday';

type Waveform = OscillatorType;

interface DiscreteSiren { kind: 'discrete'; waveform: Waveform; tones: [number, number][]; gain: number }
interface AudioFileSiren { kind: 'audio'; src: string; gain: number }
type SirenDef = DiscreteSiren | AudioFileSiren;

export const SIRENS: Record<SirenId, SirenDef> = {
  // Continuous recorded siren. Used for panic/SOS: the one alarm meant to
  // run continuously until resolved.
  wail:    { kind: 'audio', src: '/sounds/wail.mp3', gain: 0.8 },
  // Recorded siren sound effect. Geofence breaches.
  yelp:    { kind: 'audio', src: '/sounds/yelp.mp3', gain: 0.8 },
  // Recorded security alarm. Security alerts.
  klaxon:  { kind: 'audio', src: '/sounds/klaxon.mp3', gain: 0.8 },
  // Short synthesized double-beep, console-notification feel — no recording
  // fits this role, kept as a tone. Speed/mechanical/comms alerts.
  chirp:   { kind: 'discrete', waveform: 'sine', tones: [[1400, 90], [0, 70], [1400, 90], [0, 600]], gain: 0.18 },
  // Recorded generic siren. Default/general alert style.
  classic: { kind: 'audio', src: '/sounds/classic.mp3', gain: 0.8 },
  // Recorded, more dramatic siren — reserved for panic_events.mode ===
  // 'voice_distress' (the field agent verbally called "PAN PAN PAN" under
  // duress rather than pressing a button), so dispatch can tell by ear
  // alone that this one needs the fastest response.
  mayday:  { kind: 'audio', src: '/sounds/mayday.mp3', gain: 0.85 },
};

let activeStop: (() => void) | null = null;
let saturationCurve: Float32Array | null = null;
const bufferCache = new Map<string, Promise<AudioBuffer>>();

// tanh soft-clip — rounds off peaks instead of the harsh hard-clipping a raw
// digital waveform has, the main thing that reads as "cheap"/"buzzy" to the ear.
function getSaturationCurve(): Float32Array {
  if (saturationCurve) return saturationCurve;
  const n = 1024;
  const curve = new Float32Array(n);
  const drive = 1.8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  saturationCurve = curve;
  return curve;
}

interface Voice {
  setFrequency(freq: number, at: number): void;
  rampFrequency(freq: number, at: number): void;
  start(at: number): void;
  stop(at: number): void;
}

function buildVoice(ctx: AudioContext, waveform: Waveform, destination: AudioNode): Voice {
  const mix = ctx.createGain();
  mix.gain.value = 1 / 3;
  const oscs = [-7, 0, 7].map((detune) => {
    const osc = ctx.createOscillator();
    osc.type = waveform;
    osc.detune.value = detune;
    osc.connect(mix);
    return osc;
  });

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 1.4;
  mix.connect(filter);

  const shaper = ctx.createWaveShaper();
  shaper.curve = getSaturationCurve() as Float32Array<ArrayBuffer>;
  shaper.oversample = '2x';
  filter.connect(shaper);
  shaper.connect(destination);

  const filterFreq = (toneFreq: number) => Math.max(400, toneFreq * 3.2);

  return {
    setFrequency(freq, at) {
      for (const osc of oscs) osc.frequency.setValueAtTime(freq, at);
      filter.frequency.setValueAtTime(filterFreq(freq), at);
    },
    rampFrequency(freq, at) {
      for (const osc of oscs) osc.frequency.linearRampToValueAtTime(freq, at);
      filter.frequency.linearRampToValueAtTime(filterFreq(freq), at);
    },
    start(at) { for (const osc of oscs) osc.start(at); },
    stop(at) { for (const osc of oscs) osc.stop(at); },
  };
}

async function loadBuffer(ctx: AudioContext, src: string): Promise<AudioBuffer> {
  let pending = bufferCache.get(src);
  if (!pending) {
    pending = fetch(src)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
    bufferCache.set(src, pending);
  }
  return pending;
}

export function stopSiren(): void {
  activeStop?.();
  activeStop = null;
}

/** Plays a siren style. Returns a stop function (also stored — stopSiren() works too). */
export function playSiren(id: SirenId, { loop = false }: { loop?: boolean } = {}): () => void {
  stopSiren(); // only one siren plays at a time
  const def = SIRENS[id];
  const ctx = new AudioContext();
  let running = true;

  const runDiscrete = async (d: DiscreteSiren) => {
    do {
      for (const [freq, ms] of d.tones) {
        if (!running) break;
        if (freq > 0) {
          const gain = ctx.createGain();
          gain.connect(ctx.destination);
          const voice = buildVoice(ctx, d.waveform, gain);
          const now = ctx.currentTime;
          const dur = ms / 1000;
          const attack = Math.min(0.02, dur * 0.25);
          const release = Math.min(0.05, dur * 0.3);
          voice.setFrequency(freq, now);
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(d.gain, now + attack);
          gain.gain.setValueAtTime(d.gain, now + dur - release);
          gain.gain.linearRampToValueAtTime(0, now + dur);
          voice.start(now);
          voice.stop(now + dur + 0.05);
        }
        await new Promise<void>((r) => setTimeout(r, ms));
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    } while (running && loop);
  };

  const runAudio = async (d: AudioFileSiren) => {
    const buffer = await loadBuffer(ctx, d.src);
    if (!running) return;
    const gain = ctx.createGain();
    gain.gain.value = d.gain;
    gain.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(gain);
    source.start();
    if (!loop) {
      source.onended = () => { if (running) stop(); };
    }
  };

  (def.kind === 'audio' ? runAudio(def) : runDiscrete(def)).catch(() => {});

  const stop = () => {
    running = false;
    ctx.close().catch(() => {});
  };
  activeStop = stop;
  return stop;
}

// Which siren plays for a given alert type — deliberately restrained to
// high/critical severity only; sounding a tone for every routine
// medium/low/info alert would be alarm fatigue within a day.
export function sirenForAlert(type: string, severity: string): SirenId | null {
  if (severity !== 'critical' && severity !== 'high') return null;
  switch (type?.toLowerCase()) {
    case 'geofence': return 'yelp';
    case 'security': return 'klaxon';
    case 'mechanical':
    case 'speed':
    case 'communication': return 'chirp';
    default: return 'classic';
  }
}
