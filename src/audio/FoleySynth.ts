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

    if (hasAny(['sleep', 'seating', 'plushie', 'bed', 'sofa', 'chair', 'beanbag', 'cushion', 'armchair', 'loveseat'])) {
      this.playCushionPoof(ctx, dest);
      return;
    }

    if (hasAny(['plants', 'plant', 'monstera', 'fern', 'bonsai', 'cactus', 'ivy', 'terrarium', 'flower'])) {
      this.playPlantRustleChime(ctx, dest);
      return;
    }

    if (hasAny(['cook', 'kitchen', 'stove', 'toaster', 'microwave', 'fridge', 'sink'])) {
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
