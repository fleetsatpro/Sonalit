// Shared Web Audio siren engine — synthesized tones, no audio files needed.
// One siren plays at a time (a new call stops whatever's currently playing).
//
// Every tone is built as a small synth "voice" rather than a single bare
// oscillator: 3 slightly detuned oscillators mixed together (thickness —
// a lone oscillator sounds thin and robotic), through a resonant lowpass
// filter (rounds a saw/square wave's harsh top-end harmonics into more of
// a "horn" tone instead of a buzzy digital one), then light soft-clip
// saturation (analog warmth instead of a sterile, clean tone), with a real
// attack/release envelope instead of a hard on/off click. That combination
// is what separates "siren" from "cheap alarm clock beep" — the raw
// single-oscillator version this replaced was the latter.
//
// Two playback shapes:
//   - 'discrete': a list of [frequency, durationMs] steps, stepped through
//     once or looped (frequency 0 = a silent gap, for pulsing patterns).
//   - 'sweep': a continuous frequency ramp back and forth between two tones
//     (a real siren "wail", not a stepped approximation).

export type SirenId = 'wail' | 'yelp' | 'klaxon' | 'chirp' | 'classic' | 'mayday';

type Waveform = OscillatorType;

interface DiscreteSiren { kind: 'discrete'; waveform: Waveform; tones: [number, number][]; gain: number }
interface SweepSiren { kind: 'sweep'; waveform: Waveform; low: number; high: number; sweepMs: number; gain: number }
type SirenDef = DiscreteSiren | SweepSiren;

export const SIRENS: Record<SirenId, SirenDef> = {
  // Continuous rising/falling pitch glide — classic ambulance-style wail.
  // Used for panic/SOS: the one alarm meant to run continuously until resolved.
  wail:    { kind: 'sweep', waveform: 'sawtooth', low: 500, high: 1000, sweepMs: 900, gain: 0.22 },
  // Fast hard hi-lo alternation — sharp and immediate. Geofence breaches.
  yelp:    { kind: 'discrete', waveform: 'sawtooth', tones: [[960, 180], [700, 180]], gain: 0.24 },
  // Low pulsing tone, more "warning" than "emergency". Security alerts.
  klaxon:  { kind: 'discrete', waveform: 'square', tones: [[220, 500], [0, 250]], gain: 0.20 },
  // Short double-beep, console-notification feel. Speed/mechanical/comms.
  chirp:   { kind: 'discrete', waveform: 'sine', tones: [[1400, 90], [0, 70], [1400, 90], [0, 600]], gain: 0.18 },
  // The original panic-alarm two-tone pattern, kept as a selectable style.
  classic: { kind: 'discrete', waveform: 'sawtooth', tones: [[960, 380], [700, 380], [960, 380], [700, 380], [960, 380], [700, 800]], gain: 0.25 },
  // Faster, higher-pitched, harsher sweep than the standard wail — reserved
  // for panic_events.mode === 'voice_distress' (the field agent verbally
  // called "PAN PAN PAN" under duress rather than pressing a button), so
  // dispatch can tell by ear alone that this one needs the fastest response.
  mayday:  { kind: 'sweep', waveform: 'square', low: 700, high: 1400, sweepMs: 450, gain: 0.28 },
};

let activeStop: (() => void) | null = null;
let saturationCurve: Float32Array | null = null;

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

  const runSweep = async (d: SweepSiren) => {
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const voice = buildVoice(ctx, d.waveform, gain);
    const now = ctx.currentTime;
    voice.setFrequency(d.low, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(d.gain, now + 0.05);
    voice.start(now);

    let t = ctx.currentTime;
    let goingUp = true;
    do {
      const target = goingUp ? d.high : d.low;
      voice.rampFrequency(target, t + d.sweepMs / 1000);
      t += d.sweepMs / 1000;
      goingUp = !goingUp;
      await new Promise<void>((r) => setTimeout(r, d.sweepMs));
    } while (running && loop);

    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    voice.stop(ctx.currentTime + 0.2);
  };

  (def.kind === 'sweep' ? runSweep(def) : runDiscrete(def)).catch(() => {});

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
