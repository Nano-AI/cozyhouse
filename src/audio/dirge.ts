/**
 * An original, slow, sad 3/4 ballroom phrase for the horror events, synthesized live in Web Audio
 * (no files). Written for this game; it is not a transcription of any existing song.
 *
 * Muted-trumpet lead (saw + square, detuned, nasal lowpass "wah" + delayed vibrato) over a waltz
 * bass and soft chord stabs, through a gramophone band-pass (300 Hz–3 kHz), tape wow/flutter on
 * every oscillator's detune, a long generated-noise convolution reverb and looping vinyl crackle.
 *
 * `setDecay(0..1)` degrades it: tempo slows, pitch sinks, the horn muffles, bars start to skip
 * like a stuck record, notes drop out and crackle grows, until at 1 only crackle is left.
 */

// 8 bars of 3/4 in A minor: [midi, startBeat, beats]
const MELODY: ReadonlyArray<readonly [number, number, number]> = [
  [76, 0, 2], [74, 2, 1],
  [72, 3, 1.5], [71, 4.5, 0.5], [69, 5, 1],
  [77, 6, 2], [76, 8, 1],
  [76, 9, 3],
  [74, 12, 1], [72, 13, 1], [71, 14, 1],
  [68, 15, 1.5], [69, 16.5, 0.5], [71, 17, 1],
  [72, 18, 2], [71, 20, 0.5], [69, 20.5, 0.5],
  [69, 21, 3],
];
// One chord per bar: bass root (midi) + chord tones
const BARS: ReadonlyArray<{ bass: number; chord: readonly number[] }> = [
  { bass: 45, chord: [57, 60, 64] }, // Am
  { bass: 41, chord: [57, 60, 64] }, // Fmaj7
  { bass: 38, chord: [57, 62, 65] }, // Dm
  { bass: 40, chord: [56, 59, 62] }, // E7
  { bass: 38, chord: [57, 62, 65] }, // Dm
  { bass: 40, chord: [56, 59, 62] }, // E7
  { bass: 48, chord: [57, 60, 64] }, // Am/C
  { bass: 45, chord: [57, 60, 64] }, // Am
];
const LOOP_BEATS = 24;
const LOOKAHEAD_S = 0.3;
const TICK_MS = 60;

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function noiseBuffer(ctx: AudioContext, seconds: number, fill: (data: Float32Array, rate: number, ch: number) => void): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) fill(buf.getChannelData(ch), ctx.sampleRate, ch);
  return buf;
}

export class Dirge {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly bus: GainNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly crackleGain: GainNode;
  private readonly pitch: ConstantSourceNode;
  private readonly wow: OscillatorNode;
  private readonly wowDepth: GainNode;
  private readonly flutter: OscillatorNode;
  private readonly flutterDepth: GainNode;
  private readonly crackle: AudioBufferSourceNode;
  private readonly nodes: AudioNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeatTime = 0;
  private beat = 0;
  private barRepeatFrom = -1;
  private decay = 0;
  private volume: number;
  private fade = 0;
  private stopped = false;

  constructor(ctx: AudioContext, dest: AudioNode, volume: number) {
    this.ctx = ctx;
    this.volume = volume;
    const t = ctx.currentTime;
    const track = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };

    this.out = track(ctx.createGain());
    this.out.gain.setValueAtTime(0, t);
    this.out.connect(dest);

    // Gramophone horn: band-pass 300 Hz–3 kHz with a nasal mid bump
    const hp = track(ctx.createBiquadFilter());
    hp.type = 'highpass';
    hp.frequency.value = 300;
    hp.Q.value = 0.8;
    this.lowpass = track(ctx.createBiquadFilter());
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 3000;
    this.lowpass.Q.value = 0.9;
    const horn = track(ctx.createBiquadFilter());
    horn.type = 'peaking';
    horn.frequency.value = 1250;
    horn.Q.value = 1.4;
    horn.gain.value = 4;
    this.bus = track(ctx.createGain());
    this.bus.gain.value = 0.9;
    this.bus.connect(hp);
    hp.connect(this.lowpass);
    this.lowpass.connect(horn);
    horn.connect(this.out);

    // Long hall reverb from a generated decaying-noise impulse
    const verb = track(ctx.createConvolver());
    verb.buffer = noiseBuffer(ctx, 3.4, (d, rate) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const k = i / d.length;
        lp += (Math.random() * 2 - 1 - lp) * 0.35;
        d[i] = lp * Math.pow(1 - k, 2.6) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
      }
    });
    const wet = track(ctx.createGain());
    wet.gain.value = 0.55;
    horn.connect(verb);
    verb.connect(wet);
    wet.connect(this.out);

    // Pitch sink (cents) + tape wow/flutter, all summed into each oscillator's detune
    this.pitch = track(ctx.createConstantSource());
    this.pitch.offset.value = 0;
    this.wow = track(ctx.createOscillator());
    this.wow.frequency.value = 0.42;
    this.wowDepth = track(ctx.createGain());
    this.wowDepth.gain.value = 14;
    this.wow.connect(this.wowDepth);
    this.flutter = track(ctx.createOscillator());
    this.flutter.frequency.value = 7.1;
    this.flutterDepth = track(ctx.createGain());
    this.flutterDepth.gain.value = 4;
    this.flutter.connect(this.flutterDepth);

    // Vinyl: hiss + dense clicks + a soft once-per-turn groove thump (78 rpm)
    this.crackle = track(ctx.createBufferSource());
    this.crackle.buffer = noiseBuffer(ctx, 4.6, (d, rate, ch) => {
      let hiss = 0;
      for (let i = 0; i < d.length; i++) {
        hiss += (Math.random() * 2 - 1 - hiss) * 0.5;
        d[i] = hiss * 0.05;
      }
      const clicks = Math.floor(4.6 * 26);
      for (let c = 0; c < clicks; c++) {
        const at = Math.floor(Math.random() * (d.length - 200));
        const amp = (Math.random() < 0.12 ? 0.95 : 0.25 + Math.random() * 0.35) * (Math.random() < 0.5 ? -1 : 1);
        const len = 6 + Math.floor(Math.random() * 40);
        for (let j = 0; j < len; j++) d[at + j] += amp * Math.exp(-j / (len * 0.3));
      }
      const turn = rate * (60 / 78);
      for (let p = ch * 37; p < d.length - 400; p += turn) {
        for (let j = 0; j < 300; j++) d[Math.floor(p) + j] += 0.16 * Math.sin(j * 0.09) * Math.exp(-j / 90);
      }
    });
    this.crackle.loop = true;
    const crackleHp = track(ctx.createBiquadFilter());
    crackleHp.type = 'highpass';
    crackleHp.frequency.value = 500;
    this.crackleGain = track(ctx.createGain());
    this.crackleGain.gain.value = 0.18;
    this.crackle.connect(crackleHp);
    crackleHp.connect(this.crackleGain);
    this.crackleGain.connect(this.out);

    this.pitch.start(t);
    this.wow.start(t);
    this.flutter.start(t);
    this.crackle.start(t);
  }

  start(fadeInSec = 4): void {
    if (this.stopped || this.timer !== null) return;
    this.fade = 1;
    this.applyOut(fadeInSec);
    this.nextBeatTime = this.ctx.currentTime + 0.6;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  /** 0 = clean(ish) record, 1 = only crackle left. */
  setDecay(decay: number): void {
    const d = Math.max(0, Math.min(1, decay));
    if (Math.abs(d - this.decay) < 0.004) return;
    this.decay = d;
    const t = this.ctx.currentTime;
    this.pitch.offset.setTargetAtTime(-d * 460, t, 0.6);
    this.wowDepth.gain.setTargetAtTime(14 + d * 34, t, 0.6);
    this.lowpass.frequency.setTargetAtTime(3000 - d * 1500, t, 0.6);
    this.crackleGain.gain.setTargetAtTime(0.18 + d * 0.5, t, 0.6);
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyOut(0.2);
  }

  /** Fades to silence, then frees every node. Safe to call twice. */
  stop(fadeOutSec = 3): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.fade = 0;
    this.applyOut(Math.max(0.05, fadeOutSec / 4));
    setTimeout(() => this.dispose(), fadeOutSec * 1000 + 250);
  }

  private dispose(): void {
    for (const n of this.nodes) {
      try {
        if (n instanceof AudioScheduledSourceNode) n.stop();
      } catch {
        // already stopped
      }
      try {
        n.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.nodes.length = 0;
  }

  private applyOut(timeConstant: number): void {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.setTargetAtTime(Math.min(1.8, this.volume * 2.6) * this.fade, t, timeConstant);
  }

  private schedule(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    if (this.nextBeatTime < now - 0.5) this.nextBeatTime = now + 0.05; // tab was asleep
    while (this.nextBeatTime < now + LOOKAHEAD_S) {
      const bpm = 72 - this.decay * 30;
      const beatSec = 60 / bpm;
      if (this.decay < 0.97) this.playBeat(this.beat, this.nextBeatTime, beatSec);
      this.nextBeatTime += beatSec;
      this.beat += 1;
      if (this.beat % 3 === 0) {
        // Stuck-record skips once it starts wearing out: jump back a bar now and then
        if (this.decay > 0.45 && this.barRepeatFrom < 0 && Math.random() < 0.22 + this.decay * 0.2) {
          this.barRepeatFrom = this.beat;
          this.beat -= 3;
        } else {
          this.barRepeatFrom = -1;
        }
      }
      if (this.beat >= LOOP_BEATS) this.beat -= LOOP_BEATS;
    }
  }

  private playBeat(beat: number, time: number, beatSec: number): void {
    const bar = BARS[Math.floor(beat / 3) % BARS.length];
    const inBar = beat % 3;
    const d = this.decay;
    if (inBar === 0) {
      if (Math.random() > d * 0.7) this.voice(bar.bass, time, beatSec * 0.95, 'triangle', 0.15, 520, false);
      if (Math.random() > d * 0.9) {
        for (const n of bar.chord) this.voice(n, time, beatSec * 2.9, 'triangle', 0.022, 900, false);
      }
    } else if (Math.random() > d * 0.8) {
      for (const n of bar.chord) this.voice(n, time, beatSec * 0.45, 'sawtooth', 0.016, 1100, false);
    }
    for (const [m, start, len] of MELODY) {
      if (start < beat || start >= beat + 1) continue;
      if (Math.random() < d * 0.85) continue;
      this.voice(m, time + (start - beat) * beatSec, len * beatSec * 0.96, 'sawtooth', 0.13, 0, true);
    }
  }

  /** One note. `lead` = muted trumpet (saw+square, wah filter, delayed vibrato); else a soft pad/bass. */
  private voice(midi: number, t: number, dur: number, wave: OscillatorType, level: number, cutoff: number, lead: boolean): void {
    const ctx = this.ctx;
    const f = midiHz(midi);
    const end = t + dur;
    const release = lead ? 0.32 : 0.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + (lead ? 0.06 : 0.09));
    env.gain.setTargetAtTime(level * (lead ? 0.72 : 0.6), t + 0.1, 0.25);
    env.gain.setTargetAtTime(0, end, release / 3);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    if (lead) {
      filt.Q.value = 4;
      filt.frequency.setValueAtTime(420, t);
      filt.frequency.linearRampToValueAtTime(1700, t + 0.09);
      filt.frequency.setTargetAtTime(1050, t + 0.1, 0.3);
    } else {
      filt.Q.value = 0.7;
      filt.frequency.value = cutoff;
    }
    filt.connect(env);
    env.connect(this.bus);

    const oscs: OscillatorNode[] = [];
    const mk = (type: OscillatorType, detune: number, gain: number): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      this.pitch.connect(o.detune);
      this.wowDepth.connect(o.detune);
      this.flutterDepth.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(filt);
      oscs.push(o);
    };
    if (lead) {
      mk('sawtooth', -6, 0.7);
      mk('square', 7, 0.32);
    } else {
      mk(wave, (Math.random() - 0.5) * 12, 1);
    }

    let vib: OscillatorNode | null = null;
    if (lead) {
      vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(18, t + Math.min(0.5, dur * 0.6));
      vib.connect(depth);
      for (const o of oscs) depth.connect(o.detune);
      vib.start(t);
      vib.stop(end + release + 0.05);
    }

    const stopAt = end + release + 0.05;
    for (const o of oscs) {
      o.start(t);
      o.stop(stopAt);
    }
    oscs[0].onended = () => {
      for (const o of oscs) {
        try {
          this.pitch.disconnect(o.detune);
          this.wowDepth.disconnect(o.detune);
          this.flutterDepth.disconnect(o.detune);
        } catch {
          // graph already torn down
        }
        o.disconnect();
      }
      vib?.disconnect();
      filt.disconnect();
      env.disconnect();
    };
  }
}

/** Extra rain hiss on the weather channel (so the weather slider applies); grows as dread builds. */
export class RainSwell {
  private readonly src: AudioBufferSourceNode;
  private readonly gain: GainNode;
  private readonly ctx: AudioContext;
  private stopped = false;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.src = ctx.createBufferSource();
    this.src.buffer = noiseBuffer(ctx, 2.5, (d) => {
      let b0 = 0;
      let b1 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.97 * b0 + w * 0.15;
        b1 = 0.6 * b1 + w * 0.4;
        d[i] = (b0 + b1) * 0.5 + (Math.random() < 0.004 ? (Math.random() - 0.5) * 0.8 : 0);
      }
    });
    this.src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.5;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.src.connect(bp);
    bp.connect(this.gain);
    this.gain.connect(dest);
    this.src.start();
  }

  setLevel(level: number): void {
    if (this.stopped) return;
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.55, this.ctx.currentTime, 0.8);
  }

  stop(fadeOutSec = 2): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.setTargetAtTime(0, t, fadeOutSec / 4);
    this.src.stop(t + fadeOutSec + 0.1);
    this.src.onended = () => {
      this.src.disconnect();
      this.gain.disconnect();
    };
  }
}

/** A slow, unoiled door-hinge creak (~1.3 s). */
export function playCreak(ctx: AudioContext, dest: AudioNode): void {
  const t = ctx.currentTime + 0.02;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(70, t);
  o.frequency.linearRampToValueAtTime(130, t + 0.5);
  o.frequency.linearRampToValueAtTime(95, t + 0.9);
  o.frequency.linearRampToValueAtTime(150, t + 1.3);
  // stick-slip judder: amplitude-modulate at a wandering ~24 Hz
  const am = ctx.createOscillator();
  am.frequency.setValueAtTime(18, t);
  am.frequency.linearRampToValueAtTime(30, t + 1.3);
  const amDepth = ctx.createGain();
  amDepth.gain.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.12);
  g.gain.setValueAtTime(0.09, t + 1.1);
  g.gain.linearRampToValueAtTime(0, t + 1.35);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 3;
  am.connect(amDepth);
  amDepth.connect(g.gain);
  o.connect(bp);
  bp.connect(g);
  g.connect(dest);
  o.start(t);
  am.start(t);
  o.stop(t + 1.4);
  am.stop(t + 1.4);
  o.onended = () => {
    o.disconnect();
    am.disconnect();
    amDepth.disconnect();
    bp.disconnect();
    g.disconnect();
  };
}

/** A soft inward breath of air plus a sinking tone, for someone fading out of existence. */
export function playVanish(ctx: AudioContext, dest: AudioNode, harsh = false): void {
  const t = ctx.currentTime + 0.01;
  const len = harsh ? 0.8 : 1.4;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, len, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  });
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = harsh ? 6 : 1.2;
  bp.frequency.setValueAtTime(harsh ? 2400 : 600, t);
  bp.frequency.exponentialRampToValueAtTime(harsh ? 300 : 1800, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(harsh ? 0.07 : 0.05, t + len * 0.7);
  g.gain.linearRampToValueAtTime(0, t + len);
  const tone = ctx.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(harsh ? 330 : 220, t);
  tone.frequency.exponentialRampToValueAtTime(harsh ? 60 : 110, t + len);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0, t);
  tg.gain.linearRampToValueAtTime(0.035, t + 0.2);
  tg.gain.linearRampToValueAtTime(0, t + len);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  tone.connect(tg);
  tg.connect(dest);
  src.start(t);
  tone.start(t);
  src.stop(t + len + 0.05);
  tone.stop(t + len + 0.05);
  src.onended = () => {
    src.disconnect();
    bp.disconnect();
    g.disconnect();
    tone.disconnect();
    tg.disconnect();
  };
}
