// Procedural WebAudio cues, no sound files and no licences: the needs-you chime, a soft "ting" when a turn is done, the
// lighter, and the food carts' calls. There is no ambience (street, keyboards, crickets, engines): a lot that is quiet
// until something happens costs no battery. Between cues the audio context is suspended (`wake.ts`), so the audio
// daemon idles and the machine may sleep; a cue wakes it (a few ms) and it sleeps again two seconds after the last one.
// Nothing plays until the page has been clicked (browser autoplay policy).
// Laptop speakers reproduce almost nothing below ~200 Hz, so every cue has its body in the 300 Hz – 5 kHz band.
import { createWake } from "./wake.ts";

const MASTER = 0.7;

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Everything mixes here, then a compressor keeps the sum loud without clipping. */
  private bus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = false;
  private readonly wake = createWake({
    now: () => performance.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    sleep: () => {
      const ctx = this.ctx;
      if (ctx?.state === "running") ctx.suspend().catch((err: unknown) => console.warn("audio could not suspend", err));
    },
  });

  /** Call from a user gesture (it unlocks audio for the page). Safe to call repeatedly. */
  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? MASTER : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    this.bus = ctx.createGain();
    this.bus.connect(comp).connect(this.master).connect(ctx.destination);
    this.noise = noiseBuffer(ctx, 3);
    // Running now because of the click; nothing to play yet.
    this.wake.hold(0);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? MASTER : 0, this.ctx.currentTime, 0.2);
    if (!on) this.wake.release();
    // Awake for whatever reason (just unlocked, woken by the browser): make sure it goes back to sleep.
    else if (this.ctx?.state === "running") this.wake.hold(0);
  }

  /** For the dev console and checks. */
  get state(): { enabled: boolean; context: AudioContextState | null; awakeUntil: number } {
    return { enabled: this.enabled, context: this.ctx?.state ?? null, awakeUntil: this.wake.awakeUntil };
  }

  /**
   * Runs `schedule` with a running context: at once when it is awake, else after waking it. `seconds`: how long the
   * cue rings, so the context is not put back to sleep under it.
   */
  private play(seconds: number, schedule: (ctx: AudioContext) => void): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    this.wake.hold(seconds);
    if (ctx.state === "running") {
      schedule(ctx);
      return;
    }
    ctx
      .resume()
      .then(() => {
        if (this.enabled) schedule(ctx);
      })
      .catch((err: unknown) => console.warn("audio could not wake for a cue", err));
  }

  /** Two-tone "ting-tung" for a session that needs you. */
  chime(): void {
    if (!this.bus) return;
    this.play(1.2, (ctx) => {
      for (const [freq, at] of [
        [880, 0],
        [1318.5, 0.16],
      ] as const) {
        const t = ctx.currentTime + at;
        const o = ctx.createOscillator();
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(g).connect(this.bus!);
        o.start(t);
        o.stop(t + 1);
      }
    });
  }

  /** A soft single "ting" when a session finishes its turn: quieter and shorter than the needs-you chime. */
  done(): void {
    if (!this.bus) return;
    this.play(1.2, (ctx) => {
      const t = ctx.currentTime;
      for (const [freq, peak] of [
        [1760, 0.11],
        [3520, 0.025],
      ] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        o.connect(g).connect(this.bus!);
        o.start(t);
        o.stop(t + 1.2);
      }
    });
  }

  /**
   * A street vendor's call, one group: a spoon on a bakso bowl ("ting-ting-ting") or a ladle on the wok ("tek-tek-tek").
   * `loudness` 0…1 from the distance, `pan` −1 (left) … 1 (right).
   */
  cartCall(kind: "bakso" | "nasgor", loudness: number, pan: number): void {
    if (!this.noise || !this.bus || loudness < 0.02) return;
    this.play(1.4, (ctx) => {
      const out = ctx.createStereoPanner();
      out.pan.value = Math.max(-1, Math.min(1, pan));
      const level = ctx.createGain();
      level.gain.value = loudness;
      level.connect(out).connect(this.bus!);
      const hits = kind === "bakso" ? 3 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 3);
      const gap = kind === "bakso" ? 0.2 : 0.15;
      for (let i = 0; i < hits; i++) {
        const t = ctx.currentTime + 0.02 + i * gap + Math.random() * 0.02;
        if (kind === "bakso") {
          // A small china bowl: a bright partial over a lower one, ringing out quickly.
          for (const [freq, peak, decay] of [
            [2350, 0.16, 0.35],
            [3910, 0.06, 0.2],
          ] as const) {
            const o = ctx.createOscillator();
            o.frequency.value = freq * (0.99 + Math.random() * 0.02);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(peak, t + 0.004);
            g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
            o.connect(g).connect(level);
            o.start(t);
            o.stop(t + decay + 0.05);
          }
        } else {
          // Steel on a wok: a short knock with a dull ring.
          const src = ctx.createBufferSource();
          src.buffer = this.noise;
          const f = ctx.createBiquadFilter();
          f.type = "bandpass";
          f.frequency.value = 1150 + Math.random() * 150;
          f.Q.value = 6;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.5, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
          src.connect(f).connect(g).connect(level);
          src.start(t, Math.random() * 2.5, 0.1);
        }
      }
    });
  }

  /** Lighter: the flint "cetek" and a short gas whoosh. */
  lighter(): void {
    if (!this.noise || !this.bus) return;
    this.play(0.8, (ctx) => {
      const t = ctx.currentTime;
      this.burst(t, 0.03, "highpass", 2500, 0.7, 0.5, 0.025);
      const gas = ctx.createBufferSource();
      gas.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1100;
      bp.Q.value = 0.8;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0, t + 0.02);
      gg.gain.linearRampToValueAtTime(0.16, t + 0.08);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      gas.connect(bp).connect(gg).connect(this.bus!);
      gas.start(t + 0.02, Math.random(), 0.75);
    });
  }

  /** A short filtered noise click. */
  private burst(t: number, length: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.bus!);
    src.start(t, Math.random() * 2.5, length);
  }
}

export const sound = new SoundEngine();
