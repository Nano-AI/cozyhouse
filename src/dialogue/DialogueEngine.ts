import type { DialogueData, DialogueLine, VisitorMood } from '../data/schemas';

export interface EmoteVisual {
  id: string;
  glyph: string;
  label: string;
  color: string;
}

const SCRIPT_CHAR_MAP: Record<string, string> = {
  a: 'α',
  b: 'þ',
  c: 'ς',
  d: 'ð',
  e: 'ε',
  f: 'φ',
  g: 'γ',
  h: 'η',
  i: 'ι',
  j: 'ξ',
  k: 'κ',
  l: 'λ',
  m: 'μ',
  n: 'ν',
  o: 'ο',
  p: 'π',
  q: 'ψ',
  r: 'ρ',
  s: 'σ',
  t: 'τ',
  u: 'υ',
  v: 'β',
  w: 'ω',
  x: 'χ',
  y: 'ζ',
  z: 'δ',
  A: 'Α',
  B: 'Þ',
  C: 'Σ',
  D: 'Ð',
  E: 'Ε',
  F: 'Φ',
  G: 'Γ',
  H: 'Η',
  I: 'Ι',
  J: 'Ξ',
  K: 'Κ',
  L: 'Λ',
  M: 'Μ',
  N: 'Ν',
  O: 'Ο',
  P: 'Π',
  Q: 'Ψ',
  R: 'Ρ',
  S: 'Θ',
  T: 'Τ',
  U: 'Υ',
  V: 'Β',
  W: 'Ω',
  X: 'Χ',
  Y: 'Ζ',
  Z: 'Δ',
};

const EMOTE_VISUALS: Record<string, EmoteVisual> = {
  sparkles: { id: 'sparkles', glyph: '✨', label: 'Delighted', color: '#FFF1B8' },
  heart: { id: 'heart', glyph: '♥', label: 'Adore', color: '#F9CFD9' },
  smile: { id: 'smile', glyph: '☺', label: 'Happy', color: '#D7EED8' },
  note: { id: 'note', glyph: '♪', label: 'Humming', color: '#DCE9FA' },
  dots: { id: 'dots', glyph: '⋯', label: 'Thinking', color: '#ECE7DF' },
  look: { id: 'look', glyph: '◎', label: 'Curious', color: '#E2E9F2' },
  yawn: { id: 'yawn', glyph: '🥱', label: 'Sleepy', color: '#E9E2F5' },
  wave: { id: 'wave', glyph: '👋', label: 'Farewell', color: '#FCE2C4' },
  book: { id: 'book', glyph: '📖', label: 'Reading', color: '#D6E6F2' },
  glasses: { id: 'glasses', glyph: '👓', label: 'Studying', color: '#DFE6EE' },
  coffee: { id: 'coffee', glyph: '☕', label: 'Coffee', color: '#EBD7C5' },
  cloud: { id: 'cloud', glyph: '☁', label: 'Wistful', color: '#E5ECF3' },
  paw: { id: 'paw', glyph: '🐾', label: 'Cats!', color: '#FADAE2' },
  music: { id: 'music', glyph: '♫', label: 'Grooving', color: '#E6D9F7' },
  leaf: { id: 'leaf', glyph: '🌿', label: 'Botanical', color: '#D5EEDB' },
  moon: { id: 'moon', glyph: '☾', label: 'Nightfall', color: '#D8DFF5' },
  star: { id: 'star', glyph: '★', label: 'Starry', color: '#FDEBB2' },
  sweat: { id: 'sweat', glyph: '💧', label: 'Restless', color: '#DCECF8' },
  zzz: { id: 'zzz', glyph: '💤', label: 'Drowsy', color: '#E2DDF0' },
};

const FALLBACK_LINE: DialogueLine = {
  id: 'fallback_neu_1',
  text: 'Humu... lena to?',
  emote: 'dots',
  pitchOffset: 1,
  speedMultiplier: 1,
};

export class DialogueEngine {
  private readonly dialogue: DialogueData;
  private readonly lastLineByVisitor = new Map<string, string>();

  constructor(dialogue: DialogueData) {
    this.dialogue = dialogue;
  }

  pickLine(visitorId: string, mood: VisitorMood, excludeLineId?: string): DialogueLine {
    const visitorPool = this.dialogue.byVisitor?.[visitorId]?.[mood];
    const defaultPool = this.dialogue.default?.[mood];

    let pool: DialogueLine[] =
      visitorPool && visitorPool.length > 0
        ? visitorPool
        : defaultPool && defaultPool.length > 0
          ? defaultPool
          : [];

    if (pool.length === 0) {
      const neutralDefault = this.dialogue.default?.neutral;
      pool = neutralDefault && neutralDefault.length > 0 ? neutralDefault : [FALLBACK_LINE];
    }

    const lastPickedId = this.lastLineByVisitor.get(visitorId);
    let candidates = pool.filter((line) => line.id !== excludeLineId && line.id !== lastPickedId);

    if (candidates.length === 0 && excludeLineId) {
      candidates = pool.filter((line) => line.id !== excludeLineId);
    }
    if (candidates.length === 0) {
      candidates = pool;
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0] ?? FALLBACK_LINE;
    this.lastLineByVisitor.set(visitorId, chosen.id);
    return chosen;
  }

  formatInventedScript(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      out += SCRIPT_CHAR_MAP[ch] ?? ch;
    }
    return out;
  }

  getEmoteVisual(emoteId: string): EmoteVisual {
    const found = EMOTE_VISUALS[emoteId];
    if (found) {
      return found;
    }
    return {
      id: emoteId || 'dots',
      glyph: '✦',
      label: emoteId ? emoteId.replace(/_/g, ' ') : 'Thought',
      color: '#ECE7DF',
    };
  }
}
