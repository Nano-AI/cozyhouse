/**
 * Procedural Web Audio synthesizer for Cozyhouse foley SFX, item interactions,
 * room celebration chimes, and thunderstorm rumbles.
 * Zero external audio files — 100% Web Audio synthesis.
 */

export interface NoiseBuffers {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

const noiseBufferCache = new WeakMap<AudioContext, NoiseBuffers>();

function normalizeBufferRms(data: Float32Array, targetRms: number): void {
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    sumSq += data[i] * data[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, data.length));
  if (rms < 1e-6) return;

  const gain = targetRms / rms;
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.max(-0.95, Math.min(0.95, data[i] * gain));
  }
}

/**
 * Generates seamlessly looping white, pink, and brown noise buffers (3 seconds each)
 * normalized to consistent warm RMS and cached per AudioContext so repeated SFX and
 * weather beds allocate zero per-call arrays.
 */
export function getNoiseBuffers(ctx: AudioContext): NoiseBuffers {
  const cached = noiseBufferCache.get(ctx);
  if (cached) return cached;

  const durationSec = 3;
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));

  const white = ctx.createBuffer(1, length, ctx.sampleRate);
  const pink = ctx.createBuffer(1, length, ctx.sampleRate);
  const brown = ctx.createBuffer(1, length, ctx.sampleRate);

  const wData = white.getChannelData(0);
  const pData = pink.getChannelData(0);
  const bData = brown.getChannelData(0);

  // Pink noise state (Paul Kellet's refined filter)
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  // Brown noise state
  let lastBrown = 0;

  for (let i = 0; i < length; i++) {
    const w = Math.random() * 2 - 1;
    wData[i] = w;

    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const pinkSample = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    pData[i] = pinkSample;

    lastBrown = (lastBrown + 0.02 * w) / 1.02;
    bData[i] = lastBrown;
  }

  // Crossfade loop ends so looped playback has zero clicks
  const fadeSamples = Math.min(Math.floor(ctx.sampleRate * 0.08), Math.floor(length / 8));
  for (const data of [pData, bData]) {
    for (let i = 0; i < fadeSamples; i++) {
      const t = i / fadeSamples;
      const tailIdx = length - fadeSamples + i;
      const mixed = data[i] * t + data[tailIdx] * (1 - t);
      data[i] = mixed;
      data[tailIdx] = mixed;
    }
  }

  // Normalize pink and brown noise to healthy, consistent RMS so gain values stay crisp & predictable
  normalizeBufferRms(pData, 0.28);
  normalizeBufferRms(bData, 0.30);

  const buffers: NoiseBuffers = { white, pink, brown };
  noiseBufferCache.set(ctx, buffers);
  return buffers;
}

function jitter(base: number, spread = 0.04): number {
  return base * (1 + (Math.random() * 2 - 1) * spread);
}

const MUSIC_SYNERGY_IDS = new Set([
  'dj_booth',
  'diner_jukebox',
  'record_player',
  'disco_ball',
]);

export class FoleySynth {
  private lastCatChirpAt = -1;

  playPlace(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const baseFreq = jitter(293.66, 0.05); // Warm D4 marimba pop

    // Main marimba body
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 0.82, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.025);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.96, now + 0.15);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.42, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2100, now);
    filter.frequency.exponentialRampToValueAtTime(680, now + 0.16);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.18);

    // Warm wooden overtone tap
    const over = ctx.createOscillator();
    const overGain = ctx.createGain();
    over.type = 'sine';
    over.frequency.setValueAtTime(baseFreq * 2.5, now);
    overGain.gain.setValueAtTime(0.0001, now);
    overGain.gain.linearRampToValueAtTime(0.16, now + 0.004);
    overGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    over.connect(overGain);
    overGain.connect(dest);
    over.start(now);
    over.stop(now + 0.065);

    // Crisp felt tap transient
    this.playFilteredNoiseBurst(ctx, dest, now, 'pink', 980, 1.3, 0.14, 0.048);
  }

  playRemove(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const startFreq = jitter(340, 0.04);

    // Gentle descending pluck
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 0.48, now + 0.13);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.36, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.145);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.16);

    // Soft downward air whoosh
    const { pink } = getNoiseBuffers(ctx);
    const src = ctx.createBufferSource();
    src.buffer = pink;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(920, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.15);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    src.connect(filter);
    filter.connect(nGain);
    nGain.connect(dest);
    src.start(now, Math.random() * 1.5, 0.18);
  }

  playMove(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    // Tactile wooden slide tap
    this.playFilteredNoiseBurst(ctx, dest, now, 'pink', 640, 1.4, 0.18, 0.07);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const f = jitter(225, 0.05);
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 0.72, now + 0.06);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.30, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.072);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  playRotate(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const f = jitter(660, 0.04);
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 0.74, now + 0.036);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.30, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.044);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.052);

    this.playFilteredNoiseBurst(ctx, dest, now, 'white', 1800, 1.8, 0.09, 0.025);
  }

  playUiClick(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const f = jitter(540, 0.03);
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 1.2, now + 0.028);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.048);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.056);
  }

  playInteract(
    ctx: AudioContext,
    dest: AudioNode,
    itemId: string,
    tags?: string[],
    active?: boolean,
  ): void {
    const id = itemId.toLowerCase();
    const tagSet = new Set((tags ?? []).map((t) => t.toLowerCase()));

    const hasAny = (keys: string[]): boolean =>
      keys.some((k) => tagSet.has(k) || id.includes(k));

    // Dedicated Music / DJ Synergy hubs (checked before lights so disco_ball gets the groove!)
    if (MUSIC_SYNERGY_IDS.has(id)) {
      if (active === false) {
        this.playVinylSpinDown(ctx, dest);
      } else {
        this.playMusicSynergyGroove(ctx, dest, id === 'disco_ball');
      }
      return;
    }

    if (hasAny(['cat', 'pet', 'kitten'])) {
      this.playCatChirpPurr(ctx, dest);
      return;
    }

    if (hasAny(['door', 'entrance'])) {
      this.playDoorLatch(ctx, dest);
      return;
    }

    if (
      hasAny([
        'lamp',
        'neon',
        'candle',
        'lantern',
        'led',
        'fairy',
        'string_lights',
        'uplight',
        'spotlight',
        'laser',
      ]) ||
      (tagSet.has('light') && !tagSet.has('window') && !tagSet.has('wall'))
    ) {
      if (active === false) {
        this.playLightSwitchOff(ctx, dest);
      } else {
        this.playLightSwitchBloom(ctx, dest);
      }
      return;
    }

    if (hasAny(['coffee', 'espresso', 'serve', 'smoothie', 'kettle', 'drinks', 'bar', 'blender'])) {
      this.playCafeSteamClink(ctx, dest);
      return;
    }

    if (hasAny(['music', 'party', 'disco', 'dj', 'dance', 'record', 'vinyl', 'jukebox', 'karaoke'])) {
      if (active === false) {
        this.playVinylSpinDown(ctx, dest);
      } else {
        this.playMusicChordPulse(ctx, dest);
      }
      return;
    }

    if (hasAny(['toilet'])) {
      this.playToiletFlush(ctx, dest);
      return;
    }

    if (hasAny(['bathroom', 'bath', 'shower', 'sink'])) {
      this.playWaterSplash(ctx, dest);
      return;
    }

    if (hasAny(['sleep', 'seating', 'plushie', 'bed', 'sofa', 'chair', 'beanbag', 'cushion', 'armchair', 'loveseat'])) {
      this.playCushionPoof(ctx, dest);
      return;
    }

    if (hasAny(['plants', 'plant', 'monstera', 'fern', 'bonsai', 'cactus', 'ivy', 'terrarium', 'flower'])) {
      this.playPlantRustleChime(ctx, dest);
      return;
    }

    if (hasAny(['cook', 'kitchen', 'stove', 'toaster', 'microwave', 'fridge'])) {
      this.playKitchenChime(ctx, dest);
      return;
    }

    // Pleasant warm marimba chime fallback
    this.playWarmMarimbaChime(ctx, dest);
  }

  playCelebration(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    // Joyful C major pentatonic bell arpeggio + warm supporting tone
    const notes = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3800, now);
    filter.connect(dest);

    // Warm root pad C4
    const root = ctx.createOscillator();
    const rootGain = ctx.createGain();
    root.type = 'sine';
    root.frequency.setValueAtTime(261.63, now);
    rootGain.gain.setValueAtTime(0.0001, now);
    rootGain.gain.linearRampToValueAtTime(0.20, now + 0.04);
    rootGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    root.connect(rootGain);
    rootGain.connect(filter);
    root.start(now);
    root.stop(now + 0.95);

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.068;
      const isLast = idx === notes.length - 1;
      const peak = isLast ? 0.34 : 0.26;
      const decay = isLast ? 0.72 : 0.42;

      const osc = ctx.createOscillator();
      const harm = ctx.createOscillator();
      const g = ctx.createGain();
      const hg = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      harm.type = 'triangle';
      harm.frequency.setValueAtTime(freq * 2, start);

      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(peak, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + decay);

      hg.gain.setValueAtTime(0.0001, start);
      hg.gain.linearRampToValueAtTime(peak * 0.28, start + 0.008);
      hg.gain.exponentialRampToValueAtTime(0.0001, start + decay * 0.52);

      osc.connect(g);
      harm.connect(hg);
      g.connect(filter);
      hg.connect(filter);

      osc.start(start);
      harm.start(start);
      osc.stop(start + decay + 0.05);
      harm.stop(start + decay + 0.05);
    });
  }

  playThunder(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const { brown, pink } = getNoiseBuffers(ctx);

    // Crisp lightning crackle bursts
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.042 + Math.random() * 0.018;
      const crackle = ctx.createBufferSource();
      crackle.buffer = pink;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1150 + i * 380, t);
      bp.Q.setValueAtTime(1.3, t);

      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.linearRampToValueAtTime(0.24 / (i + 1), t + 0.006);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);

      crackle.connect(bp);
      bp.connect(cg);
      cg.connect(dest);
      crackle.start(t, Math.random() * 1.5, 0.1);
    }

    // Deep rolling filtered brown noise rumble (warm midrange included for laptop speakers)
    const rumble = ctx.createBufferSource();
    rumble.buffer = brown;
    rumble.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(0.95, now);
    lp.frequency.setValueAtTime(340, now);
    lp.frequency.linearRampToValueAtTime(165, now + 0.55);
    lp.frequency.linearRampToValueAtTime(250, now + 0.95);
    lp.frequency.exponentialRampToValueAtTime(90, now + 2.55);

    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, now);
    rg.gain.linearRampToValueAtTime(0.52, now + 0.08);
    rg.gain.linearRampToValueAtTime(0.38, now + 0.78);
    rg.gain.exponentialRampToValueAtTime(0.0001, now + 2.65);

    rumble.connect(lp);
    lp.connect(rg);
    rg.connect(dest);
    rumble.start(now, Math.random() * 1.2);
    rumble.stop(now + 2.7);
  }

  playBotChirp(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3400, now);
    lp.connect(dest);

    // Friendly tiny two-tone Cozy Bot chime (A5 -> E6 with gentle upward slide)
    const tones: readonly [number, number, number, number][] = [
      [0.0, jitter(880, 0.03), 0.068, 0.20],
      [0.072, jitter(1318.5, 0.03), 0.115, 0.22],
    ];
    for (const [offset, freq, dur, amp] of tones) {
      const start = now + offset;
      const osc = ctx.createOscillator();
      const harm = ctx.createOscillator();
      const g = ctx.createGain();
      const hg = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * 0.96, start);
      osc.frequency.exponentialRampToValueAtTime(freq, start + 0.018);

      harm.type = 'triangle';
      harm.frequency.setValueAtTime(freq * 2, start);

      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(amp, start + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      hg.gain.setValueAtTime(0.0001, start);
      hg.gain.linearRampToValueAtTime(amp * 0.22, start + 0.005);
      hg.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.6);

      osc.connect(g);
      harm.connect(hg);
      g.connect(lp);
      hg.connect(lp);

      osc.start(start);
      harm.start(start);
      osc.stop(start + dur + 0.02);
      harm.stop(start + dur + 0.02);
    }
  }

  private playToiletFlush(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;

    // Tiny playful chrome lever click
    const lever = ctx.createOscillator();
    const lGain = ctx.createGain();
    lever.type = 'triangle';
    lever.frequency.setValueAtTime(860, now);
    lever.frequency.exponentialRampToValueAtTime(420, now + 0.022);
    lGain.gain.setValueAtTime(0.0001, now);
    lGain.gain.linearRampToValueAtTime(0.20, now + 0.003);
    lGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    lever.connect(lGain);
    lGain.connect(dest);
    lever.start(now);
    lever.stop(now + 0.035);

    // Gentle bubbly water swirl (swept bandpass pink noise)
    const { pink } = getNoiseBuffers(ctx);
    const src = ctx.createBufferSource();
    src.buffer = pink;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(2.2, now + 0.02);
    bp.frequency.setValueAtTime(520, now + 0.02);
    bp.frequency.exponentialRampToValueAtTime(1320, now + 0.2);
    bp.frequency.exponentialRampToValueAtTime(360, now + 0.54);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now + 0.02);
    nGain.gain.linearRampToValueAtTime(0.22, now + 0.09);
    nGain.gain.linearRampToValueAtTime(0.16, now + 0.34);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.56);

    src.connect(bp);
    bp.connect(nGain);
    nGain.connect(dest);
    src.start(now + 0.02, Math.random() * 1.4, 0.58);

    // Three soft bubbly water blips
    const bubbles: readonly [number, number, number][] = [
      [0.09, 360, 560],
      [0.21, 440, 680],
      [0.35, 310, 470],
    ];
    for (const [offset, f0, f1] of bubbles) {
      const start = now + offset;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(jitter(f0, 0.05), start);
      osc.frequency.exponentialRampToValueAtTime(jitter(f1, 0.05), start + 0.065);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.14, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);
      osc.connect(g);
      g.connect(dest);
      osc.start(start);
      osc.stop(start + 0.085);
    }
  }

  private playWaterSplash(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;

    // Soft shimmering water rush
    const { pink } = getNoiseBuffers(ctx);
    const src = ctx.createBufferSource();
    src.buffer = pink;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(1.5, now);
    bp.frequency.setValueAtTime(1150, now);
    bp.frequency.exponentialRampToValueAtTime(2350, now + 0.11);
    bp.frequency.exponentialRampToValueAtTime(880, now + 0.28);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.linearRampToValueAtTime(0.19, now + 0.025);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);

    src.connect(bp);
    bp.connect(nGain);
    nGain.connect(dest);
    src.start(now, Math.random() * 1.4, 0.32);

    // Delicate rising water droplets
    const drops: readonly [number, number, number][] = [
      [0.03, 720, 1140],
      [0.10, 960, 1460],
    ];
    for (const [offset, f0, f1] of drops) {
      const start = now + offset;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(jitter(f0, 0.04), start);
      osc.frequency.exponentialRampToValueAtTime(jitter(f1, 0.04), start + 0.055);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.16, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.072);
      osc.connect(g);
      g.connect(dest);
      osc.start(start);
      osc.stop(start + 0.082);
    }
  }

  private playCatChirpPurr(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    // Prevent identical multi-cat chirp stacking in the same frame (e.g. pet toy synergy)
    if (this.lastCatChirpAt >= 0 && now - this.lastCatChirpAt < 0.08) {
      return;
    }
    this.lastCatChirpAt = now;

    // Cute rising chirp meow
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const base = jitter(560, 0.06);
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.44, now + 0.088);
    osc.frequency.exponentialRampToValueAtTime(base * 1.15, now + 0.2);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.36, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.24);

    // Cozy warm purr pulse
    const purr = ctx.createOscillator();
    const purrLfo = ctx.createOscillator();
    const purrLfoGain = ctx.createGain();
    const purrGain = ctx.createGain();
    const purrFilter = ctx.createBiquadFilter();

    purr.type = 'triangle';
    purr.frequency.setValueAtTime(120, now + 0.06);

    purrLfo.type = 'sine';
    purrLfo.frequency.setValueAtTime(24, now + 0.06);
    purrLfoGain.gain.setValueAtTime(0.10, now + 0.06);

    purrFilter.type = 'lowpass';
    purrFilter.frequency.setValueAtTime(460, now + 0.06);

    purrGain.gain.setValueAtTime(0.0001, now + 0.06);
    purrGain.gain.linearRampToValueAtTime(0.18, now + 0.12);
    purrGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

    purrLfo.connect(purrLfoGain);
    purrLfoGain.connect(purrGain.gain);
    purr.connect(purrFilter);
    purrFilter.connect(purrGain);
    purrGain.connect(dest);

    purrLfo.start(now + 0.06);
    purr.start(now + 0.06);
    purrLfo.stop(now + 0.42);
    purr.stop(now + 0.42);
  }

  private playLightSwitchBloom(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    // Crisp tactile upward switch click
    const click = ctx.createOscillator();
    const cGain = ctx.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(1180, now);
    click.frequency.exponentialRampToValueAtTime(680, now + 0.016);
    cGain.gain.setValueAtTime(0.0001, now);
    cGain.gain.linearRampToValueAtTime(0.34, now + 0.002);
    cGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    click.connect(cGain);
    cGain.connect(dest);
    click.start(now);
    click.stop(now + 0.03);

    // Crisp mechanical snap transient
    this.playFilteredNoiseBurst(ctx, dest, now, 'white', 2400, 1.9, 0.14, 0.015);

    // Bright warm chime harmonic bloom
    const harmonics: readonly [number, number, number][] = [
      [587.33, 0.22, 0.3], // D5
      [880.0, 0.17, 0.27], // A5
      [1174.66, 0.095, 0.22], // D6 sparkle
    ];
    for (const [freq, amp, decay] of harmonics) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + 0.01);
      g.gain.setValueAtTime(0.0001, now + 0.01);
      g.gain.linearRampToValueAtTime(amp, now + 0.032);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.01 + decay);
      osc.connect(g);
      g.connect(dest);
      osc.start(now + 0.01);
      osc.stop(now + 0.03 + decay);
    }
  }

  private playLightSwitchOff(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    // Distinct soft low mechanical switch-off click
    const click = ctx.createOscillator();
    const cGain = ctx.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(520, now);
    click.frequency.exponentialRampToValueAtTime(235, now + 0.024);
    cGain.gain.setValueAtTime(0.0001, now);
    cGain.gain.linearRampToValueAtTime(0.28, now + 0.002);
    cGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
    click.connect(cGain);
    cGain.connect(dest);
    click.start(now);
    click.stop(now + 0.038);

    // Muted warm body click
    this.playFilteredNoiseBurst(ctx, dest, now, 'pink', 820, 1.5, 0.13, 0.02);
  }

  private playCafeSteamClink(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    // Cozy espresso steam hiss
    const { pink } = getNoiseBuffers(ctx);
    const src = ctx.createBufferSource();
    src.buffer = pink;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, now);
    bp.frequency.linearRampToValueAtTime(3400, now + 0.2);
    bp.Q.setValueAtTime(1.0, now);

    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0.0001, now);
    sGain.gain.linearRampToValueAtTime(0.24, now + 0.035);
    sGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

    src.connect(bp);
    bp.connect(sGain);
    sGain.connect(dest);
    src.start(now, Math.random() * 1.4, 0.28);

    // Crisp ceramic cup clink
    const clinkStart = now + 0.05;
    for (const [f, amp] of [
      [1760, 0.24],
      [2637, 0.15],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(jitter(f, 0.03), clinkStart);
      g.gain.setValueAtTime(0.0001, clinkStart);
      g.gain.linearRampToValueAtTime(amp, clinkStart + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, clinkStart + 0.14);
      osc.connect(g);
      g.connect(dest);
      osc.start(clinkStart);
      osc.stop(clinkStart + 0.16);
    }
  }

  private playMusicSynergyGroove(ctx: AudioContext, dest: AudioNode, discoSparkle: boolean): void {
    const now = ctx.currentTime;

    // Warm analog lowpass bus for the ~0.55s lo-fi synth phrase
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(0.85, now);
    filter.frequency.setValueAtTime(2600, now);
    filter.frequency.exponentialRampToValueAtTime(1150, now + 0.56);
    filter.connect(dest);

    // Two punchy warm groove kicks (beats 1 & 3)
    for (const kickOffset of [0, 0.22]) {
      const t = now + kickOffset;
      const kick = ctx.createOscillator();
      const kGain = ctx.createGain();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(128, t);
      kick.frequency.exponentialRampToValueAtTime(52, t + 0.085);
      kGain.gain.setValueAtTime(0.0001, t);
      kGain.gain.linearRampToValueAtTime(0.36, t + 0.006);
      kGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      kick.connect(kGain);
      kGain.connect(dest);
      kick.start(t);
      kick.stop(t + 0.12);
    }

    // Crisp brushed offbeat shaker ticks
    this.playFilteredNoiseBurst(ctx, dest, now + 0.11, 'pink', 5000, 2.0, 0.09, 0.03);
    this.playFilteredNoiseBurst(ctx, dest, now + 0.33, 'pink', 5200, 2.0, 0.10, 0.034);

    // Upbeat cozy 4-note lo-fi Rhodes / disco synth phrase (~0.55s total)
    const grooveNotes: readonly { offset: number; freq: number; dur: number; amp: number }[] = [
      { offset: 0.0, freq: 329.63, dur: 0.17, amp: 0.24 }, // E4
      { offset: 0.11, freq: 392.0, dur: 0.16, amp: 0.23 }, // G4
      { offset: 0.22, freq: 493.88, dur: 0.17, amp: 0.25 }, // B4
      { offset: 0.33, freq: 587.33, dur: 0.25, amp: 0.28 }, // D5
    ];

    for (const note of grooveNotes) {
      const start = now + note.offset;
      const osc = ctx.createOscillator();
      const harm = ctx.createOscillator();
      const g = ctx.createGain();
      const hg = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.freq, start);

      harm.type = 'sine';
      harm.frequency.setValueAtTime(note.freq * 2, start);

      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(note.amp, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);

      hg.gain.setValueAtTime(0.0001, start);
      hg.gain.linearRampToValueAtTime(note.amp * 0.30, start + 0.008);
      hg.gain.exponentialRampToValueAtTime(0.0001, start + note.dur * 0.62);

      osc.connect(g);
      harm.connect(hg);
      g.connect(filter);
      hg.connect(filter);

      osc.start(start);
      harm.start(start);
      osc.stop(start + note.dur + 0.02);
      harm.stop(start + note.dur + 0.02);
    }

    // Warm disco maj9 chord shimmer on the final beat
    const shimmerStart = now + 0.33;
    const shimmerChord = discoSparkle
      ? [261.63, 392.0, 523.25, 659.25, 1046.5]
      : [261.63, 392.0, 493.88, 659.25];
    for (const freq of shimmerChord) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, shimmerStart);
      const amp = freq > 900 ? 0.10 : 0.12;
      g.gain.setValueAtTime(0.0001, shimmerStart);
      g.gain.linearRampToValueAtTime(amp, shimmerStart + 0.024);
      g.gain.exponentialRampToValueAtTime(0.0001, shimmerStart + 0.26);
      osc.connect(g);
      g.connect(filter);
      osc.start(shimmerStart);
      osc.stop(shimmerStart + 0.28);
    }
  }

  private playVinylSpinDown(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;

    // Soft vinyl needle lift hush
    this.playFilteredNoiseBurst(ctx, dest, now, 'pink', 1750, 1.4, 0.11, 0.048);

    // Smooth ~0.25s vinyl turntable spin-down pitch slide
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1650, now);
    lp.frequency.exponentialRampToValueAtTime(280, now + 0.25);
    lp.connect(dest);

    const layers: readonly [OscillatorType, number, number, number][] = [
      ['triangle', 392.0, 128.0, 0.28],
      ['sine', 196.0, 64.0, 0.22],
    ];

    for (const [type, startFreq, endFreq, amp] of layers) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.24);

      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

      osc.connect(g);
      g.connect(lp);
      osc.start(now);
      osc.stop(now + 0.28);
    }
  }

  private playMusicChordPulse(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;

    // Warm groove thump
    const kick = ctx.createOscillator();
    const kGain = ctx.createGain();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(128, now);
    kick.frequency.exponentialRampToValueAtTime(54, now + 0.088);
    kGain.gain.setValueAtTime(0.0001, now);
    kGain.gain.linearRampToValueAtTime(0.36, now + 0.006);
    kGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.115);
    kick.connect(kGain);
    kGain.connect(dest);
    kick.start(now);
    kick.stop(now + 0.125);

    // Warm cozy maj7 chord blip
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2100, now);
    filter.frequency.exponentialRampToValueAtTime(750, now + 0.26);
    filter.connect(dest);

    const chord = [261.63, 329.63, 392.0, 493.88];
    for (const freq of chord) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + 0.015);
      g.gain.setValueAtTime(0.0001, now + 0.015);
      g.gain.linearRampToValueAtTime(0.145, now + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      osc.connect(g);
      g.connect(filter);
      osc.start(now + 0.015);
      osc.stop(now + 0.28);
    }
  }

  private playDoorLatch(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    // Crisp wooden latch click
    const latch = ctx.createOscillator();
    const lGain = ctx.createGain();
    latch.type = 'triangle';
    latch.frequency.setValueAtTime(440, now);
    latch.frequency.exponentialRampToValueAtTime(245, now + 0.034);
    lGain.gain.setValueAtTime(0.0001, now);
    lGain.gain.linearRampToValueAtTime(0.34, now + 0.004);
    lGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.044);
    latch.connect(lGain);
    lGain.connect(dest);
    latch.start(now);
    latch.stop(now + 0.055);

    // Warm wooden creak
    const creak = ctx.createOscillator();
    const bp = ctx.createBiquadFilter();
    const cGain = ctx.createGain();
    creak.type = 'sawtooth';
    creak.frequency.setValueAtTime(200, now + 0.035);
    creak.frequency.linearRampToValueAtTime(244, now + 0.14);
    creak.frequency.linearRampToValueAtTime(220, now + 0.22);

    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(560, now + 0.035);
    bp.Q.setValueAtTime(3.0, now + 0.035);

    cGain.gain.setValueAtTime(0.0001, now + 0.035);
    cGain.gain.linearRampToValueAtTime(0.14, now + 0.075);
    cGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    creak.connect(bp);
    bp.connect(cGain);
    cGain.connect(dest);
    creak.start(now + 0.035);
    creak.stop(now + 0.25);
  }

  private playCushionPoof(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const { pink } = getNoiseBuffers(ctx);
    const src = ctx.createBufferSource();
    src.buffer = pink;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(680, now);
    lp.frequency.exponentialRampToValueAtTime(200, now + 0.16);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.linearRampToValueAtTime(0.28, now + 0.015);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    src.connect(lp);
    lp.connect(nGain);
    nGain.connect(dest);
    src.start(now, Math.random() * 1.4, 0.19);

    // Cozy soft bounce thump
    const thump = ctx.createOscillator();
    const tGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(165, now);
    thump.frequency.exponentialRampToValueAtTime(92, now + 0.09);
    tGain.gain.setValueAtTime(0.0001, now);
    tGain.gain.linearRampToValueAtTime(0.32, now + 0.008);
    tGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.105);
    thump.connect(tGain);
    tGain.connect(dest);
    thump.start(now);
    thump.stop(now + 0.12);
  }

  private playPlantRustleChime(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    this.playFilteredNoiseBurst(ctx, dest, now, 'pink', 1850, 1.6, 0.16, 0.13);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(jitter(880, 0.04), now + 0.02);
    g.gain.setValueAtTime(0.0001, now + 0.02);
    g.gain.linearRampToValueAtTime(0.24, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    osc.connect(g);
    g.connect(dest);
    osc.start(now + 0.02);
    osc.stop(now + 0.2);
  }

  private playKitchenChime(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    for (const [idx, freq] of [587.33, 880.0].entries()) {
      const start = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.28, start + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(g);
      g.connect(dest);
      osc.start(start);
      osc.stop(start + 0.21);
    }
  }

  private playWarmMarimbaChime(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const base = jitter(440, 0.05);
    for (const [idx, mult] of [1, 1.5].entries()) {
      const start = now + idx * 0.04;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base * mult, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.32, start + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(g);
      g.connect(dest);
      osc.start(start);
      osc.stop(start + 0.19);
    }
  }

  /** Iconic screaming yellow rubber chicken honk-squeak (~0.42s). */
  playChickenSqueak(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const duration = 0.42;

    // Resonant nasal bandpass + soft upper-shelf limiter so it's hilarious without harshness
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.setValueAtTime(6.0, now);
    bp.frequency.setValueAtTime(1280, now);
    bp.frequency.linearRampToValueAtTime(1420, now + 0.09);
    bp.frequency.exponentialRampToValueAtTime(1020, now + duration);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3400, now);

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(0.46, now + 0.014);
    bus.gain.setValueAtTime(0.42, now + 0.14);
    bus.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.03);

    bp.connect(lp);
    lp.connect(bus);
    bus.connect(dest);

    // Subtle rubber-reed warble LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(16, now);
    lfoGain.gain.setValueAtTime(42, now);
    lfo.connect(lfoGain);

    // Dual detuned sawtooth + triangle oscillators sweeping 1450 -> 2150 -> 620 Hz
    const voices: readonly [OscillatorType, number][] = [
      ['sawtooth', 1.0],
      ['triangle', 1.018],
    ];
    voices.forEach(([type, ratio], idx) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(1450 * ratio, now);
      osc.frequency.exponentialRampToValueAtTime(2150 * ratio, now + 0.085);
      osc.frequency.linearRampToValueAtTime(1920 * ratio, now + 0.145);
      osc.frequency.exponentialRampToValueAtTime(620 * ratio, now + duration);

      lfoGain.connect(osc.frequency);
      osc.connect(bp);
      osc.onended = () => {
        osc.disconnect();
        if (idx === voices.length - 1) {
          lfo.disconnect();
          lfoGain.disconnect();
          bp.disconnect();
          lp.disconnect();
          bus.disconnect();
        }
      };
      osc.start(now);
      osc.stop(now + duration + 0.04);
    });

    lfo.start(now);
    lfo.stop(now + duration + 0.04);

    // Tiny rubber-reed air squeeze puff
    this.playFilteredNoiseBurst(ctx, dest, now, 'pink', 1600, 2.2, 0.1, 0.042);
  }

  /** Swirling dimensional green portal warp whoosh + bubbly shimmer (~0.65s). */
  playPortalWarp(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const duration = 0.65;

    // Swirling sci-fi bandpass + FM LFO
    const vortexLp = ctx.createBiquadFilter();
    vortexLp.type = 'lowpass';
    vortexLp.Q.setValueAtTime(2.6, now);
    vortexLp.frequency.setValueAtTime(650, now);
    vortexLp.frequency.exponentialRampToValueAtTime(2800, now + 0.28);
    vortexLp.frequency.exponentialRampToValueAtTime(520, now + duration);

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(0.36, now + 0.06);
    bus.gain.setValueAtTime(0.32, now + 0.34);
    bus.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.03);

    vortexLp.connect(bus);
    bus.connect(dest);

    // Swirling FM LFO modulating pitch & vortex shimmer
    const lfo = ctx.createOscillator();
    const lfoPitch = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(11, now);
    lfo.frequency.linearRampToValueAtTime(19, now + 0.28);
    lfo.frequency.linearRampToValueAtTime(7.5, now + duration);
    lfoPitch.gain.setValueAtTime(85, now);
    lfo.connect(lfoPitch);

    const carriers: readonly [OscillatorType, number][] = [
      ['sine', 1.0],
      ['triangle', 1.5],
    ];
    carriers.forEach(([type, mult], idx) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(180 * mult, now);
      osc.frequency.exponentialRampToValueAtTime(880 * mult, now + 0.28);
      osc.frequency.exponentialRampToValueAtTime(240 * mult, now + duration);

      lfoPitch.connect(osc.frequency);
      osc.connect(vortexLp);
      osc.onended = () => {
        osc.disconnect();
        if (idx === carriers.length - 1) {
          lfo.disconnect();
          lfoPitch.disconnect();
          vortexLp.disconnect();
          bus.disconnect();
        }
      };
      osc.start(now);
      osc.stop(now + duration + 0.04);
    });

    lfo.start(now);
    lfo.stop(now + duration + 0.04);

    // Filtered bubbly sci-fi noise shimmer
    const { pink } = getNoiseBuffers(ctx);
    const noise = ctx.createBufferSource();
    noise.buffer = pink;
    const nBp = ctx.createBiquadFilter();
    nBp.type = 'bandpass';
    nBp.Q.setValueAtTime(3.2, now);
    nBp.frequency.setValueAtTime(620, now);
    nBp.frequency.exponentialRampToValueAtTime(2500, now + 0.3);
    nBp.frequency.exponentialRampToValueAtTime(720, now + duration);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.0001, now);
    nGain.gain.linearRampToValueAtTime(0.24, now + 0.09);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(nBp);
    nBp.connect(nGain);
    nGain.connect(dest);
    noise.onended = () => {
      noise.disconnect();
      nBp.disconnect();
      nGain.disconnect();
    };
    noise.start(now, Math.random() * 1.4, duration + 0.02);

    // Staggered sci-fi portal bubble blips
    const bubbles = [
      { offset: 0.06, f0: 680, f1: 1180 },
      { offset: 0.17, f0: 960, f1: 1580 },
      { offset: 0.31, f0: 1240, f1: 860 },
      { offset: 0.46, f0: 820, f1: 540 },
    ];
    for (const b of bubbles) {
      const t = now + b.offset;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(b.f0, t);
      osc.frequency.exponentialRampToValueAtTime(b.f1, t + 0.075);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
      osc.connect(g);
      g.connect(dest);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.095);
    }
  }

  /** Punchy Baki roundhouse WHAM + snappy slap + comedic launch whistle. */
  playComicKick(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;

    // 1. Crisp low-end punch thump (150 -> 38 Hz)
    const punch = ctx.createOscillator();
    const pGain = ctx.createGain();
    punch.type = 'sine';
    punch.frequency.setValueAtTime(150, now);
    punch.frequency.exponentialRampToValueAtTime(38, now + 0.11);
    pGain.gain.setValueAtTime(0.0001, now);
    pGain.gain.linearRampToValueAtTime(0.5, now + 0.004);
    pGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    punch.connect(pGain);
    pGain.connect(dest);
    punch.onended = () => {
      punch.disconnect();
      pGain.disconnect();
    };
    punch.start(now);
    punch.stop(now + 0.16);

    // Mid-body comic impact crack
    const crack = ctx.createOscillator();
    const cGain = ctx.createGain();
    crack.type = 'triangle';
    crack.frequency.setValueAtTime(420, now);
    crack.frequency.exponentialRampToValueAtTime(105, now + 0.045);
    cGain.gain.setValueAtTime(0.0001, now);
    cGain.gain.linearRampToValueAtTime(0.28, now + 0.003);
    cGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    crack.connect(cGain);
    cGain.connect(dest);
    crack.onended = () => {
      crack.disconnect();
      cGain.disconnect();
    };
    crack.start(now);
    crack.stop(now + 0.065);

    // 2. Snappy slap noise burst
    this.playFilteredNoiseBurst(ctx, dest, now, 'white', 1450, 0.9, 0.34, 0.055);

    // 3. Brief rising comedic launch slide-whistle (520 -> 1400 Hz)
    const wStart = now + 0.045;
    const whistle = ctx.createOscillator();
    const wGain = ctx.createGain();
    whistle.type = 'sine';
    whistle.frequency.setValueAtTime(520, wStart);
    whistle.frequency.exponentialRampToValueAtTime(1400, wStart + 0.24);
    wGain.gain.setValueAtTime(0.0001, wStart);
    wGain.gain.linearRampToValueAtTime(0.26, wStart + 0.018);
    wGain.gain.setValueAtTime(0.23, wStart + 0.18);
    wGain.gain.exponentialRampToValueAtTime(0.0001, wStart + 0.27);
    whistle.connect(wGain);
    wGain.connect(dest);
    whistle.onended = () => {
      whistle.disconnect();
      wGain.disconnect();
    };
    whistle.start(wStart);
    whistle.stop(wStart + 0.285);
  }

  /** One enveloped oscillator sweep; the building block of the showdown cues. */
  private playSweep(
    ctx: AudioContext,
    dest: AudioNode,
    type: OscillatorType,
    start: number,
    fromHz: number,
    toHz: number,
    peak: number,
    attack: number,
    duration: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, start);
    osc.frequency.exponentialRampToValueAtTime(toHz, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(dest);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** Showdown: short metallic stab — sharp steel tick over a dull body thud. */
  playShowdownStab(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    this.playSweep(ctx, dest, 'square', now, 2400, 900, 0.12, 0.002, 0.07);
    this.playSweep(ctx, dest, 'sine', now, 170, 46, 0.5, 0.004, 0.2);
    this.playFilteredNoiseBurst(ctx, dest, now, 'white', 3200, 1.2, 0.3, 0.05);
  }

  /** Showdown: one overlapping swell of the charging hum (~0.7s); pitch climbs with `level` 0..1. */
  playShowdownCharge(ctx: AudioContext, dest: AudioNode, level: number): void {
    const now = ctx.currentTime;
    const l = Math.max(0, Math.min(1, level));
    const base = 70 * Math.pow(2, l * 1.6);
    this.playSweep(ctx, dest, 'sawtooth', now, base, base * 1.12, 0.05 + l * 0.05, 0.25, 0.7);
    this.playSweep(ctx, dest, 'sine', now, base * 2, base * 2.3, 0.07 + l * 0.06, 0.25, 0.7);
    this.playSweep(ctx, dest, 'sine', now, base * 3.01, base * 3.5, 0.03 + l * 0.04, 0.3, 0.7);
  }

  /** Showdown: Blue forming — a hollow tone sinking inward, with air being drawn in. */
  playShowdownBlue(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    this.playSweep(ctx, dest, 'sine', now, 420, 150, 0.16, 0.35, 1.7);
    this.playSweep(ctx, dest, 'triangle', now, 840, 300, 0.05, 0.4, 1.5);
    this.playSweep(ctx, dest, 'sine', now + 0.1, 74, 52, 0.2, 0.5, 1.6);
    this.playFilteredNoiseBurst(ctx, dest, now + 0.15, 'pink', 500, 2.5, 0.06, 1.2);
  }

  /** Showdown: Red forming — a bright tone pushing upward and outward, with a hot edge. */
  playShowdownRed(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    this.playSweep(ctx, dest, 'sawtooth', now, 160, 520, 0.06, 0.5, 1.5);
    this.playSweep(ctx, dest, 'sine', now, 320, 1040, 0.11, 0.6, 1.5);
    this.playSweep(ctx, dest, 'square', now + 0.2, 640, 1560, 0.025, 0.7, 1.2);
    this.playFilteredNoiseBurst(ctx, dest, now + 0.3, 'white', 2600, 1.8, 0.05, 1.0);
  }

  /** Showdown: the two collide — a crack, a clashing dissonance and a body thump. */
  playShowdownMerge(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    this.playFilteredNoiseBurst(ctx, dest, now, 'white', 4200, 0.9, 0.32, 0.09);
    this.playSweep(ctx, dest, 'sine', now, 190, 44, 0.55, 0.006, 0.55);
    this.playSweep(ctx, dest, 'sawtooth', now, 233, 208, 0.07, 0.02, 1.1);
    this.playSweep(ctx, dest, 'sawtooth', now, 311, 349, 0.06, 0.02, 1.1);
    this.playSweep(ctx, dest, 'triangle', now + 0.04, 1400, 480, 0.08, 0.01, 0.5);
  }

  /** Showdown: one electric crackle off the purple sphere. */
  playShowdownCrackle(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    this.playFilteredNoiseBurst(ctx, dest, now, 'white', 5200, 1.4, 0.16, 0.05);
    this.playFilteredNoiseBurst(ctx, dest, now + 0.06, 'white', 3400, 1.4, 0.11, 0.04);
    this.playSweep(ctx, dest, 'square', now, 1800, 700, 0.035, 0.002, 0.09);
  }

  /** Showdown: deep whoomph on release — sub drop, air rush and a falling tail. */
  playShowdownFire(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    this.playSweep(ctx, dest, 'sine', now, 120, 28, 0.7, 0.012, 0.9);
    this.playSweep(ctx, dest, 'triangle', now, 320, 60, 0.26, 0.01, 0.5);
    this.playSweep(ctx, dest, 'sawtooth', now + 0.03, 900, 110, 0.07, 0.05, 1.1);
    this.playFilteredNoiseBurst(ctx, dest, now, 'brown', 240, 0.7, 0.6, 0.6);
    this.playFilteredNoiseBurst(ctx, dest, now + 0.02, 'white', 1800, 0.6, 0.16, 0.35);
  }

  /**
   * Showdown: Hollow Purple's blast — a crack, a distorted thump and a long rumble. The low end is
   * pushed through soft clipping so its harmonics are heard on laptop speakers, not just subwoofers.
   */
  playShowdownExplosion(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 4);
    shaper.curve = curve;
    const shaped = ctx.createGain();
    shaped.gain.value = 0.55;
    shaper.connect(shaped);
    shaped.connect(dest);

    this.playSweep(ctx, shaper, 'sine', now, 170, 38, 0.9, 0.004, 0.8);
    this.playSweep(ctx, shaper, 'triangle', now + 0.02, 95, 28, 0.6, 0.01, 1.4);
    this.playFilteredNoiseBurst(ctx, dest, now, 'white', 2600, 0.5, 0.8, 0.16);
    this.playFilteredNoiseBurst(ctx, shaper, now + 0.04, 'brown', 110, 0.7, 0.8, 3.0);

    // Body: noise through a lowpass closing from 5 kHz to 180 Hz as the blast rolls away.
    const body = ctx.createBufferSource();
    body.buffer = getNoiseBuffers(ctx).pink;
    body.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, now);
    lp.frequency.exponentialRampToValueAtTime(180, now + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.85, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
    body.connect(lp);
    lp.connect(g);
    g.connect(dest);
    body.onended = () => {
      body.disconnect();
      lp.disconnect();
      g.disconnect();
    };
    body.start(now);
    body.stop(now + 2.9);

    // Debris ticking down afterwards.
    for (let i = 0; i < 7; i++) {
      this.playFilteredNoiseBurst(ctx, dest, now + 0.25 + Math.random() * 1.4, 'white', 1800 + Math.random() * 2600, 2, 0.18, 0.05);
    }
    setTimeout(() => shaped.disconnect(), 3500);
  }

  /** Showdown: the blade landing — a punchy, mid-heavy body hit that reads on small speakers. */
  playShowdownHit(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    this.playSweep(ctx, dest, 'sine', now, 240, 70, 0.8, 0.003, 0.28);
    this.playSweep(ctx, dest, 'square', now, 140, 60, 0.18, 0.003, 0.16);
    this.playFilteredNoiseBurst(ctx, dest, now, 'white', 3200, 0.8, 0.6, 0.09);
    this.playFilteredNoiseBurst(ctx, dest, now + 0.01, 'pink', 600, 0.9, 0.5, 0.22);
  }

  /** Ethereal Gojo celestial levitation chime chord shimmer (~1.4s). */
  playGojoAscend(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const duration = 1.4;

    // Shimmering lowpass halo bus opening & gently closing
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, now);
    lp.frequency.exponentialRampToValueAtTime(4200, now + 0.55);
    lp.frequency.exponentialRampToValueAtTime(1850, now + duration);
    lp.connect(dest);

    // Gentle celestial vibrato LFO
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.type = 'sine';
    vib.frequency.setValueAtTime(5.2, now);
    vibGain.gain.setValueAtTime(4.5, now);
    vib.connect(vibGain);
    vib.start(now);
    vib.stop(now + duration + 0.15);

    // Warm airy sub-root C4 pad
    const root = ctx.createOscillator();
    const rGain = ctx.createGain();
    root.type = 'sine';
    root.frequency.setValueAtTime(261.63, now);
    rGain.gain.setValueAtTime(0.0001, now);
    rGain.gain.linearRampToValueAtTime(0.14, now + 0.28);
    rGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    root.connect(rGain);
    rGain.connect(lp);
    root.onended = () => {
      root.disconnect();
      rGain.disconnect();
    };
    root.start(now);
    root.stop(now + duration + 0.04);

    // Crystalline major-9th bell shimmer: C5 + G5 + B5 + D6 + E6
    const shimmerNotes: readonly { freq: number; offset: number; amp: number }[] = [
      { freq: 523.25, offset: 0.0, amp: 0.15 }, // C5
      { freq: 783.99, offset: 0.06, amp: 0.14 }, // G5
      { freq: 987.77, offset: 0.12, amp: 0.13 }, // B5
      { freq: 1174.66, offset: 0.19, amp: 0.12 }, // D6
      { freq: 1318.51, offset: 0.26, amp: 0.11 }, // E6
    ];

    shimmerNotes.forEach((n, idx) => {
      const start = now + n.offset;
      const noteEnd = now + duration + 0.05;

      const osc = ctx.createOscillator();
      const harm = ctx.createOscillator();
      const g = ctx.createGain();
      const hg = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, start);
      vibGain.connect(osc.frequency);

      harm.type = 'triangle';
      harm.frequency.setValueAtTime(n.freq * 2, start);

      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(n.amp, start + 0.24);
      g.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      hg.gain.setValueAtTime(0.0001, start);
      hg.gain.linearRampToValueAtTime(n.amp * 0.22, start + 0.16);
      hg.gain.exponentialRampToValueAtTime(0.0001, start + 0.85);

      osc.connect(g);
      harm.connect(hg);
      g.connect(lp);
      hg.connect(lp);

      osc.onended = () => {
        osc.disconnect();
        harm.disconnect();
        g.disconnect();
        hg.disconnect();
        if (idx === shimmerNotes.length - 1) {
          vib.disconnect();
          vibGain.disconnect();
          lp.disconnect();
        }
      };

      osc.start(start);
      harm.start(start);
      osc.stop(noteEnd + 0.03);
      harm.stop(noteEnd + 0.03);
    });
  }

  /** Eridian musical chord speech (3 rapid warm polyphonic harmonic triads, ~0.14s each). */
  playRockyChords(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;
    const transpose = jitter(1.0, 0.06);

    const triads: readonly { offset: number; freqs: readonly [number, number, number]; bend: number }[] = [
      { offset: 0.0, freqs: [293.66, 440.0, 587.33], bend: 1.025 },
      { offset: 0.155, freqs: [369.99, 554.37, 659.25], bend: 0.985 },
      { offset: 0.31, freqs: [392.0, 493.88, 739.99], bend: 1.035 },
    ];

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(1.6, now);
    lp.frequency.setValueAtTime(1650, now);
    lp.connect(dest);

    triads.forEach((triad, tIdx) => {
      const start = now + triad.offset;
      const chordDur = 0.14;
      const isLastTriad = tIdx === triads.length - 1;

      triad.freqs.forEach((baseHz, nIdx) => {
        const freq = baseHz * transpose;
        const osc = ctx.createOscillator();
        const over = ctx.createOscillator();
        const g = ctx.createGain();
        const og = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(freq * triad.bend, start + chordDur);

        over.type = 'sine';
        over.frequency.setValueAtTime(freq * 2, start);
        over.frequency.exponentialRampToValueAtTime(freq * 2 * triad.bend, start + chordDur);

        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.16, start + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, start + chordDur);

        og.gain.setValueAtTime(0.0001, start);
        og.gain.linearRampToValueAtTime(0.055, start + 0.012);
        og.gain.exponentialRampToValueAtTime(0.0001, start + chordDur * 0.85);

        osc.connect(g);
        over.connect(og);
        g.connect(lp);
        og.connect(lp);

        const isVeryLast = isLastTriad && nIdx === triad.freqs.length - 1;
        osc.onended = () => {
          osc.disconnect();
          over.disconnect();
          g.disconnect();
          og.disconnect();
          if (isVeryLast) {
            lp.disconnect();
          }
        };

        osc.start(start);
        over.start(start);
        osc.stop(start + chordDur + 0.02);
        over.stop(start + chordDur + 0.02);
      });
    });
  }

  /** Crisp cartoon hollow wooden baseball-bat BONK! (~0.18s). */
  playTungBatBonk(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;

    // Punchy hollow wood-knock sine drop (360 -> 145 Hz)
    const body = ctx.createOscillator();
    const bGain = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(jitter(360, 0.03), now);
    body.frequency.exponentialRampToValueAtTime(145, now + 0.15);

    bGain.gain.setValueAtTime(0.0001, now);
    bGain.gain.linearRampToValueAtTime(0.46, now + 0.004);
    bGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    body.connect(bGain);
    bGain.connect(dest);
    body.onended = () => {
      body.disconnect();
      bGain.disconnect();
    };
    body.start(now);
    body.stop(now + 0.195);

    // Resonant hollow hardwood ring (~900 Hz bandpass)
    const ring = ctx.createOscillator();
    const bp = ctx.createBiquadFilter();
    const rGain = ctx.createGain();
    ring.type = 'triangle';
    ring.frequency.setValueAtTime(880, now);
    ring.frequency.exponentialRampToValueAtTime(540, now + 0.085);

    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, now);
    bp.Q.setValueAtTime(3.2, now);

    rGain.gain.setValueAtTime(0.0001, now);
    rGain.gain.linearRampToValueAtTime(0.24, now + 0.003);
    rGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    ring.connect(bp);
    bp.connect(rGain);
    rGain.connect(dest);
    ring.onended = () => {
      ring.disconnect();
      bp.disconnect();
      rGain.disconnect();
    };
    ring.start(now);
    ring.stop(now + 0.115);

    // Short woody impact body click (~900 Hz)
    this.playFilteredNoiseBurst(ctx, dest, now, 'pink', 900, 2.6, 0.24, 0.045);
  }

  /**
   * Iconic 3-hit hollow wooden kentongan/log-drum beat ("TUNG! - TUNG! - TUNG!")
   * at 0.00s, 0.28s, 0.56s followed by a louder resonant 4th hit ("SAHUR!!") at 0.90s.
   */
  playTungChant(ctx: AudioContext, dest: AudioNode): void {
    const now = ctx.currentTime;

    // 3 rhythmic kentongan log-drum strikes
    const hits: readonly { offset: number; f0: number; f1: number; amp: number }[] = [
      { offset: 0.0, f0: 232, f1: 188, amp: 0.38 },
      { offset: 0.28, f0: 236, f1: 191, amp: 0.4 },
      { offset: 0.56, f0: 242, f1: 194, amp: 0.42 },
    ];

    for (const hit of hits) {
      const t = now + hit.offset;

      const drum = ctx.createOscillator();
      const dGain = ctx.createGain();
      drum.type = 'sine';
      drum.frequency.setValueAtTime(hit.f0, t);
      drum.frequency.exponentialRampToValueAtTime(hit.f1, t + 0.16);

      dGain.gain.setValueAtTime(0.0001, t);
      dGain.gain.linearRampToValueAtTime(hit.amp, t + 0.004);
      dGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

      drum.connect(dGain);
      dGain.connect(dest);
      drum.onended = () => {
        drum.disconnect();
        dGain.disconnect();
      };
      drum.start(t);
      drum.stop(t + 0.235);

      // Hollow slit-drum wooden chamber overtone
      const wood = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const wGain = ctx.createGain();
      wood.type = 'triangle';
      wood.frequency.setValueAtTime(hit.f0 * 2.75, t);
      wood.frequency.exponentialRampToValueAtTime(hit.f1 * 2.7, t + 0.11);

      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(760, t);
      bp.Q.setValueAtTime(4.0, t);

      wGain.gain.setValueAtTime(0.0001, t);
      wGain.gain.linearRampToValueAtTime(0.18, t + 0.003);
      wGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

      wood.connect(bp);
      bp.connect(wGain);
      wGain.connect(dest);
      wood.onended = () => {
        wood.disconnect();
        bp.disconnect();
        wGain.disconnect();
      };
      wood.start(t);
      wood.stop(t + 0.145);

      // Mallet-on-log tap transient
      this.playFilteredNoiseBurst(ctx, dest, t, 'pink', 1050, 2.5, 0.16, 0.032);
    }

    // 4th louder dramatic final log resonance ("SAHUR!!") at 0.90s
    const finale = now + 0.9;

    const mainLog = ctx.createOscillator();
    const mGain = ctx.createGain();
    mainLog.type = 'sine';
    mainLog.frequency.setValueAtTime(260, finale);
    mainLog.frequency.exponentialRampToValueAtTime(155, finale + 0.42);

    mGain.gain.setValueAtTime(0.0001, finale);
    mGain.gain.linearRampToValueAtTime(0.5, finale + 0.005);
    mGain.gain.exponentialRampToValueAtTime(0.0001, finale + 0.5);

    mainLog.connect(mGain);
    mGain.connect(dest);
    mainLog.onended = () => {
      mainLog.disconnect();
      mGain.disconnect();
    };
    mainLog.start(finale);
    mainLog.stop(finale + 0.52);

    // Subtle woody chord ring (hollow 5th + octave + wooden bar harmonic)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1750, finale);
    lp.frequency.exponentialRampToValueAtTime(720, finale + 0.46);
    lp.connect(dest);

    const chordPartials: readonly [OscillatorType, number, number, number][] = [
      ['triangle', 390, 240, 0.18],
      ['sine', 520, 310, 0.14],
      ['triangle', 715, 580, 0.11],
    ];
    chordPartials.forEach(([type, f0, f1, amp], idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, finale);
      osc.frequency.exponentialRampToValueAtTime(f1, finale + 0.42);

      g.gain.setValueAtTime(0.0001, finale);
      g.gain.linearRampToValueAtTime(amp, finale + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, finale + 0.46);

      osc.connect(g);
      g.connect(lp);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
        if (idx === chordPartials.length - 1) {
          lp.disconnect();
        }
      };
      osc.start(finale);
      osc.stop(finale + 0.48);
    });

    this.playFilteredNoiseBurst(ctx, dest, finale, 'pink', 960, 2.2, 0.24, 0.045);
  }

  private playFilteredNoiseBurst(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    kind: 'white' | 'pink' | 'brown',
    freq: number,
    q: number,
    peakGain: number,
    durationSec: number,
  ): void {
    const buffers = getNoiseBuffers(ctx);
    const src = ctx.createBufferSource();
    src.buffer = buffers[kind];

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, startTime);
    filter.Q.setValueAtTime(q, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.008, durationSec * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(startTime, Math.random() * 1.5, durationSec + 0.02);
  }
}
