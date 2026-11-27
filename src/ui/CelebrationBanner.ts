import type { RoomLabelInfo } from '../data/schemas';

const PASTEL_CONFETTI = [
  '#F0B6C2',
  '#AED6C4',
  '#EED79B',
  '#CEB5E6',
  '#E8BFA8',
  '#B7CEDC',
  '#E07A5F',
];

/**
 * Non-blocking celebratory banner with a soft pastel confetti burst
 * shown whenever user edits transform the evaluated room type.
 */
export class CelebrationBanner {
  private readonly container: HTMLDivElement;
  private readonly confettiLayer: HTMLDivElement;
  private readonly cardEl: HTMLDivElement;
  private readonly eyebrowEl: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly descEl: HTMLDivElement;
  private readonly badgeDotEl: HTMLSpanElement;

  private hideTimer: number | null = null;
  private cleanupTimer: number | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'celebration-host hidden';
    this.container.setAttribute('aria-live', 'polite');

    this.confettiLayer = document.createElement('div');
    this.confettiLayer.className = 'celebration-confetti';

    this.cardEl = document.createElement('div');
    this.cardEl.className = 'celebration-card';

    const header = document.createElement('div');
    header.className = 'celebration-header';

    this.badgeDotEl = document.createElement('span');
    this.badgeDotEl.className = 'celebration-dot';

    this.eyebrowEl = document.createElement('div');
    this.eyebrowEl.className = 'celebration-eyebrow';

    header.append(this.badgeDotEl, this.eyebrowEl);

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'celebration-title';

    this.descEl = document.createElement('div');
    this.descEl.className = 'celebration-desc';

    this.cardEl.append(header, this.titleEl, this.descEl);
    this.container.append(this.confettiLayer, this.cardEl);
    parent.appendChild(this.container);
  }

  show(info: RoomLabelInfo, previousLabel?: string): void {
    this.clearTimers();

    this.badgeDotEl.style.background = info.accentColor;
    this.cardEl.style.borderColor = info.accentColor;
    this.eyebrowEl.textContent =
      previousLabel && previousLabel !== info.label
        ? `${previousLabel} → Space Transformed`
        : 'Space Transformed';
    this.titleEl.textContent = info.label;
    this.descEl.textContent = info.description;

    this.spawnConfetti(info.accentColor);

    this.container.classList.remove('hidden', 'leaving');
    // Restart entrance animation cleanly on rapid consecutive changes
    this.cardEl.classList.remove('pop-in');
    void this.cardEl.offsetWidth;
    this.cardEl.classList.add('pop-in');

    this.hideTimer = window.setTimeout(() => {
      this.container.classList.add('leaving');
      this.cleanupTimer = window.setTimeout(() => {
        this.container.classList.add('hidden');
        this.container.classList.remove('leaving');
        this.confettiLayer.innerHTML = '';
      }, 360);
    }, 3400);
  }

  private spawnConfetti(accentColor: string): void {
    this.confettiLayer.innerHTML = '';
    const palette = [accentColor, ...PASTEL_CONFETTI];
    const count = 28;

    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      const shape = i % 3 === 0 ? 'circle' : i % 3 === 1 ? 'pill' : 'diamond';
      piece.className = `confetti-piece ${shape}`;
      const angle = ((Math.PI * 2) * i) / count + (Math.random() - 0.5) * 0.28;
      const dist = 64 + Math.random() * 110;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist * 0.65 + 24 + Math.random() * 36;
      const rot = Math.round((Math.random() - 0.5) * 320);
      const delay = Math.round(Math.random() * 90);
      const duration = 950 + Math.round(Math.random() * 450);

      piece.style.background = palette[i % palette.length];
      piece.style.setProperty('--dx', `${dx.toFixed(1)}px`);
      piece.style.setProperty('--dy', `${dy.toFixed(1)}px`);
      piece.style.setProperty('--rot', `${rot}deg`);
      piece.style.animationDelay = `${delay}ms`;
      piece.style.animationDuration = `${duration}ms`;

      this.confettiLayer.appendChild(piece);
    }
  }

  private clearTimers(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.cleanupTimer !== null) {
      window.clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  dispose(): void {
    this.clearTimers();
    this.container.remove();
  }
}
