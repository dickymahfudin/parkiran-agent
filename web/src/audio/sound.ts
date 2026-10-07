// Procedural WebAudio: no sound files, no licences. Ambience follows the time of day and what the lot is doing
// (keyboards while sessions work, engines of the traffic going by); one-shots for the lighter and notifications.
// Nothing plays until the page has been clicked (browser autoplay policy).
// Laptop speakers reproduce almost nothing below ~200 Hz, so every layer has its body in the 300 Hz – 5 kHz band.
import type { Lighting } from "../scene/env/dayNight.ts";

const MASTER = 0.7;
/** Seconds of keyboard clicks scheduled per ambience call (called every ~0.5 s). */
const KEY_WINDOW = 0.5;
/** Key presses per second for one person typing. */
const KEYS_PER_TYPIST = 3.2;
const MAX_TYPISTS = 6;
/** Engine voices update their parameters at most this often (s). */
const VOICE_UPDATE = 0.05;

export type VehicleKind = "car" | "scooter";

interface Voice {
  gain: GainNode;
  pan: StereoPannerNode;
  oscillators: { node: OscillatorNode; base: number }[];
  updatedAt: number;
}

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
  private city: GainNode | null = null;
  private crickets: GainNode | null = null;
  private voices = new Map<string, Voice>();
  private nextBird = 0;
  private enabled = false;

  /** Call from a user gesture. Safe to call repeatedly. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
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

    // Distant traffic: a band of road noise (what small speakers can play) over a low rumble, slowly swelling.
    this.city = ctx.createGain();
    this.city.gain.value = 0;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.06;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.02;
    swell.connect(swellDepth).connect(this.city.gain);
    swell.start();
    const road = this.loopNoise();
    const roadBand = ctx.createBiquadFilter();
    roadBand.type = "bandpass";
    roadBand.frequency.value = 650;
    roadBand.Q.value = 0.45;
    road.connect(roadBand).connect(this.city);
    const rumble = this.loopNoise();
    const rumbleLow = ctx.createBiquadFilter();
    rumbleLow.type = "lowpass";
    rumbleLow.frequency.value = 260;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.8;
    rumble.connect(rumbleLow).connect(rumbleGain).connect(this.city);
    this.city.connect(this.bus);

    // Crickets: two insects, each a high tone gated by a fast pulse and a slower chirp rhythm.
    this.crickets = ctx.createGain();
    this.crickets.gain.value = 0;
    this.crickets.connect(this.bus);
    for (const [freq, pulseHz, rhythmHz, level] of [
      [4300, 38, 1.7, 1],
      [5100, 46, 2.3, 0.6],
    ] as const) {
      const tone = ctx.createOscillator();
      tone.frequency.value = freq;
      const pulse = ctx.createOscillator();
      pulse.type = "square";
      pulse.frequency.value = pulseHz;
      const rhythm = ctx.createOscillator();
      rhythm.type = "square";
      rhythm.frequency.value = rhythmHz;
      const mix = ctx.createGain();
      mix.gain.value = level;
      tone.connect(this.gate(pulse)).connect(this.gate(rhythm)).connect(mix).connect(this.crickets);
      tone.start();
      pulse.start();
      rhythm.start();
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? MASTER : 0, this.ctx.currentTime, 0.2);
  }

  /**
   * Called a few times a second. `typists`: people typing on their laptops right now; `closeness`: 1 at the default
   * view, higher when the camera is zoomed in on the lot.
   */
  ambience(l: Lighting, hour: number, typists: number, closeness: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.city || !this.crickets) return;
    const day = 1 - l.night;
    this.city.gain.setTargetAtTime(0.07 + day * 0.1, ctx.currentTime, 2);
    this.crickets.gain.setTargetAtTime(l.night * 0.035, ctx.currentTime, 2);
    if (!this.enabled) return;
    const morning = hour >= 5.3 && hour <= 9;
    const daytime = hour > 9 && hour < 17;
    if ((morning || (daytime && Math.random() < 0.08)) && ctx.currentTime > this.nextBird) {
      this.nextBird = ctx.currentTime + (morning ? 1.5 + Math.random() * 4 : 8 + Math.random() * 12);
      this.bird();
    }
    this.keys(Math.min(typists, MAX_TYPISTS), closeness);
  }

  /**
   * One engine per passing vehicle. `loudness` 0 silences it; `pan` −1 (left) … 1 (right); `pitch` 1 = idle note
   * (speed and Doppler shift it).
   */
  vehicle(key: string, kind: VehicleKind, loudness: number, pan: number, pitch: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    let v = this.voices.get(key);
    if (!v) {
      if (loudness <= 0) return;
      v = this.engine(kind);
      this.voices.set(key, v);
    }
    const t = ctx.currentTime;
    if (t - v.updatedAt < VOICE_UPDATE && loudness > 0) return;
    v.updatedAt = t;
    // Fades out by itself unless refreshed: frames stop in a hidden tab, and a frozen engine would drone on.
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(Math.max(0, loudness) * (kind === "scooter" ? 0.55 : 0.45), t, 0.06);
    v.gain.gain.setTargetAtTime(0, t + 0.5, 0.25);
    v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.06);
    for (const o of v.oscillators) o.node.frequency.setTargetAtTime(o.base * pitch, t, 0.08);
  }

  /** Two-tone "ting-tung" for a session that needs you. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.bus) return;
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
      o.connect(g).connect(this.bus);
      o.start(t);
      o.stop(t + 1);
    }
  }

  /** A soft single "ting" when a session finishes its turn: quieter and shorter than the needs-you chime. */
  done(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.bus) return;
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
      o.connect(g).connect(this.bus);
      o.start(t);
      o.stop(t + 1.2);
    }
  }

  /**
   * A street vendor's call, one group: a spoon on a bakso bowl ("ting-ting-ting") or a ladle on the wok ("tek-tek-tek").
   * `loudness` 0…1 from the distance, `pan` −1 (left) … 1 (right).
   */
  cartCall(kind: "bakso" | "nasgor", loudness: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.bus || !this.noise || loudness < 0.02) return;
    const out = ctx.createStereoPanner();
    out.pan.value = Math.max(-1, Math.min(1, pan));
    const level = ctx.createGain();
    level.gain.value = loudness;
    level.connect(out).connect(this.bus);
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
  }

  /** Lighter: the flint "cetek" and a short gas whoosh. */
  lighter(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.noise || !this.bus) return;
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
    gas.connect(bp).connect(gg).connect(this.bus);
    gas.start(t + 0.02, Math.random(), 0.75);
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 2);
    return src;
  }

  /** A square wave (−1…1) scaled by 0.5 on top of a 0.5 base gives an on/off gate. */
  private gate(lfo: OscillatorNode): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(g.gain);
    return g;
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

  /** Laptop keyboards: soft clicks spread over the next window, with the odd space bar. */
  private keys(typists: number, closeness: number): void {
    if (typists <= 0) return;
    const ctx = this.ctx!;
    const level = 0.05 * Math.min(2.2, Math.max(0.5, closeness));
    const count = Math.round(typists * KEYS_PER_TYPIST * KEY_WINDOW * (0.6 + Math.random() * 0.8));
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + 0.05 + Math.random() * KEY_WINDOW;
      if (Math.random() < 0.12) this.burst(t, 0.04, "bandpass", 900 + Math.random() * 200, 1.4, level * 0.9, 0.045);
      else this.burst(t, 0.02, "bandpass", 2400 + Math.random() * 1600, 1.6, level * (0.6 + Math.random() * 0.4), 0.022);
    }
  }

  private bird(): void {
    const ctx = this.ctx!;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2800 + Math.random() * 1600;
    for (let i = 0; i < notes; i++) {
      const t = ctx.currentTime + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(this.bus!);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  /** Engine voice: harmonic-rich oscillators for the motor plus filtered noise for tyres and wind. */
  private engine(kind: VehicleKind): Voice {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    gain.connect(pan).connect(this.bus!);
    const motor = ctx.createBiquadFilter();
    motor.type = "lowpass";
    motor.frequency.value = kind === "scooter" ? 1700 : 700;
    motor.Q.value = 1.5;
    const motorGain = ctx.createGain();
    motorGain.gain.value = kind === "scooter" ? 0.5 : 0.35;
    motor.connect(motorGain).connect(gain);
    // A matic scooter is a buzzy ~110 Hz drone with a CVT whine; a car is a low hum mostly hidden by tyre roar.
    const notes: [OscillatorType, number, number][] =
      kind === "scooter"
        ? [
            ["sawtooth", 108, 1],
            ["sawtooth", 110.5, 0.8],
            ["square", 216, 0.25],
            ["sine", 1350, 0.06],
          ]
        : [
            ["sawtooth", 46, 1],
            ["sawtooth", 92, 0.6],
          ];
    const oscillators = notes.map(([type, base, level]) => {
      const node = ctx.createOscillator();
      node.type = type;
      node.frequency.value = base;
      const g = ctx.createGain();
      g.gain.value = level;
      node.connect(g).connect(motor);
      node.start();
      return { node, base };
    });
    const tyres = this.loopNoise();
    const tyreBand = ctx.createBiquadFilter();
    tyreBand.type = "bandpass";
    tyreBand.frequency.value = kind === "scooter" ? 700 : 500;
    tyreBand.Q.value = 0.7;
    const tyreGain = ctx.createGain();
    tyreGain.gain.value = kind === "scooter" ? 0.35 : 0.9;
    tyres.connect(tyreBand).connect(tyreGain).connect(gain);
    return { gain, pan, oscillators, updatedAt: -Infinity };
  }
}

export const sound = new SoundEngine();
