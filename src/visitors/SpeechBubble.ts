import * as THREE from 'three';
import type { VisitorMood } from '../data/schemas';
import type { EmoteVisual } from '../dialogue/DialogueEngine';

const EMOTE_EMOJI_MAP: Record<string, string> = {
  sparkles: '✨',
  heart: '💖',
  smile: '😊',
  note: '🎵',
  dots: '💭',
  look: '👀',
  yawn: '🥱',
  wave: '👋',
  book: '📚',
  glasses: '👓',
  coffee: '☕',
  cloud: '☁️',
  paw: '🐾',
  music: '🎶',
  leaf: '🌿',
  moon: '🌙',
  star: '⭐',
  sweat: '💧',
  zzz: '💤',
  food: '🍳',
  art: '🎨',
  vinyl: '💿',
  sofa: '🛋️',
};

const EXTRA_EMOTE_COLOR: Record<string, string> = {
  food: '#F7DC9F',
  art: '#F6CAD6',
  vinyl: '#CFD9F5',
  sofa: '#F3D2BE',
};

const MOOD_FALLBACK_EMOJI: Record<VisitorMood, string> = {
  delighted: '🤩',
  happy: '😊',
  neutral: '💭',
  bored: '😴',
  leaving: '👋',
};

const MOOD_TINT_COLOR: Record<VisitorMood, string> = {
  delighted: '#F6D365',
  happy: '#9AD4A8',
  neutral: '#D6CEC4',
  bored: '#C8BFE6',
  leaving: '#F2B88B',
};

/**
 * Resolves a dialogue emote ID into a vivid, expressive emoji glyph.
 * Never returns Greek/Latin/invented text.
 */
export function resolveEmoteEmoji(
  emoteId: string,
  fallbackGlyph?: string,
  mood?: VisitorMood,
): string {
  if (emoteId && EMOTE_EMOJI_MAP[emoteId]) {
    return EMOTE_EMOJI_MAP[emoteId];
  }
  if (mood && MOOD_FALLBACK_EMOJI[mood]) {
    return MOOD_FALLBACK_EMOJI[mood];
  }
  return fallbackGlyph && fallbackGlyph.length <= 2 ? fallbackGlyph : '✨';
}

function darkenHex(hex: string, factor = 0.84): string {
  const c = new THREE.Color(hex || '#D8C7B6');
  c.multiplyScalar(factor);
  return `#${c.getHexString()}`;
}

/**
 * Sleek emoji-only pastel thought/emotion bubble floating above a visitor.
 * Displays ONLY a crisp expressive emoji + a subtle animated 3-bar "blabbering" soundwave
 * while the visitor's audible gibberish voice is playing — zero text or random glyphs.
 */
export class SpeechBubble {
  readonly sprite: THREE.Sprite;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;

  private emoji = '✨';
  private accentColor = '#F2D7B6';
  private remaining = 0;
  private duration = 3.8;
  private blabberRemaining = 0;
  private blabberElapsed = 0;
  private redrawTimer = 0;
  private needsRestingRedraw = false;

  private readonly baseScaleX = 0.78;
  private readonly baseScaleY = 0.84;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 192;
    this.canvas.height = 208;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });

    this.sprite = new THREE.Sprite(this.material);
    this.sprite.position.set(0, 1.66, 0);
    this.sprite.visible = false;
    this.sprite.renderOrder = 22;
  }

  isVisible(): boolean {
    return this.remaining > 0;
  }

  isBlabbering(): boolean {
    return this.blabberRemaining > 0 && this.remaining > 0;
  }

  /**
   * Displays an emoji-only emotion bubble with animated soundwave bars for `blabberSeconds`.
   */
  showEmote(
    emote: EmoteVisual,
    mood: VisitorMood,
    durationSeconds = 3.9,
    blabberSeconds = 1.65,
  ): void {
    this.emoji = resolveEmoteEmoji(emote.id, emote.glyph, mood);
    this.accentColor =
      EXTRA_EMOTE_COLOR[emote.id] ||
      (emote.color && emote.color !== '#ECE7DF' ? emote.color : undefined) ||
      MOOD_TINT_COLOR[mood] ||
      '#E8D5C4';
    this.duration = Math.max(2.2, durationSeconds);
    this.remaining = this.duration;
    this.blabberRemaining = Math.max(0.6, Math.min(blabberSeconds, this.duration - 0.5));
    this.blabberElapsed = 0;
    this.redrawTimer = 0;
    this.needsRestingRedraw = true;

    this.drawBubble(true, 0);

    this.material.opacity = 1;
    this.sprite.visible = true;
    this.sprite.scale.set(this.baseScaleX * 0.55, this.baseScaleY * 0.55, 1);
  }

  private drawBubble(showWave: boolean, phase: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const boxW = 148;
    const boxH = 148;
    const bx = (w - boxW) / 2;
    const by = 14;
    const radius = 48;
    const borderStroke = darkenHex(this.accentColor, 0.82);

    // Soft floating drop shadow
    ctx.fillStyle = 'rgba(65, 52, 42, 0.16)';
    ctx.beginPath();
    ctx.roundRect(bx, by + 7, boxW, boxH, radius);
    ctx.fill();

    // Warm cream pill body
    ctx.fillStyle = 'rgba(255, 252, 247, 0.97)';
    ctx.strokeStyle = borderStroke;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, radius);
    ctx.fill();
    ctx.stroke();

    // Soft pastel circular backdrop behind the emoji
    const emojiCy = showWave ? by + boxH * 0.45 : by + boxH * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = this.accentColor;
    ctx.beginPath();
    ctx.arc(cx, emojiCy, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Cute cozy speech tail at bottom center
    const tailY = by + boxH - 1;
    ctx.fillStyle = 'rgba(255, 252, 247, 0.97)';
    ctx.beginPath();
    ctx.moveTo(cx - 14, tailY - 2);
    ctx.lineTo(cx + 14, tailY - 2);
    ctx.lineTo(cx, tailY + 19);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = borderStroke;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 14, tailY);
    ctx.lineTo(cx, tailY + 19);
    ctx.lineTo(cx + 14, tailY);
    ctx.stroke();

    // Crisp, large expressive emoji (zero text!)
    ctx.fillStyle = '#3A312B';
    ctx.font = '68px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.emoji, cx, emojiCy + 3);

    // Animated 3-bar blabbering soundwave along bottom rim while voice plays
    if (showWave) {
      const waveBaseY = by + boxH - 22;
      const barWidth = 9;
      const gap = 14;
      const offsets = [0, 1.5, 3.0];
      ctx.fillStyle = darkenHex(this.accentColor, 0.7);

      for (let i = 0; i < 3; i++) {
        const pulse = 0.5 + 0.5 * Math.sin(phase * 13.5 + offsets[i]);
        const barH = 8 + pulse * 14;
        const barX = cx + (i - 1) * gap - barWidth / 2;
        const barY = waveBaseY - barH / 2;
        ctx.beginPath();
        ctx.roundRect(barX, barY, barWidth, barH, 4.5);
        ctx.fill();
      }
    }

    this.texture.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.remaining <= 0) {
      if (this.sprite.visible) {
        this.sprite.visible = false;
      }
      return;
    }

    this.remaining = Math.max(0, this.remaining - dt);
    const elapsed = this.duration - this.remaining;

    // Animate 3-bar blabbering indicator at ~15fps while voice plays
    if (this.blabberRemaining > 0) {
      this.blabberRemaining = Math.max(0, this.blabberRemaining - dt);
      this.blabberElapsed += dt;
      this.redrawTimer += dt;
      if (this.redrawTimer >= 0.066) {
        this.redrawTimer = 0;
        this.drawBubble(true, this.blabberElapsed);
      }
    } else if (this.needsRestingRedraw) {
      this.needsRestingRedraw = false;
      this.drawBubble(false, 0);
    }

    // Springy pop-in over first 0.2s
    const popT = Math.min(1, elapsed / 0.2);
    const scaleBoost = popT < 1 ? 0.55 + Math.sin(popT * Math.PI * 0.68) * 0.52 : 1;
    this.sprite.scale.set(this.baseScaleX * scaleBoost, this.baseScaleY * scaleBoost, 1);

    // Gentle buoyant float
    this.sprite.position.y = 1.66 + Math.sin(elapsed * 2.8) * 0.024;

    // Smooth fade out during last 0.45s
    if (this.remaining < 0.45) {
      this.material.opacity = Math.max(0, this.remaining / 0.45);
    } else {
      this.material.opacity = 1;
    }

    if (this.remaining === 0) {
      this.sprite.visible = false;
    }
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
