import type { WeatherDef } from '../data/schemas';
import { getNoiseBuffers } from './FoleySynth';

interface ActiveBed {
  weatherId: string;
  bedGain: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  timers: number[];
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
      timers: [],
      disposed: false,
    };

    this.populateBed(ctx, bed, weather);
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
    bed.timers = [];
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
    bed.timers = [];

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
      const timer = window.setTimeout(scheduleChirp, nextDelay);
      bed.timers.push(timer);
    };

    const initialTimer = window.setTimeout(scheduleChirp, 1200 + Math.random() * 1300);
    bed.timers.push(initialTimer);
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
      const timer = window.setTimeout(scheduleDroplet, nextDelay);
      bed.timers.push(timer);
    };
    const firstDroplet = window.setTimeout(scheduleDroplet, 450 + Math.random() * 500);
    bed.timers.push(firstDroplet);

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
        const timer = window.setTimeout(scheduleDistantRumble, nextDelay);
        bed.timers.push(timer);
      };

      const initialTimer = window.setTimeout(scheduleDistantRumble, 3000 + Math.random() * 2500);
      bed.timers.push(initialTimer);
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
      const timer = window.setTimeout(scheduleShimmer, nextDelay);
      bed.timers.push(timer);
    };

    const initialTimer = window.setTimeout(scheduleShimmer, 1400 + Math.random() * 1400);
    bed.timers.push(initialTimer);
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
      const timer = window.setTimeout(scheduleSwell, nextDelay);
      bed.timers.push(timer);
    };

    const initialTimer = window.setTimeout(scheduleSwell, 2000 + Math.random() * 1600);
    bed.timers.push(initialTimer);
  }
}
