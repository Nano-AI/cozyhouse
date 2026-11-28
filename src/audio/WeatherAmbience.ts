import type { WeatherDef } from '../data/schemas';
import { getNoiseBuffers } from './FoleySynth';

interface ActiveBed {
  weatherId: string;
  bedGain: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  timers: Set<number>;
  disposed: boolean;
}

/**
 * Continuous procedural Web Audio weather ambience beds with smooth crossfading.
 * Supports: clear, rain, snow, fog, thunderstorm (and sensible wind/rain fallbacks).
 */
export class WeatherAmbience {
  private activeBed: ActiveBed | null = null;
  private retiringBeds = new Set<ActiveBed>();
  private cleanupTimers = new Set<number>();

  getActiveWeatherId(): string | null {
    return this.activeBed?.weatherId ?? null;
  }

  setWeather(ctx: AudioContext, dest: AudioNode, weather: WeatherDef): void {
    if (this.activeBed && this.activeBed.weatherId === weather.id && !this.activeBed.disposed) {
      return;
    }

    const now = ctx.currentTime;

    if (this.activeBed) {
      this.fadeOutAndStopBed(this.activeBed, now);
      this.activeBed = null;
    }

    const bedGain = ctx.createGain();
    bedGain.gain.setValueAtTime(0.0001, now);
    bedGain.gain.setTargetAtTime(1, now, 0.35);
    bedGain.connect(dest);

    const bed: ActiveBed = {
      weatherId: weather.id,
      bedGain,
      sources: [],
      nodes: [bedGain],
      timers: new Set<number>(),
      disposed: false,
    };

    this.populateBed(ctx, bed, weather);
    this.activeBed = bed;
  }

  /**
   * Enables or disables the Level 0 Backrooms 60 Hz fluorescent tube hum bed.
   * When enabled, smoothly crossfades out any outdoor weather bed; when disabled,
   * crossfades back to `fallbackWeather` if provided or smoothly fades to silence.
   */
  setBackroomsHum(
    ctx: AudioContext,
    dest: AudioNode,
    enabled: boolean,
    fallbackWeather?: WeatherDef | null,
  ): void {
    if (!enabled) {
      if (fallbackWeather) {
        this.setWeather(ctx, dest, fallbackWeather);
        return;
      }
      if (this.activeBed && this.activeBed.weatherId === 'backrooms') {
        this.fadeOutAndStopBed(this.activeBed, ctx.currentTime);
        this.activeBed = null;
      }
      return;
    }

    if (this.activeBed && this.activeBed.weatherId === 'backrooms' && !this.activeBed.disposed) {
      return;
    }

    const now = ctx.currentTime;
    if (this.activeBed) {
      this.fadeOutAndStopBed(this.activeBed, now);
      this.activeBed = null;
    }

    const bedGain = ctx.createGain();
    bedGain.gain.setValueAtTime(0.0001, now);
    bedGain.gain.setTargetAtTime(1, now, 0.4);
    bedGain.connect(dest);

    const bed: ActiveBed = {
      weatherId: 'backrooms',
      bedGain,
      sources: [],
      nodes: [bedGain],
      timers: new Set<number>(),
      disposed: false,
    };

    this.buildBackroomsHumBed(ctx, bed);
    this.activeBed = bed;
  }

  dispose(): void {
    for (const timer of this.cleanupTimers) {
      window.clearTimeout(timer);
    }
    this.cleanupTimers.clear();

    if (this.activeBed) {
      this.stopBedImmediately(this.activeBed);
      this.activeBed = null;
    }

    for (const bed of this.retiringBeds) {
      this.stopBedImmediately(bed);
    }
    this.retiringBeds.clear();
  }

  private fadeOutAndStopBed(bed: ActiveBed, now: number): void {
    for (const timer of bed.timers) {
      window.clearTimeout(timer);
    }
    bed.timers.clear();
    bed.disposed = true;

    try {
      bed.bedGain.gain.cancelScheduledValues(now);
      bed.bedGain.gain.setValueAtTime(bed.bedGain.gain.value, now);
      bed.bedGain.gain.setTargetAtTime(0.0001, now, 0.25);
    } catch {
      // Ignore if context is already closing
    }

    this.retiringBeds.add(bed);
    const cleanupTimer = window.setTimeout(() => {
      this.cleanupTimers.delete(cleanupTimer);
      this.retiringBeds.delete(bed);
      this.stopBedImmediately(bed);
    }, 1400);
    this.cleanupTimers.add(cleanupTimer);
  }

  private stopBedImmediately(bed: ActiveBed): void {
    bed.disposed = true;
    for (const timer of bed.timers) {
      window.clearTimeout(timer);
    }
    bed.timers.clear();

    for (const src of bed.sources) {
      try {
        src.stop();
      } catch {
        // Already stopped
      }
      try {
        src.disconnect();
      } catch {
        // Ignore
      }
    }
    bed.sources = [];

    for (const node of bed.nodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore
      }
    }
    bed.nodes = [];
  }

  private scheduleBedTimer(bed: ActiveBed, fn: () => void, delayMs: number): void {
    if (bed.disposed) return;
    const timer = window.setTimeout(() => {
      bed.timers.delete(timer);
      if (bed.disposed) return;
      fn();
    }, delayMs);
    bed.timers.add(timer);
  }

  private populateBed(ctx: AudioContext, bed: ActiveBed, weather: WeatherDef): void {
    switch (weather.id) {
      case 'clear':
        this.buildClearBed(ctx, bed);
        break;
      case 'rain':
        this.buildRainBed(ctx, bed, false);
        break;
      case 'snow':
        this.buildSnowBed(ctx, bed);
        break;
      case 'fog':
        this.buildFogBed(ctx, bed);
        break;
      case 'thunderstorm':
        this.buildRainBed(ctx, bed, true);
        break;
      case 'backrooms':
        this.buildBackroomsHumBed(ctx, bed);
        break;
      default:
        if (weather.particleType === 'rain') {
          this.buildRainBed(ctx, bed, weather.lightning);
        } else if (weather.particleType === 'snow') {
          this.buildSnowBed(ctx, bed);
        } else {
          this.buildClearBed(ctx, bed);
        }
        break;
    }
  }

  private addNoiseLoop(
    ctx: AudioContext,
    bed: ActiveBed,
    kind: 'pink' | 'brown',
    filterType: BiquadFilterType,
    filterFreq: number,
    filterQ: number,
    baseGain: number,
    lfoFreq?: number,
    lfoDepth?: number,
  ): void {
    const now = ctx.currentTime;
    const buffers = getNoiseBuffers(ctx);

    const src = ctx.createBufferSource();
    src.buffer = buffers[kind];
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.Q.setValueAtTime(filterQ, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(baseGain, now);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(bed.bedGain);

    bed.sources.push(src);
    bed.nodes.push(filter, gain);

    if (lfoFreq && lfoDepth) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(lfoFreq, now);
      lfoGain.gain.setValueAtTime(lfoDepth, now);

      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start(now);

      bed.sources.push(lfo);
      bed.nodes.push(lfoGain);
    }

    src.start(now, Math.random() * 1.8);
  }

  private buildClearBed(ctx: AudioContext, bed: ActiveBed): void {
    // Warm, clearly audible outdoor air breeze + subtle sunlit foliage shimmer
    this.addNoiseLoop(ctx, bed, 'pink', 'lowpass', 520, 0.65, 0.085, 0.09, 0.025);
    this.addNoiseLoop(ctx, bed, 'pink', 'bandpass', 1250, 0.9, 0.028, 0.06, 0.01);

    // Pleasant gentle pentatonic bird chirps every 3.5–7.0s
    const pentatonic = [1318.51, 1479.98, 1760.0, 1975.53, 2217.46];
    const scheduleChirp = () => {
      if (bed.disposed) return;
      if (ctx.state === 'running') {
        const now = ctx.currentTime;
        const notes = 2 + (Math.random() > 0.5 ? 1 : 0);
        const chirpLevel = 0.14 + Math.random() * 0.06;
        for (let i = 0; i < notes; i++) {
          const start = now + i * 0.095;
          const freq = pentatonic[Math.floor(Math.random() * pentatonic.length)];
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq * 0.93, start);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.07, start + 0.05);

          g.gain.setValueAtTime(0.0001, start);
          g.gain.linearRampToValueAtTime(chirpLevel, start + 0.014);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.085);

          osc.connect(g);
          g.connect(bed.bedGain);
          osc.onended = () => {
            osc.disconnect();
            g.disconnect();
          };
          osc.start(start);
          osc.stop(start + 0.095);
        }
      }
      const nextDelay = 3500 + Math.random() * 3500;
      this.scheduleBedTimer(bed, scheduleChirp, nextDelay);
    };

    this.scheduleBedTimer(bed, scheduleChirp, 1200 + Math.random() * 1300);
  }

  private buildRainBed(ctx: AudioContext, bed: ActiveBed, stormy: boolean): void {
    // Crisp, cozy steady rain wash
    const now = ctx.currentTime;
    const buffers = getNoiseBuffers(ctx);

    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = buffers.pink;
    rainSrc.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(stormy ? 940 : 1080, now);
    bp.Q.setValueAtTime(0.55, now);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(stormy ? 2950 : 2800, now);

    const rGain = ctx.createGain();
    rGain.gain.setValueAtTime(stormy ? 0.28 : 0.24, now);

    rainSrc.connect(bp);
    bp.connect(lp);
    lp.connect(rGain);
    rGain.connect(bed.bedGain);
    rainSrc.start(now, Math.random() * 1.5);

    bed.sources.push(rainSrc);
    bed.nodes.push(bp, lp, rGain);

    // Layered droplet texture modulation
    this.addNoiseLoop(
      ctx,
      bed,
      'pink',
      'bandpass',
      2350,
      1.3,
      stormy ? 0.11 : 0.09,
      0.28,
      0.03,
    );

    // Soft cozy droplet plinks (subtle rhythmic windowpane texture)
    const dropletPitches = [1380, 1640, 1920, 2240, 2580];
    const scheduleDroplet = () => {
      if (bed.disposed) return;
      if (ctx.state === 'running') {
        const t = ctx.currentTime;
        const freq = dropletPitches[Math.floor(Math.random() * dropletPitches.length)];
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.28, t + 0.028);

        const peak = 0.042 + Math.random() * 0.028;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

        osc.connect(g);
        g.connect(bed.bedGain);
        osc.onended = () => {
          osc.disconnect();
          g.disconnect();
        };
        osc.start(t);
        osc.stop(t + 0.055);
      }
      const nextDelay = (stormy ? 350 : 520) + Math.random() * 680;
      this.scheduleBedTimer(bed, scheduleDroplet, nextDelay);
    };
    this.scheduleBedTimer(bed, scheduleDroplet, 450 + Math.random() * 500);

    if (stormy) {
      // Expressive gentle wind gusts
      this.addNoiseLoop(ctx, bed, 'pink', 'bandpass', 420, 1.2, 0.12, 0.15, 0.055);

      // Clear deep rolling distant thunder rumbles
      const scheduleDistantRumble = () => {
        if (bed.disposed) return;
        if (ctx.state === 'running') {
          const t = ctx.currentTime;
          const src = ctx.createBufferSource();
          src.buffer = buffers.brown;
          src.loop = true;

          const low = ctx.createBiquadFilter();
          low.type = 'lowpass';
          low.Q.setValueAtTime(0.85, t);
          low.frequency.setValueAtTime(240, t);
          low.frequency.linearRampToValueAtTime(140, t + 0.65);
          low.frequency.exponentialRampToValueAtTime(80, t + 2.1);

          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.35, t + 0.22);
          g.gain.linearRampToValueAtTime(0.24, t + 0.85);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 2.25);

          src.connect(low);
          low.connect(g);
          g.connect(bed.bedGain);
          src.onended = () => {
            src.disconnect();
            low.disconnect();
            g.disconnect();
          };
          src.start(t, Math.random() * 1.4);
          src.stop(t + 2.35);
        }
        const nextDelay = 7500 + Math.random() * 7000;
        this.scheduleBedTimer(bed, scheduleDistantRumble, nextDelay);
      };

      this.scheduleBedTimer(bed, scheduleDistantRumble, 3000 + Math.random() * 2500);
    }
  }

  private buildSnowBed(ctx: AudioContext, bed: ActiveBed): void {
    // Clear silky winter breeze
    this.addNoiseLoop(ctx, bed, 'pink', 'lowpass', 580, 0.7, 0.14, 0.11, 0.035);
    this.addNoiseLoop(ctx, bed, 'pink', 'bandpass', 960, 1.3, 0.052, 0.08, 0.018);

    // Delicate crystalline chime sparkles
    const chimes = [1567.98, 1760.0, 2093.0, 2349.32];
    const scheduleShimmer = () => {
      if (bed.disposed) return;
      if (ctx.state === 'running') {
        const now = ctx.currentTime;
        const freq = chimes[Math.floor(Math.random() * chimes.length)];
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.10, now + 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

        osc.connect(g);
        g.connect(bed.bedGain);
        osc.onended = () => {
          osc.disconnect();
          g.disconnect();
        };
        osc.start(now);
        osc.stop(now + 0.66);
      }
      const nextDelay = 3800 + Math.random() * 3600;
      this.scheduleBedTimer(bed, scheduleShimmer, nextDelay);
    };

    this.scheduleBedTimer(bed, scheduleShimmer, 1400 + Math.random() * 1400);
  }

  private buildFogBed(ctx: AudioContext, bed: ActiveBed): void {
    // Warm gentle atmospheric hush
    this.addNoiseLoop(ctx, bed, 'brown', 'lowpass', 360, 0.7, 0.14, 0.07, 0.03);
    this.addNoiseLoop(ctx, bed, 'pink', 'bandpass', 500, 0.85, 0.052, 0.05, 0.016);

    // Occasional distant soft harmonic swell
    const swells: readonly [number, number][] = [
      [220.0, 329.63], // A3 + E4
      [246.94, 369.99], // B3 + F#4
      [196.0, 293.66], // G3 + D4
    ];
    const scheduleSwell = () => {
      if (bed.disposed) return;
      if (ctx.state === 'running') {
        const now = ctx.currentTime;
        const pair = swells[Math.floor(Math.random() * swells.length)];
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(740, now);
        lp.connect(bed.bedGain);

        pair.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          g.gain.setValueAtTime(0.0001, now);
          g.gain.linearRampToValueAtTime(0.055, now + 0.85);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
          osc.connect(g);
          g.connect(lp);
          osc.onended = () => {
            osc.disconnect();
            g.disconnect();
            if (idx === pair.length - 1) {
              lp.disconnect();
            }
          };
          osc.start(now);
          osc.stop(now + 2.7);
        });
      }
      const nextDelay = 6000 + Math.random() * 5000;
      this.scheduleBedTimer(bed, scheduleSwell, nextDelay);
    };

    this.scheduleBedTimer(bed, scheduleSwell, 2000 + Math.random() * 1600);
  }

  private buildBackroomsHumBed(ctx: AudioContext, bed: ActiveBed): void {
    const now = ctx.currentTime;

    // Tastefully quiet fluorescent ballast bus (~0.055 peak into weatherGain)
    const humBus = ctx.createGain();
    humBus.gain.setValueAtTime(1.0, now);
    humBus.connect(bed.bedGain);

    // Gentle slow ballast volume flutter
    const flutterLfo = ctx.createOscillator();
    const flutterGain = ctx.createGain();
    flutterLfo.type = 'sine';
    flutterLfo.frequency.setValueAtTime(0.24, now);
    flutterGain.gain.setValueAtTime(0.07, now);
    flutterLfo.connect(flutterGain);
    flutterGain.connect(humBus.gain);
    flutterLfo.start(now);

    bed.sources.push(flutterLfo);
    bed.nodes.push(humBus, flutterGain);

    // 1. Quiet 60 Hz AC mains fundamental (sine)
    const hum60 = ctx.createOscillator();
    const g60 = ctx.createGain();
    hum60.type = 'sine';
    hum60.frequency.setValueAtTime(60, now);
    g60.gain.setValueAtTime(0.032, now);
    hum60.connect(g60);
    g60.connect(humBus);
    hum60.start(now);

    // 2. Soft 120 Hz fluorescent ballast harmonic (lowpass-smoothed triangle)
    const hum120 = ctx.createOscillator();
    const lp120 = ctx.createBiquadFilter();
    const g120 = ctx.createGain();
    hum120.type = 'triangle';
    hum120.frequency.setValueAtTime(120, now);
    lp120.type = 'lowpass';
    lp120.frequency.setValueAtTime(420, now);
    g120.gain.setValueAtTime(0.02, now);
    hum120.connect(lp120);
    lp120.connect(g120);
    g120.connect(humBus);
    hum120.start(now);

    // 3. Subtle 180 Hz warm resonance trace so laptop speakers feel the hum clearly
    const hum180 = ctx.createOscillator();
    const g180 = ctx.createGain();
    hum180.type = 'sine';
    hum180.frequency.setValueAtTime(180, now);
    g180.gain.setValueAtTime(0.006, now);
    hum180.connect(g180);
    g180.connect(humBus);
    hum180.start(now);

    bed.sources.push(hum60, hum120, hum180);
    bed.nodes.push(g60, lp120, g120, g180);

    // 4. Very faint bandpass-filtered electrical hiss (~2400 Hz)
    this.addNoiseLoop(ctx, bed, 'pink', 'bandpass', 2400, 2.5, 0.008, 0.19, 0.002);

    // 5. Rare subtle aging-ballast micro-flicker dip (atmospheric, never startling)
    const scheduleFlicker = () => {
      if (bed.disposed) return;
      if (ctx.state === 'running') {
        const t = ctx.currentTime;
        try {
          humBus.gain.setValueAtTime(1.0, t);
          humBus.gain.linearRampToValueAtTime(0.84, t + 0.035);
          humBus.gain.linearRampToValueAtTime(1.04, t + 0.085);
          humBus.gain.linearRampToValueAtTime(1.0, t + 0.16);
        } catch {
          // Ignore if context is closing
        }
      }
      this.scheduleBedTimer(bed, scheduleFlicker, 8500 + Math.random() * 8000);
    };
    this.scheduleBedTimer(bed, scheduleFlicker, 5000 + Math.random() * 5000);
  }
}
