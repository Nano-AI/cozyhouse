import type { VoiceProfile } from '../data/schemas';

interface SpeechToken {
  type: 'syllable' | 'pause';
  vowel: string;
  hash: number;
  durationFactor: number;
  pitchBoost: number;
  isQuestionEnd: boolean;
  isExclaimEnd: boolean;
}

const MAX_UTTERANCE_SECONDS = 2.15;

const VOWEL_FORMANT_HZ: Record<string, number> = {
  a: 1180,
  e: 1450,
  i: 1720,
  o: 980,
  u: 840,
  y: 1580,
};

// Warm major pentatonic intervals (semitones) for musical cozy cadence
const PENTATONIC_SEMITONES = [-4, -2, 0, 2, 4, 7];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function splitWordIntoSyllables(word: string): string[] {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) {
    return [];
  }

  const syllables: string[] = [];
  let current = '';
  let seenVowel = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    const isVowel = 'aeiouy'.includes(ch);

    if (seenVowel && !isVowel && current.length >= 2) {
      syllables.push(current);
      current = ch;
      seenVowel = false;
    } else {
      current += ch;
      if (isVowel) {
        seenVowel = true;
      }
    }
  }

  if (current.length > 0) {
    if (!seenVowel && syllables.length > 0) {
      syllables[syllables.length - 1] += current;
    } else {
      syllables.push(current);
    }
  }

  return syllables;
}

function extractDominantVowel(syllable: string): string {
  for (let i = 0; i < syllable.length; i += 1) {
    const ch = syllable[i];
    if ('aeiouy'.includes(ch)) {
      return ch;
    }
  }
  return 'o';
}

function tokenizeLine(text: string): SpeechToken[] {
  const tokens: SpeechToken[] = [];
  // Match segments of letters or punctuation sequences
  const segments = text.match(/[A-Za-z]+|\.{2,}|[!?.,-]+/g);
  if (!segments) {
    return tokens;
  }

  for (let sIdx = 0; sIdx < segments.length; sIdx += 1) {
    const seg = segments[sIdx];

    if (/^[A-Za-z]+$/.test(seg)) {
      const syls = splitWordIntoSyllables(seg);
      const nextSeg = segments[sIdx + 1] ?? '';
      const hasQuestion = nextSeg.includes('?');
      const hasExclaim = nextSeg.includes('!');
      const hasEllipsis = nextSeg.includes('...');

      for (let i = 0; i < syls.length; i += 1) {
        const syl = syls[i];
        const isLastInWord = i === syls.length - 1;
        tokens.push({
          type: 'syllable',
          vowel: extractDominantVowel(syl),
          hash: hashString(`${seg}:${i}:${syl}`),
          durationFactor: hasEllipsis && isLastInWord ? 1.2 : isLastInWord ? 1.05 : 0.92,
          pitchBoost: hasExclaim ? 1.08 : hasEllipsis && isLastInWord ? 0.95 : 1.0,
          isQuestionEnd: hasQuestion && isLastInWord,
          isExclaimEnd: hasExclaim && isLastInWord,
        });
      }
    } else if (seg.includes('...')) {
      tokens.push({
        type: 'pause',
        vowel: 'o',
        hash: 0,
        durationFactor: 1.5,
        pitchBoost: 1,
        isQuestionEnd: false,
        isExclaimEnd: false,
      });
    } else if (seg.includes(',') || seg.includes('.')) {
      tokens.push({
        type: 'pause',
        vowel: 'o',
        hash: 0,
        durationFactor: 0.85,
        pitchBoost: 1,
        isQuestionEnd: false,
        isExclaimEnd: false,
      });
    } else if (seg.includes('-')) {
      tokens.push({
        type: 'pause',
        vowel: 'o',
        hash: 0,
        durationFactor: 0.35,
        pitchBoost: 1,
        isQuestionEnd: false,
        isExclaimEnd: false,
      });
    } else if (seg.includes('!') || seg.includes('?')) {
      tokens.push({
        type: 'pause',
        vowel: 'o',
        hash: 0,
        durationFactor: 0.9,
        pitchBoost: 1,
        isQuestionEnd: false,
        isExclaimEnd: false,
      });
    }
  }

  return tokens;
}

export function speakGibberishLine(
  ctx: AudioContext,
  destination: AudioNode,
  text: string,
  voice: VoiceProfile,
  pitchOffset = 1,
  speedMultiplier = 1,
): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  const tokens = tokenizeLine(trimmed);
  if (tokens.length === 0) {
    return 0;
  }

  const safePitchOffset = clamp(pitchOffset, 0.55, 1.85);
  const safeSpeed = clamp(speedMultiplier, 0.55, 1.85);
  const basePitch = clamp(voice.basePitch, 110, 880) * safePitchOffset;
  const varianceHz = clamp(voice.pitchVariance, 5, 180);
  const syllableRate = clamp(voice.syllableRate, 2.0, 13.0) * safeSpeed;

  const baseStep = 1 / syllableRate;
  const waveform: OscillatorType = voice.waveform ?? 'sine';
  const waveformGainScale =
    waveform === 'square' ? 0.72 : waveform === 'sawtooth' ? 0.78 : waveform === 'triangle' ? 0.96 : 1.0;

  // Estimate raw duration and gently compress if needed to fit within MAX_UTTERANCE_SECONDS
  let rawTotal = 0;
  for (const tok of tokens) {
    rawTotal += tok.type === 'pause' ? baseStep * 0.65 * tok.durationFactor : baseStep * tok.durationFactor;
  }
  const timeScale = rawTotal > MAX_UTTERANCE_SECONDS ? MAX_UTTERANCE_SECONDS / rawTotal : 1;

  const startBase = ctx.currentTime + 0.015;
  let elapsed = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];

    if (tok.type === 'pause') {
      elapsed += baseStep * 0.65 * tok.durationFactor * timeScale;
      continue;
    }

    const slotDur = baseStep * tok.durationFactor * timeScale;
    if (elapsed + slotDur > MAX_UTTERANCE_SECONDS + 0.05) {
      break;
    }

    const sylDur = clamp(slotDur * 0.84, 0.048, 0.24);
    const sylStart = startBase + elapsed;
    const sylEnd = sylStart + sylDur;

    // Musical pitch selection from syllable hash + variance
    const semiIdx = tok.hash % PENTATONIC_SEMITONES.length;
    const semitone = PENTATONIC_SEMITONES[semiIdx];
    const varianceScale = clamp(varianceHz / 65, 0.35, 1.6);
    const pitchRatio = Math.pow(2, (semitone * varianceScale) / 12);

    const startFreq = clamp(basePitch * pitchRatio * tok.pitchBoost, 85, 1400);
    let endFreq = startFreq;
    if (tok.isQuestionEnd) {
      endFreq = clamp(startFreq * 1.24, 90, 1600);
    } else if (tok.isExclaimEnd) {
      endFreq = clamp(startFreq * 1.12, 90, 1600);
    } else {
      const glideDir = tok.hash % 3 === 0 ? 1.04 : 0.96;
      endFreq = clamp(startFreq * glideDir, 85, 1500);
    }

    const osc = ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.setValueAtTime(startFreq, sylStart);
    osc.frequency.exponentialRampToValueAtTime(endFreq, sylStart + sylDur * 0.88);

    // Warm vocal formant lowpass filter to shape vowel brightness without harshness
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const vowelHz = VOWEL_FORMANT_HZ[tok.vowel] ?? 1100;
    filter.frequency.setValueAtTime(Math.max(startFreq * 2.6, vowelHz), sylStart);
    filter.Q.setValueAtTime(1.9, sylStart);

    // Click-free smooth attack/release envelope at a warm, clearly audible level
    const env = ctx.createGain();
    const peakGain = 0.34 * waveformGainScale * (tok.isExclaimEnd ? 1.12 : 1.0);
    const attack = Math.min(0.016, sylDur * 0.24);
    const releaseStart = Math.max(sylStart + attack + 0.005, sylEnd - Math.min(0.032, sylDur * 0.35));

    env.gain.setValueAtTime(0.0001, sylStart);
    env.gain.linearRampToValueAtTime(peakGain, sylStart + attack);
    env.gain.setValueAtTime(peakGain * 0.88, releaseStart);
    env.gain.exponentialRampToValueAtTime(0.0001, sylEnd);

    osc.connect(filter);
    filter.connect(env);
    env.connect(destination);

    osc.onended = () => {
      osc.disconnect();
      filter.disconnect();
      env.disconnect();
    };

    osc.start(sylStart);
    osc.stop(sylEnd + 0.01);

    elapsed += slotDur;
  }

  return clamp(elapsed, 0, MAX_UTTERANCE_SECONDS + 0.05);
}
