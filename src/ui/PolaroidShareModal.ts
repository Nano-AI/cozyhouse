import type { AudioModule } from '../audio/AudioModule';
import type { SceneManager } from '../engine/SceneManager';
import { evaluateRoomType } from '../rooms/RoomEvaluator';
import { drawQrToCanvas } from '../save/qrCode';
import { encodeHouseToShareUrl } from '../save/shareLink';
import type { HouseStore } from '../state/houseStore';
import { createIconEl, createStorybookIconEl } from './icons';

const CARD_W = 960;
const CARD_H = 1160;
const PHOTO_PAD = 54;
const PHOTO_SIZE = CARD_W - PHOTO_PAD * 2; // 852×852 authentic square aperture

function formatTimeBucketLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5.2 || h >= 20.2) return 'Night';
  if (h < 9.0) return 'Dawn';
  if (h < 16.8) return 'Day';
  return 'Sunset';
}

function slugifyFilename(caption: string): string {
  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'my-house';
}

export class PolaroidShareModal {
  private readonly root: HTMLElement;
  private readonly store: HouseStore;
  private readonly sceneManager: SceneManager;
  private readonly audioModule?: AudioModule;

  private backdropEl: HTMLDivElement;
  private previewCanvasEl: HTMLCanvasElement;
  private captionInputEl!: HTMLInputElement;
  private fullSceneBtnEl!: HTMLButtonElement;
  private houseOnlyBtnEl!: HTMLButtonElement;
  private withGuestsBtnEl!: HTMLButtonElement;
  private emptyHouseBtnEl!: HTMLButtonElement;
  private qrSwitchBtnEl!: HTMLButtonElement;
  private freezeBtnEl!: HTMLButtonElement;

  private openState = false;
  private includeBackdrop = true;
  private includeVisitors = true;
  private includeQr = true;
  private captionText = '';
  private shareUrl: string | null = null;
  private capturedImg: HTMLImageElement | null = null;
  private renderToken = 0;
  private unsubscribes: Array<() => void> = [];

  constructor(
    root: HTMLElement,
    store: HouseStore,
    sceneManager: SceneManager,
    audioModule?: AudioModule,
  ) {
    this.root = root;
    this.store = store;
    this.sceneManager = sceneManager;
    this.audioModule = audioModule;

    this.previewCanvasEl = document.createElement('canvas');
    this.previewCanvasEl.width = CARD_W;
    this.previewCanvasEl.height = CARD_H;
    this.previewCanvasEl.className = 'polaroid-preview-canvas';
    this.previewCanvasEl.setAttribute('aria-label', 'Polaroid house preview');

    this.backdropEl = this.buildModal();
    this.root.appendChild(this.backdropEl);

    this.unsubscribes.push(
      this.store.on('simSpeedChanged', () => this.syncFreezeButton()),
    );

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.openState) {
        event.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    this.unsubscribes.push(() => window.removeEventListener('keydown', onKeyDown, true));
  }

  isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    const evaluation = evaluateRoomType(this.store.getState(), this.store.data);
    this.captionText = evaluation.labelInfo.label;
    this.captionInputEl.value = this.captionText;
    this.openState = true;
    this.backdropEl.classList.remove('hidden');
    this.syncToggleStates();
    this.syncFreezeButton();

    this.shareUrl = null;
    void this.refreshShareUrl();
    this.captureAndRender();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.backdropEl.classList.add('hidden');
  }

  dispose(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.backdropEl.remove();
  }

  private buildModal(): HTMLDivElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'polaroid-modal-backdrop hidden';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Share Your House Polaroid Studio');
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) {
        this.audioModule?.playUiClick();
        this.close();
      }
    });

    const card = document.createElement('div');
    card.className = 'polaroid-modal-card';

    // Left column: live Polaroid instant print preview
    const previewCol = document.createElement('div');
    previewCol.className = 'polaroid-preview-col';
    const frameWrap = document.createElement('div');
    frameWrap.className = 'polaroid-preview-frame';
    frameWrap.appendChild(this.previewCanvasEl);
    previewCol.appendChild(frameWrap);

    // Right column: studio controls
    const ctrlCol = document.createElement('div');
    ctrlCol.className = 'polaroid-controls-col';

    const header = document.createElement('div');
    header.className = 'polaroid-modal-header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'polaroid-title-wrap';
    titleWrap.appendChild(createStorybookIconEl('polaroid', 24));
    const h3 = document.createElement('h3');
    h3.textContent = 'Share Your House';
    titleWrap.appendChild(h3);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn icon-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close Share Studio');
    closeBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.close();
    });
    header.append(titleWrap, closeBtn);
    ctrlCol.appendChild(header);

    // Editable caption
    const capGroup = document.createElement('div');
    capGroup.className = 'polaroid-field';
    const capLabel = document.createElement('label');
    capLabel.className = 'popover-section-label';
    capLabel.textContent = 'Caption';
    this.captionInputEl = document.createElement('input');
    this.captionInputEl.type = 'text';
    this.captionInputEl.className = 'custom-room-input';
    this.captionInputEl.placeholder = 'Name your cozy space…';
    this.captionInputEl.maxLength = 34;
    this.captionInputEl.setAttribute('aria-label', 'Polaroid caption');
    this.captionInputEl.addEventListener('input', () => {
      this.captionText = this.captionInputEl.value;
      this.composePolaroidCanvas();
    });
    capGroup.append(capLabel, this.captionInputEl);
    ctrlCol.appendChild(capGroup);

    // Background mode: Full Scene vs House Only
    const bgGroup = document.createElement('div');
    bgGroup.className = 'polaroid-field';
    const bgLabel = document.createElement('span');
    bgLabel.className = 'popover-section-label';
    bgLabel.textContent = 'Background';
    const bgSeg = document.createElement('div');
    bgSeg.className = 'polaroid-seg-group';

    this.fullSceneBtnEl = document.createElement('button');
    this.fullSceneBtnEl.type = 'button';
    this.fullSceneBtnEl.className = 'polaroid-seg-btn';
    this.fullSceneBtnEl.textContent = 'Full Scene';
    this.fullSceneBtnEl.addEventListener('click', () => {
      if (this.includeBackdrop) return;
      this.audioModule?.playUiClick();
      this.includeBackdrop = true;
      this.syncToggleStates();
      this.captureAndRender();
    });

    this.houseOnlyBtnEl = document.createElement('button');
    this.houseOnlyBtnEl.type = 'button';
    this.houseOnlyBtnEl.className = 'polaroid-seg-btn';
    this.houseOnlyBtnEl.textContent = 'House Only';
    this.houseOnlyBtnEl.addEventListener('click', () => {
      if (!this.includeBackdrop) return;
      this.audioModule?.playUiClick();
      this.includeBackdrop = false;
      this.syncToggleStates();
      this.captureAndRender();
    });

    bgSeg.append(this.fullSceneBtnEl, this.houseOnlyBtnEl);
    bgGroup.append(bgLabel, bgSeg);
    ctrlCol.appendChild(bgGroup);

    // Visitors toggle: With Guests vs House Empty
    const guestGroup = document.createElement('div');
    guestGroup.className = 'polaroid-field';
    const guestLabel = document.createElement('span');
    guestLabel.className = 'popover-section-label';
    guestLabel.textContent = 'Guests';
    const guestSeg = document.createElement('div');
    guestSeg.className = 'polaroid-seg-group';

    this.withGuestsBtnEl = document.createElement('button');
    this.withGuestsBtnEl.type = 'button';
    this.withGuestsBtnEl.className = 'polaroid-seg-btn';
    this.withGuestsBtnEl.textContent = 'With Guests';
    this.withGuestsBtnEl.addEventListener('click', () => {
      if (this.includeVisitors) return;
      this.audioModule?.playUiClick();
      this.includeVisitors = true;
      this.syncToggleStates();
      this.captureAndRender();
    });

    this.emptyHouseBtnEl = document.createElement('button');
    this.emptyHouseBtnEl.type = 'button';
    this.emptyHouseBtnEl.className = 'polaroid-seg-btn';
    this.emptyHouseBtnEl.textContent = 'House Empty';
    this.emptyHouseBtnEl.addEventListener('click', () => {
      if (!this.includeVisitors) return;
      this.audioModule?.playUiClick();
      this.includeVisitors = false;
      this.syncToggleStates();
      this.captureAndRender();
    });

    guestSeg.append(this.withGuestsBtnEl, this.emptyHouseBtnEl);
    guestGroup.append(guestLabel, guestSeg);
    ctrlCol.appendChild(guestGroup);

    // Include QR toggle row
    const qrRow = document.createElement('div');
    qrRow.className = 'polaroid-switch-row';
    const qrLbl = document.createElement('span');
    qrLbl.className = 'polaroid-switch-label';
    qrLbl.textContent = 'Scannable QR Code';

    this.qrSwitchBtnEl = document.createElement('button');
    this.qrSwitchBtnEl.type = 'button';
    this.qrSwitchBtnEl.className = 'sb-toggle-switch on';
    this.qrSwitchBtnEl.setAttribute('role', 'switch');
    this.qrSwitchBtnEl.setAttribute('aria-checked', 'true');
    this.qrSwitchBtnEl.setAttribute('aria-label', 'Include scannable QR code');
    const qrKnob = document.createElement('span');
    qrKnob.className = 'sb-toggle-knob';
    this.qrSwitchBtnEl.appendChild(qrKnob);
    this.qrSwitchBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.includeQr = !this.includeQr;
      this.syncToggleStates();
      this.composePolaroidCanvas();
    });
    qrRow.append(qrLbl, this.qrSwitchBtnEl);
    ctrlCol.appendChild(qrRow);

    // Retake + Freeze Scene quick row
    const utilRow = document.createElement('div');
    utilRow.className = 'polaroid-util-row';

    const retakeBtn = document.createElement('button');
    retakeBtn.type = 'button';
    retakeBtn.className = 'btn';
    retakeBtn.appendChild(createIconEl('reset', 14));
    const retakeSpan = document.createElement('span');
    retakeSpan.textContent = 'Retake Photo';
    retakeBtn.appendChild(retakeSpan);
    retakeBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.captureAndRender();
    });

    this.freezeBtnEl = document.createElement('button');
    this.freezeBtnEl.type = 'button';
    this.freezeBtnEl.className = 'btn';
    this.freezeBtnEl.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      const isPaused = this.store.getSimSpeed() === 0;
      this.store.setSimSpeed(isPaused ? 1 : 0);
      this.syncFreezeButton();
    });

    utilRow.append(retakeBtn, this.freezeBtnEl);
    ctrlCol.appendChild(utilRow);

    // Share actions
    const actionsCol = document.createElement('div');
    actionsCol.className = 'polaroid-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'btn primary full-width';
    downloadBtn.appendChild(createIconEl('download', 15));
    const dlText = document.createElement('span');
    dlText.textContent = 'Download Polaroid';
    downloadBtn.appendChild(dlText);
    downloadBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      this.downloadPolaroid();
    });

    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'polaroid-secondary-actions';

    const copyImgBtn = document.createElement('button');
    copyImgBtn.type = 'button';
    copyImgBtn.className = 'btn';
    copyImgBtn.appendChild(createIconEl('copy', 14));
    const ciText = document.createElement('span');
    ciText.textContent = 'Copy Image';
    copyImgBtn.appendChild(ciText);
    copyImgBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      void this.copyPolaroidImage();
    });

    const copyLinkBtn = document.createElement('button');
    copyLinkBtn.type = 'button';
    copyLinkBtn.className = 'btn';
    copyLinkBtn.appendChild(createIconEl('share', 14));
    const clText = document.createElement('span');
    clText.textContent = 'Copy Link';
    copyLinkBtn.appendChild(clText);
    copyLinkBtn.addEventListener('click', () => {
      this.audioModule?.playUiClick();
      void this.copyShareLink();
    });

    secondaryActions.append(copyImgBtn, copyLinkBtn);
    actionsCol.append(downloadBtn, secondaryActions);
    ctrlCol.appendChild(actionsCol);

    card.append(previewCol, ctrlCol);
    backdrop.appendChild(card);
    return backdrop;
  }

  private syncToggleStates(): void {
    this.fullSceneBtnEl.classList.toggle('active', this.includeBackdrop);
    this.houseOnlyBtnEl.classList.toggle('active', !this.includeBackdrop);
    this.withGuestsBtnEl.classList.toggle('active', this.includeVisitors);
    this.emptyHouseBtnEl.classList.toggle('active', !this.includeVisitors);
    this.qrSwitchBtnEl.classList.toggle('on', this.includeQr);
    this.qrSwitchBtnEl.setAttribute('aria-checked', String(this.includeQr));
  }

  private syncFreezeButton(): void {
    if (!this.freezeBtnEl) return;
    const paused = this.store.getSimSpeed() === 0;
    this.freezeBtnEl.textContent = paused ? '▶ Resume Scene' : '⏸ Freeze Scene';
    this.freezeBtnEl.classList.toggle('polaroid-frozen-btn', paused);
  }

  private async refreshShareUrl(): Promise<void> {
    try {
      const url = await encodeHouseToShareUrl(this.store.getState());
      this.shareUrl = url;
      if (this.openState && this.includeQr) {
        this.composePolaroidCanvas();
      }
    } catch {
      this.shareUrl = null;
    }
  }

  private captureAndRender(): void {
    const token = ++this.renderToken;
    let dataUrl = '';
    try {
      dataUrl = this.sceneManager.captureHousePhoto({
        includeBackdrop: this.includeBackdrop,
        includeVisitors: this.includeVisitors,
      });
    } catch {
      this.store.notify('Could not capture photo', 'error');
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (token !== this.renderToken) return;
      this.capturedImg = img;
      this.composePolaroidCanvas();
    };
    img.src = dataUrl;
  }

  private composePolaroidCanvas(): void {
    const ctx = this.previewCanvasEl.getContext('2d');
    if (!ctx) return;

    // 1. Warm cream Polaroid cardstock background
    ctx.fillStyle = '#FCF9F2';
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // Subtle paper grain / warm studio edge tint
    const paperGrad = ctx.createLinearGradient(0, 0, 0, CARD_H);
    paperGrad.addColorStop(0, 'rgba(255, 253, 248, 0.45)');
    paperGrad.addColorStop(1, 'rgba(235, 224, 206, 0.25)');
    ctx.fillStyle = paperGrad;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // Outer storybook dark-ink border
    ctx.strokeStyle = '#2D2620';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, CARD_W - 8, CARD_H - 8);

    // 2. Square instant photo window (center-cropped cover fit)
    ctx.save();
    ctx.beginPath();
    ctx.rect(PHOTO_PAD, PHOTO_PAD, PHOTO_SIZE, PHOTO_SIZE);
    ctx.clip();

    ctx.fillStyle = '#F3ECE0';
    ctx.fillRect(PHOTO_PAD, PHOTO_PAD, PHOTO_SIZE, PHOTO_SIZE);

    if (this.capturedImg && this.capturedImg.naturalWidth > 0 && this.capturedImg.naturalHeight > 0) {
      const iw = this.capturedImg.naturalWidth;
      const ih = this.capturedImg.naturalHeight;
      const side = Math.min(iw, ih);
      const sx = (iw - side) / 2;
      const sy = (ih - side) / 2;
      ctx.drawImage(
        this.capturedImg,
        sx,
        sy,
        side,
        side,
        PHOTO_PAD,
        PHOTO_PAD,
        PHOTO_SIZE,
        PHOTO_SIZE,
      );
    }

    // Soft inner Polaroid aperture shadow along top/left edges
    const innerTop = ctx.createLinearGradient(0, PHOTO_PAD, 0, PHOTO_PAD + 28);
    innerTop.addColorStop(0, 'rgba(45, 38, 32, 0.16)');
    innerTop.addColorStop(1, 'rgba(45, 38, 32, 0)');
    ctx.fillStyle = innerTop;
    ctx.fillRect(PHOTO_PAD, PHOTO_PAD, PHOTO_SIZE, 28);

    const innerBottom = ctx.createLinearGradient(0, PHOTO_PAD + PHOTO_SIZE - 20, 0, PHOTO_PAD + PHOTO_SIZE);
    innerBottom.addColorStop(0, 'rgba(45, 38, 32, 0)');
    innerBottom.addColorStop(1, 'rgba(45, 38, 32, 0.1)');
    ctx.fillStyle = innerBottom;
    ctx.fillRect(PHOTO_PAD, PHOTO_PAD + PHOTO_SIZE - 20, PHOTO_SIZE, 20);
    ctx.restore();

    // Crisp ink photo aperture border
    ctx.strokeStyle = '#2D2620';
    ctx.lineWidth = 4;
    ctx.strokeRect(PHOTO_PAD, PHOTO_PAD, PHOTO_SIZE, PHOTO_SIZE);

    // 3. Polaroid bottom chin: Caption + Location/Time subtitle + optional QR
    const showQr = this.includeQr && Boolean(this.shareUrl);
    const chinLeft = PHOTO_PAD + 4;
    const textMaxWidth = showQr ? 610 : PHOTO_SIZE - 8;

    const state = this.store.getState();
    const viewName = this.store.data.viewsById.get(state.sceneryViewId)?.name ?? 'Suburbs';
    const weatherName = this.store.data.weathersById.get(state.weatherId)?.name ?? 'Clear';
    const timeLabel = formatTimeBucketLabel(this.store.getTimeHour());
    const subtitle =
      weatherName === 'Clear'
        ? `${viewName} · ${timeLabel}`
        : `${viewName} · ${timeLabel} · ${weatherName}`;

    const displayCaption = this.captionText.trim() || 'Cozyhouse';

    // Fit caption font size cleanly
    let fontSize = 46;
    ctx.fillStyle = '#2D2620';
    ctx.textBaseline = 'alphabetic';
    while (fontSize > 28) {
      ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI", sans-serif`;
      if (ctx.measureText(displayCaption).width <= textMaxWidth) break;
      fontSize -= 2;
    }
    ctx.fillText(displayCaption, chinLeft, 992, textMaxWidth);

    // Subtitle
    ctx.font = '600 24px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
    ctx.fillStyle = '#574D44';
    ctx.fillText(subtitle, chinLeft, 1034, textMaxWidth);

    // Subtle cozyhouse watermark
    ctx.font = '700 17px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "Segoe UI", sans-serif';
    ctx.fillStyle = '#756A5F';
    ctx.fillText('cozyhouse', chinLeft, 1112);

    // Optional scannable QR code on bottom-right of chin
    if (showQr && this.shareUrl) {
      const qrBoxSize = 186;
      const qrBoxX = CARD_W - PHOTO_PAD - qrBoxSize;
      const qrBoxY = 928;

      ctx.fillStyle = '#FFFDF8';
      ctx.fillRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);
      ctx.strokeStyle = 'rgba(45, 38, 32, 0.32)';
      ctx.lineWidth = 2;
      ctx.strokeRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);

      drawQrToCanvas(ctx, this.shareUrl, qrBoxX + 6, qrBoxY + 6, qrBoxSize - 12, {
        fg: '#2D2620',
        bg: '#FFFDF8',
        quietZone: 2,
      });

      ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
      ctx.fillStyle = '#574D44';
      ctx.textAlign = 'center';
      ctx.fillText('scan to visit', qrBoxX + qrBoxSize / 2, qrBoxY + qrBoxSize + 19);
      ctx.textAlign = 'start';
    }
  }

  private downloadPolaroid(): void {
    const filename = `cozyhouse-${slugifyFilename(this.captionText)}.png`;
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.previewCanvasEl.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
    this.store.notify(`Saved ${filename}`, 'success');
  }

  private async copyPolaroidImage(): Promise<void> {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      this.store.notify('Image clipboard unavailable — use Download Polaroid', 'info');
      return;
    }
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        this.previewCanvasEl.toBlob((b) => resolve(b), 'image/png'),
      );
      if (!blob) {
        this.store.notify('Could not encode Polaroid image', 'error');
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.store.notify('Polaroid image copied to clipboard!', 'success');
    } catch {
      this.store.notify('Browser blocked image copy — use Download Polaroid', 'info');
    }
  }

  private async copyShareLink(): Promise<void> {
    try {
      const url = this.shareUrl ?? (await encodeHouseToShareUrl(this.store.getState()));
      this.shareUrl = url;
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        } catch {
          copied = false;
        }
      }
      if (!copied) {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copied = document.execCommand('copy');
        ta.remove();
      }
      try {
        const parsed = new URL(url);
        if (parsed.hash) {
          window.history.replaceState(null, '', parsed.hash);
        }
      } catch {
        // Ignore history errors in sandboxed/file origins
      }
      this.store.notify(
        copied ? 'Share link copied!' : 'Share link updated in address bar',
        'success',
      );
    } catch (err) {
      this.store.notify(
        err instanceof Error ? err.message : 'Failed to create share link',
        'error',
      );
    }
  }
}
