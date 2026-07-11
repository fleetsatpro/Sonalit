// Shared Web Audio siren engine — synthesized tones, no audio files needed.
// One siren plays at a time (a new call stops whatever's currently playing).
// Two playback shapes:
//   - 'discrete': a list of [frequency, durationMs] steps, stepped through
//     once or looped (frequency 0 = a silent gap, for pulsing patterns).
//   - 'sweep': a continuous frequency ramp back and forth between two tones
//     (a real siren "wail", not a stepped approximation).

export type SirenId = 'wail' | 'yelp' | 'klaxon' | 'chirp' | 'classic';

interface DiscreteSiren { kind: 'discrete'; waveform: OscillatorType; tones: [number, number][]; gain: number }
interface SweepSiren { kind: 'sweep'; waveform: OscillatorType; low: number; high: number; sweepMs: number; gain: number }
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
};

let activeStop: (() => void) | null = null;

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
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = d.waveform;
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(d.gain, ctx.currentTime);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          await new Promise<void>((r) => setTimeout(r, ms));
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
          osc.stop(ctx.currentTime + 0.12);
        } else {
          await new Promise<void>((r) => setTimeout(r, ms));
        }
        await new Promise<void>((r) => setTimeout(r, 20));
      }
    } while (running && loop);
  };

  const runSweep = async (d: SweepSiren) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = d.waveform;
    osc.frequency.setValueAtTime(d.low, ctx.currentTime);
    gain.gain.setValueAtTime(d.gain, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    let t = ctx.currentTime;
    let goingUp = true;
    do {
      const target = goingUp ? d.high : d.low;
      osc.frequency.linearRampToValueAtTime(target, t + d.sweepMs / 1000);
      t += d.sweepMs / 1000;
      goingUp = !goingUp;
      await new Promise<void>((r) => setTimeout(r, d.sweepMs));
    } while (running && loop);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    osc.stop(ctx.currentTime + 0.15);
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
