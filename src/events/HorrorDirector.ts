import * as THREE from 'three';
import type { AudioModule } from '../audio/AudioModule';
import { Dirge, RainSwell, playCreak, playVanish } from '../audio/dirge';
import { wallEdgeToWorldTransform } from '../engine/GridSystem';
import type { SceneManager } from '../engine/SceneManager';
import type { HouseStore } from '../state/houseStore';
import type { BiomeRoute } from '../visitors/ArrivalTransport';
import {
  buildNavGrid,
  computeReachableDistances,
  findGridPath,
  findNearestWalkableTile,
  hasWallEdgeBetween,
  inGridBounds,
  tileCenterToWorld,
  tileIndex,
  type DoorEntry,
  type GridCoord,
  type NavGrid,
  type WorldPoint,
} from '../visitors/Pathfinder';
import type { HorrorVictimHandle, VisitorModule } from '../visitors/VisitorModule';
import { DustBurst, countTriangles, createLastGuestRig, getLastGuestPortrait, type LastGuestRig } from './horrorMeshes';

/**
 * "The Last Guest": a rare horror event.
 *
 * Timing: the event runs on REAL time (the render loop's unscaled realDt), not sim time, so the
 * visuals stay in sync with the live Web Audio dirge and play the same at 0×/1×/2×/5×. The visitor
 * sim is held and the 24h clock paused for the duration. The random trigger rides VisitorModule's
 * legendary-guest spawner, which runs on sim time (so it never fires while paused).
 *
 * Nothing here mutates the saved house: lights, materials, CSS and camera change only visually and
 * are restored to their exact prior values; staff are hidden, never fired; the door policy (a
 * session-only store field) is overridden to Full and handed back afterwards.
 */

const PEACEFUL_KEY = 'cozyhouse:peaceful';
/** He comes on his own at most once per play session (dev invites ignore this). */
const MET_KEY = 'cozyhouse:lastGuestMet';
const LAST_GUEST_WEATHERS = new Set(['rain', 'thunderstorm', 'fog']);
const KILL_RADIUS = 1.75;
const APPROACH_SPEED = 0.85;
/** He outpaces everyone: guests stumble along at GUEST_FLEE_SPEED. */
const HUNT_SPEED = 1.35;
const GUEST_FLEE_SPEED = 1.15;
/** He only comes to a full house: more than this many guests. */
const MIN_GUESTS_EXCLUSIVE = 5;
const ARRIVALS_COOLDOWN_SIM = 25;
const STAFF_RETURN_S = 4;
const MUSIC_RETURN_S = 8;
const DOOR_LOCK_TIP = 'Something is still here';

export function isPeacefulMode(): boolean {
  try {
    return localStorage.getItem(PEACEFUL_KEY) === 'on';
  } catch {
    return false;
  }
}

function setPeacefulMode(on: boolean): void {
  try {
    localStorage.setItem(PEACEFUL_KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked: setting just won't persist
  }
}

/** Set when Gojo beats him: the next rainy night without Gojo, he comes back for certain. */
const GRUDGE_KEY = 'cozyhouse:lastGuestGrudge';

function holdsGrudge(): boolean {
  try {
    return localStorage.getItem(GRUDGE_KEY) === '1';
  } catch {
    return false;
  }
}

function setGrudge(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(GRUDGE_KEY, '1');
      sessionStorage.removeItem(MET_KEY); // he may return this very session
    } else {
      localStorage.removeItem(GRUDGE_KEY);
    }
  } catch {
    // storage blocked: no grudge
  }
}

function hasMetLastGuest(): boolean {
  try {
    return sessionStorage.getItem(MET_KEY) === '1';
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const damp = (a: number, b: number, k: number, dt: number): number => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (t: number): number => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};
function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const dampAngle = (a: number, b: number, k: number, dt: number): number => a + angleDiff(a, b) * (1 - Math.exp(-k * dt));
const dist2 = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);

/** Moves `p` along `path` (consuming reached points) by `step`; returns heading or null. */
function moveAlong(p: { x: number; z: number }, path: WorldPoint[], step: number): number | null {
  let heading: number | null = null;
  let left = step;
  while (left > 0 && path.length > 0) {
    const n = path[0];
    const dx = n.wx - p.x;
    const dz = n.wz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) heading = Math.atan2(dx, dz);
    if (d <= left) {
      p.x = n.wx;
      p.z = n.wz;
      left -= d;
      path.shift();
    } else {
      p.x += (dx / d) * left;
      p.z += (dz / d) * left;
      left = 0;
    }
  }
  return heading;
}

function div(style: string, parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = style;
  parent?.appendChild(d);
  return d;
}

// ---------------------------------------------------------------------------
// Exact-restore helpers
// ---------------------------------------------------------------------------

function isDescendant(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** Swaps a mesh's material for a private clone; restore puts the original back and frees the clone. */
class MaterialSwaps {
  private readonly recs = new Map<THREE.Mesh, { orig: THREE.Material | THREE.Material[]; clones: THREE.Material[] }>();

  swap(mesh: THREE.Mesh): THREE.Material[] {
    const have = this.recs.get(mesh);
    if (have) return have.clones;
    const orig = mesh.material;
    const clones = (Array.isArray(orig) ? orig : [orig]).map((m) => m.clone());
    mesh.material = Array.isArray(orig) ? clones : clones[0];
    this.recs.set(mesh, { orig, clones });
    return clones;
  }

  swapTree(root: THREE.Object3D): THREE.Material[] {
    const out: THREE.Material[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) out.push(...this.swap(m));
    });
    return out;
  }

  restoreTree(root: THREE.Object3D): void {
    for (const [mesh, r] of this.recs) {
      if (!isDescendant(mesh, root)) continue;
      mesh.material = r.orig;
      for (const c of r.clones) c.dispose();
      this.recs.delete(mesh);
    }
  }

  restoreAll(): void {
    for (const [mesh, r] of this.recs) {
      mesh.material = r.orig;
      for (const c of r.clones) c.dispose();
    }
    this.recs.clear();
  }
}

type NumKey = 'intensity' | 'opacity' | 'emissiveIntensity';

/**
 * Scales scene lights, light-rig glow pools/beams and lamp bulbs by multipliers each frame.
 * If SceneManager rewrites a value (time-of-day, candle flicker), that becomes the new base, so
 * restore() always lands on exactly what the game itself last set.
 */
class LightDimmer {
  private readonly entries = new Map<object, { obj: Record<NumKey, number>; key: NumKey; base: number; last: number }>();
  private readonly globals: THREE.Light[] = [];

  constructor(private readonly sm: SceneManager, private readonly swaps: MaterialSwaps) {
    for (const c of sm.scene.children) {
      if (c instanceof THREE.HemisphereLight || c instanceof THREE.DirectionalLight || c instanceof THREE.AmbientLight) {
        this.globals.push(c);
      }
    }
  }

  apply(globalMult: number, rigMult: (uid: string, x: number, z: number) => number): void {
    for (const l of this.globals) this.write(l as unknown as Record<NumKey, number>, 'intensity', globalMult);
    for (const rig of this.sm.lightsRoot.children) {
      const uid = rig.name.startsWith('LightRig_') ? rig.name.slice(9) : rig.name;
      const m = rigMult(uid, rig.position.x, rig.position.z);
      rig.traverse((o) => {
        if ((o as THREE.Light).isLight) this.write(o as unknown as Record<NumKey, number>, 'intensity', m);
        else if ((o as THREE.Mesh).isMesh) this.write((o as THREE.Mesh).material as unknown as Record<NumKey, number>, 'opacity', m);
      });
      // the lamp's own glowing bulb/shade, swapped to a private clone so shared materials stay untouched
      const item = this.sm.getItemObject(uid);
      if (!item) continue;
      item.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (!mesh.isMesh || !mat || Array.isArray(mat) || !(mat.emissiveIntensity > 0)) return;
        const clone = this.swaps.swap(mesh)[0] as THREE.MeshStandardMaterial;
        this.write(clone as unknown as Record<NumKey, number>, 'emissiveIntensity', m);
      });
    }
  }

  private write(obj: Record<NumKey, number>, key: NumKey, mult: number): void {
    let e = this.entries.get(obj);
    const cur = obj[key];
    if (!e) {
      e = { obj, key, base: cur, last: Number.NaN };
      this.entries.set(obj, e);
    } else if (cur !== e.last) {
      e.base = cur;
    }
    const next = e.base * mult;
    obj[key] = next;
    e.last = next;
  }

  restore(): void {
    for (const e of this.entries.values()) {
      if (e.obj[e.key] === e.last) e.obj[e.key] = e.base;
    }
    this.entries.clear();
  }
}

let grainUrl: string | null = null;
function getGrainUrl(): string {
  if (grainUrl) return grainUrl;
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 160;
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = Math.random() < 0.5 ? 70 : 0;
    }
    ctx.putImageData(img, 0, 0);
  }
  grainUrl = c.toDataURL('image/png');
  return grainUrl;
}

const CRACK_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 60' preserveAspectRatio='none'%3E%3Cg fill='none' stroke='%23222' stroke-width='1.6' stroke-linejoin='bevel'%3E%3Cpath d='M118 0 L132 14 L124 24 L146 33 L139 47 L152 60'/%3E%3Cpath d='M132 14 L162 9 L186 21 L214 16'/%3E%3Cpath d='M124 24 L96 31 L71 26 L40 38'/%3E%3Cpath d='M146 33 L177 41 L204 37 L240 52'/%3E%3Cpath d='M139 47 L111 52 L92 60'/%3E%3C/g%3E%3Cg fill='none' stroke='%23fff' stroke-opacity='.55' stroke-width='.8'%3E%3Cpath d='M119 1 L133 15 L125 25 L147 34'/%3E%3Cpath d='M133 15 L163 10 L187 22'/%3E%3C/g%3E%3C/svg%3E\")";

// ---------------------------------------------------------------------------
// Stage: lifecycle, FX and exact restore for one run
// ---------------------------------------------------------------------------

interface Deps {
  store: HouseStore;
  sceneManager: SceneManager;
  visitorModule: VisitorModule;
  audioModule: AudioModule;
}

type VictimMode = 'calm' | 'shock' | 'flee' | 'cower' | 'charge' | 'throw' | 'fight' | 'gojo' | 'vanish' | 'gone';

interface FadeMat {
  m: THREE.Material & { color?: THREE.Color };
  c0: THREE.Color | null;
  o0: number;
}

interface Victim {
  h: HorrorVictimHandle;
  x: number;
  z: number;
  y: number;
  yaw: number;
  mode: VictimMode;
  t: number;
  path: WorldPoint[];
  repath: number;
  flees: number;
  thrower: boolean;
  thrown: boolean;
  style: 'dust' | 'smear';
  dur: number;
  fade: FadeMat[] | null;
  dusted: boolean;
  removed: boolean;
  /** The one who stands up to him (the strongest guest; Gojo and Baki both, if both are here). */
  fighter: boolean;
  /** Tile index they ran to (-1 = none). */
  goal: number;
  /** Rig child groups (not the bubble sprite) the vanish displaces; restored before removal/hide. */
  kids: Array<{ o: THREE.Object3D; p: THREE.Vector3; vis: boolean }> | null;
}

/** Who steps up to fight him. Gojo and Baki are the strongest; both fight if both are here. */
const STRENGTH: Record<string, number> = { gojo: 10, baki: 10, john_wick: 8, rocky: 8, viking: 7, adi: 6, homer: 4, rick: 4, shakespeare: 3 };
const KICKERS = new Set(['baki', 'rocky', 'john_wick', 'viking', 'gojo']);
const EMOTE_SHOCK = { id: 'surprised', glyph: '😮', label: '', color: '#FCE0A8' };
const EMOTE_PANIC = { id: 'sweatPanic', glyph: '😰', label: '', color: '#B6D8F2' };
const EMOTE_FIGHT = { id: 'boxing', glyph: '🥊', label: '', color: '#F2A496' };
const EMOTE_BOOM = { id: 'boom', glyph: '💥', label: '', color: '#F7BE88' };

class Stage {
  readonly root = new THREE.Group();
  nav: NavGrid;
  readonly W: number;
  readonly D: number;
  readonly route: BiomeRoute;
  readonly frontDoor: DoorEntry | null;
  readonly houseCenter: { x: number; z: number };
  readonly doorPts: Array<{ uid: string; itemId: string; x: number; z: number; leaf: boolean }> = [];
  readonly victims: Victim[] = [];
  readonly swaps = new MaterialSwaps();
  fx: { ctx: AudioContext; master: AudioNode; weather: AudioNode } | null = null;
  private audioStarted = false;
  readonly reducedMotion = prefersReducedMotion();
  origZoom = 1;
  dirge: Dirge | null = null;
  rain: RainSwell | null = null;
  globalLight = 1;
  rigMult: (uid: string, x: number, z: number) => number = () => 1;
  readonly esc = { sat: 1, con: 1, bri: 1, vignette: 0.3, grain: 0.05, sway: 0.01, letterbox: 0 };
  followTarget: { x: number; z: number } | null = null;
  followRate = 1.1;
  time = 0;

  private readonly dimmer: LightDimmer;
  private readonly follow = { x: 0, z: 0 };
  private readonly known = new Set<string>();
  private readonly openedDoors = new Map<string, string>();
  private readonly shut = new Set<string>();
  private readonly unsubs: Array<() => void> = [];
  private globalNow = 1;
  private flash = 0;
  private darkPulse = -1;
  private darkPeak: (() => void) | null = null;
  private pollT = 0;
  private held = false;
  private doorReleased = false;
  private shadowT = 0;
  private grainT = 0;
  private lastFilter = '';
  private readonly canvas: HTMLCanvasElement;
  private readonly origFilter: string;
  private readonly hudEl: HTMLElement | null;
  private origHud: [string, string] | null = null;
  private origTarget: { x: number; z: number } | null = null;

  /** The player's camera view from before the event. */
  playerView(): { zoom: number; x: number; z: number } | null {
    return this.origTarget ? { zoom: this.origZoom, x: this.origTarget.x, z: this.origTarget.z } : null;
  }
  private focused = false;
  private readonly onSkip: () => void;
  private readonly onPointer = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY };
  };
  private readonly wasCycleRunning: boolean;
  private readonly prevDoorPolicy: ReturnType<HouseStore['getDoorPolicy']>;
  private readonly fxLayer: HTMLDivElement;
  private readonly blocker: HTMLDivElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly vignetteEl: HTMLDivElement;
  private readonly grainEl: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private readonly darkEl: HTMLDivElement;
  private readonly barEls: HTMLDivElement[];
  private readonly titleEl: HTMLDivElement;
  private readonly doorTipEl: HTMLDivElement;
  private pointer = { x: -1, y: -1 };
  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(readonly deps: Deps, title: string, onSkip: () => void) {
    const { store, sceneManager: sm, visitorModule: vm, audioModule: audio } = deps;
    this.onSkip = onSkip;
    const state = store.getState();
    this.W = state.gridWidth;
    this.D = state.gridDepth;
    this.nav = buildNavGrid(state, store.data);
    this.route = vm.horrorComputeRoute();

    for (const d of this.nav.doors) {
      const t = wallEdgeToWorldTransform(d.item.x, d.item.z, d.item.rotation, this.W, this.D, 0);
      this.doorPts.push({ uid: d.item.uid, itemId: d.item.itemId, x: t.wx, z: t.wz, leaf: true });
    }
    for (const it of state.items) {
      if (it.itemId !== 'wall_arch') continue;
      const t = wallEdgeToWorldTransform(it.x, it.z, it.rotation, this.W, this.D, 0);
      this.doorPts.push({ uid: it.uid, itemId: it.itemId, x: t.wx, z: t.wz, leaf: false });
    }
    const edge = this.route.approachWaypoints[this.route.approachWaypoints.length - 1] ?? this.route.stopPoint;
    const exterior = this.nav.doors.filter((d) => !this.nav.hasFloorTile[d.outsideTile.x]?.[d.outsideTile.z]);
    const pool = exterior.length > 0 ? exterior : this.nav.doors;
    this.frontDoor =
      pool
        .slice()
        .sort(
          (a, b) =>
            dist2(a.outsideWorld.wx, a.outsideWorld.wz, edge.wx, edge.wz) -
            dist2(b.outsideWorld.wx, b.outsideWorld.wz, edge.wx, edge.wz),
        )[0] ?? null;
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (let x = 0; x < this.W; x++) {
      for (let z = 0; z < this.D; z++) {
        if (!this.nav.hasFloorTile[x][z]) continue;
        const w = tileCenterToWorld(x, z, this.W, this.D);
        cx += w.wx;
        cz += w.wz;
        n++;
      }
    }
    this.houseCenter = n > 0 ? { x: cx / n, z: cz / n } : { x: 0, z: 0 };

    this.root.name = 'HorrorEventRoot';
    sm.scene.add(this.root);
    this.wasCycleRunning = store.isTimeCycleRunning();
    if (this.wasCycleRunning) store.setTimeCycleRunning(false);
    // Door status: temporary override to Full (doorPolicy is session state in the store, never saved)
    this.prevDoorPolicy = store.getDoorPolicy();
    store.setDoorPolicy('full');

    // Audio: theme music fades out, the dirge fades in (master + music volume apply)
    audio.setMusicSuspended(true);
    // Event audio follows the master volume only: it plays even with background music switched off.
    const musicLevel = () => Math.max(0.6, audio.getMusicVolume());
    this.startAudio();
    this.unsubs.push(
      audio.onMusicVolumeChange(() => this.dirge?.setVolume(musicLevel())),
      audio.onMusicChange(() => this.dirge?.setVolume(musicLevel())),
    );

    // Visual-only FX. Layers: canvas < fx (vignette/grain) < HUD (guest list stays readable) < input blocker
    this.dimmer = new LightDimmer(sm, this.swaps);
    this.canvas = sm.renderer.domElement;
    this.origFilter = this.canvas.style.filter;
    this.hudEl = document.getElementById('hud');
    this.fxLayer = div('position:fixed;inset:0;pointer-events:none;overflow:hidden;');
    const viewport = document.getElementById('viewport');
    if (viewport) viewport.after(this.fxLayer);
    else document.body.appendChild(this.fxLayer);
    this.vignetteEl = div(
      'position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 38%, rgba(4,5,9,0.92) 100%);opacity:0;',
      this.fxLayer,
    );
    this.grainEl = div(`position:absolute;inset:-160px;background-image:url(${getGrainUrl()});opacity:0;mix-blend-mode:overlay;`, this.fxLayer);
    this.flashEl = div('position:absolute;inset:0;background:#eef3ff;opacity:0;', this.fxLayer);
    this.darkEl = div('position:absolute;inset:0;background:#000;opacity:0;', this.fxLayer);
    this.barEls = [div('position:absolute;left:0;right:0;top:0;height:0;background:#000;', this.fxLayer), div('position:absolute;left:0;right:0;bottom:0;height:0;background:#000;', this.fxLayer)];
    this.titleEl = div(
      'position:absolute;left:28px;bottom:26px;font:italic 400 22px/1.2 Georgia,"Times New Roman",serif;letter-spacing:0.22em;color:#e9e2d2;opacity:0;transition:opacity 2.2s ease;text-shadow:0 1px 8px #000;',
      this.fxLayer,
    );
    this.titleEl.textContent = title;
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    this.doorTipEl = div(
      'position:fixed;z-index:2147482500;padding:6px 10px;border-radius:8px;background:#2d2620;color:#fffdf7;font:600 12px/1.2 system-ui,sans-serif;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .2s ease;box-shadow:0 2px 8px rgba(0,0,0,.35);',
    );
    this.doorTipEl.textContent = DOOR_LOCK_TIP;
    document.body.appendChild(this.doorTipEl);

    // Transparent input blocker, only once the camera finds him (see focus())
    this.blocker = div('position:fixed;inset:0;z-index:2147482000;pointer-events:auto;cursor:default;');
    this.blocker.setAttribute('data-horror-overlay', '');
    this.blocker.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.textContent = 'Skip  ›';
    skip.title = 'Skip (Esc)';
    skip.style.cssText =
      'position:fixed;z-index:2147482600;right:22px;bottom:64px;padding:8px 16px;border-radius:999px;border:1px solid rgba(233,226,210,0.35);background:rgba(10,10,14,0.6);color:#e9e2d2;font:600 13px/1 system-ui,sans-serif;letter-spacing:0.08em;cursor:pointer;';
    skip.addEventListener('click', (e) => {
      e.stopPropagation();
      onSkip();
    });
    this.skipBtn = skip;
    document.body.appendChild(skip); // skippable from the very first step of his walk-up
    // Block editor shortcuts (undo, delete…) once focused, so the house can't change; Esc skips
    this.onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') this.onSkip();
    };
  }

  /**
   * The cutscene proper starts when the camera finds him near the house: until then the player can
   * still pan, click and build. From here: camera follow, title card, dimmed HUD, input blocked, Skip.
   */
  focus(): void {
    if (this.focused) return;
    this.focused = true;
    const sm = this.deps.sceneManager;
    const cam = sm.isoCamera;
    this.origZoom = cam.getZoom();
    const dir = new THREE.Vector3();
    cam.camera.getWorldDirection(dir);
    const tgt = cam.camera.position.clone().addScaledVector(dir, 32);
    this.origTarget = { x: tgt.x, z: tgt.z };
    this.follow.x = tgt.x;
    this.follow.z = tgt.z;
    sm.setCameraFollowProvider(() => ({ x: this.follow.x, z: this.follow.z }));
    if (this.hudEl) {
      this.origHud = [this.hudEl.style.opacity, this.hudEl.style.transition];
      const listOpen = Boolean(this.hudEl.querySelector('.visitors-popover:not(.hidden)'));
      this.hudEl.style.transition = 'opacity 1.2s ease';
      this.hudEl.style.opacity = listOpen ? '0.95' : '0.55';
    }
    document.body.appendChild(this.blocker);
    window.addEventListener('keydown', this.onKey, true);
    requestAnimationFrame(() => {
      this.titleEl.style.opacity = '0.85';
    });
    window.setTimeout(() => {
      this.titleEl.style.opacity = '0';
    }, 5200);
  }

  /**
   * Guests carry on as normal while he walks up; only when he opens the door does the sim hand
   * the visitors and staff over to the event (they react, run, fight; nobody is frozen).
   */
  hold(): void {
    if (this.held) return;
    this.held = true;
    // the player could still build while he walked up: path on the house as it is now
    this.nav = buildNavGrid(this.deps.store.getState(), this.deps.store.data);
    this.deps.visitorModule.setHorrorHold(true);
    if (this.focused) this.deps.sceneManager.setCameraFollowProvider(() => ({ x: this.follow.x, z: this.follow.z }));
    this.pollVictims();
  }

  /** Adds visitors/staff that are visibly on the lot (in-transit arrivals join when they step out). */
  pollVictims(): void {
    for (const h of this.deps.visitorModule.horrorVictims()) {
      if (this.known.has(h.id) || h.inTransit || !h.root.visible || !h.root.parent) continue;
      this.known.add(h.id);
      h.root.scale.setScalar(1);
      this.victims.push({
        h,
        x: h.root.position.x,
        z: h.root.position.z,
        y: h.root.position.y,
        yaw: h.root.rotation.y,
        mode: 'calm',
        t: 0,
        path: [],
        repath: 0,
        flees: 0,
        thrower: false,
        thrown: false,
        style: 'dust',
        dur: 1.8,
        fade: null,
        dusted: false,
        removed: false,
        fighter: false,
        goal: -1,
        kids: null,
      });
    }
  }

  alive(): Victim[] {
    return this.victims.filter((v) => !v.removed);
  }

  place(v: Victim): void {
    v.h.root.position.set(v.x, v.y, v.z);
    v.h.root.rotation.y = v.yaw;
  }

  /** Swap the victim's materials for private clones we can grey/fade freely. */
  beginFade(v: Victim): FadeMat[] {
    if (v.fade) return v.fade;
    v.fade = this.swaps.swapTree(v.h.root).map((m) => {
      const mm = m as THREE.Material & { color?: THREE.Color };
      mm.transparent = true;
      return { m: mm, c0: mm.color ? mm.color.clone() : null, o0: mm.opacity };
    });
    return v.fade;
  }

  restoreKids(v: Victim): void {
    for (const k of v.kids ?? []) {
      k.o.position.copy(k.p);
      k.o.visible = k.vis;
    }
    v.kids = null;
  }

  /** Proper removal: visitors through VisitorModule, staff hidden (they return after the event). */
  removeVictim(v: Victim): void {
    if (v.removed) return;
    v.removed = true;
    v.mode = 'gone';
    this.restoreKids(v);
    this.swaps.restoreTree(v.h.root);
    if (v.h.kind === 'visitor') {
      this.deps.visitorModule.horrorRemoveVisitor(v.h.id);
    } else {
      v.h.root.visible = false;
    }
  }

  removeEveryone(): void {
    for (const v of this.victims) this.removeVictim(v);
    for (const h of this.deps.visitorModule.horrorVictims()) {
      if (h.kind === 'visitor') this.deps.visitorModule.horrorRemoveVisitor(h.id);
      else h.root.visible = false;
    }
  }

  /** If the guest list is open: the vanishing guest's row cracks, then fades and collapses. */
  crackGuestRow(v: Victim, k: number): void {
    if (v.h.kind !== 'visitor' || !this.hudEl) return;
    const row = this.hudEl.querySelector<HTMLElement>(
      `.visitors-popover:not(.hidden) [data-visitor-instance-id="${CSS.escape(v.h.id)}"]`,
    );
    if (!row) return;
    row.style.pointerEvents = 'none';
    if (this.reducedMotion) {
      row.style.opacity = (1 - smooth(k)).toFixed(3);
      return;
    }
    let crack = row.querySelector<HTMLElement>('[data-horror-crack]');
    if (!crack) {
      if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
      row.style.overflow = 'hidden';
      row.dataset.horrorH = String(row.offsetHeight);
      crack = div(
        `position:absolute;inset:0;pointer-events:none;background:${CRACK_SVG} center/100% 100% no-repeat;opacity:0;mix-blend-mode:multiply;`,
        row,
      );
      crack.setAttribute('data-horror-crack', '');
    }
    const c = clamp01(k / 0.3);
    crack.style.opacity = c.toFixed(3);
    crack.style.clipPath = `inset(0 ${((1 - c) * 50).toFixed(1)}% 0 ${((1 - c) * 50).toFixed(1)}%)`;
    const step = Math.floor(k * 14);
    const jolt = k < 0.45 ? (((step * 37) % 7) - 3) * 1.2 : 0;
    const f = smooth((k - 0.35) / 0.65);
    row.style.transform = `translateX(${jolt.toFixed(1)}px) skewX(${(jolt * 0.6).toFixed(1)}deg)`;
    row.style.filter = `grayscale(${Math.min(1, k * 2).toFixed(2)})`;
    row.style.opacity = (1 - f).toFixed(3);
    const h0 = Number(row.dataset.horrorH) || row.offsetHeight;
    row.style.maxHeight = `${(h0 * (1 - f)).toFixed(1)}px`;
    if (f > 0) {
      row.style.marginTop = '0px';
      row.style.marginBottom = '0px';
      row.style.paddingTop = `${(6 * (1 - f)).toFixed(1)}px`;
      row.style.paddingBottom = `${(6 * (1 - f)).toFixed(1)}px`;
    }
  }

  pathTo(fromX: number, fromZ: number, goal: GridCoord): WorldPoint[] {
    const start = findNearestWalkableTile(this.nav, fromX, fromZ);
    const tiles = findGridPath(this.nav, start, goal) ?? [];
    return tiles.map((t) => tileCenterToWorld(t.x, t.z, this.W, this.D));
  }

  tileAt(x: number, z: number): GridCoord {
    return findNearestWalkableTile(this.nav, x, z);
  }

  nearestDoorDist(x: number, z: number): number {
    let best = Infinity;
    for (const d of this.doorPts) best = Math.min(best, dist2(x, z, d.x, d.z));
    return best;
  }

  openDoorsNear(x: number, z: number, radius = 1.45, creak = false): void {
    for (const d of this.doorPts) {
      const dd = dist2(x, z, d.x, d.z);
      if (this.shut.has(d.uid)) {
        if (dd > 2.6) this.shut.delete(d.uid); // he has moved on; it may open for him again later
        continue;
      }
      if (!d.leaf || this.openedDoors.has(d.uid) || dd > radius) continue;
      this.openedDoors.set(d.uid, d.itemId);
      this.deps.sceneManager.setDoorVisitorOpen(d.uid, true);
      if (creak && this.fx) playCreak(this.fx.ctx, this.fx.master);
      else this.deps.audioModule.playInteract(d.itemId, ['door'], true);
    }
  }

  /** Shut every door he came through, behind him (they stay shut while he is near them). */
  shutDoorsBehind(): void {
    for (const uid of this.openedDoors.keys()) this.shut.add(uid);
    this.closeDoors();
  }

  closeDoors(): void {
    for (const [uid, itemId] of this.openedDoors) {
      this.deps.sceneManager.setDoorVisitorOpen(uid, false);
      this.deps.audioModule.playInteract(itemId, ['door'], false);
    }
    this.openedDoors.clear();
  }

  lightning(): void {
    this.flash = 1;
    this.deps.audioModule.playThunder();
  }

  /** A single brief dip to near-black; `atPeak` runs at the darkest moment. */
  pulseDark(atPeak: () => void): void {
    this.darkPulse = 0;
    this.darkPeak = atPeak;
  }

  vanishSound(harsh: boolean): void {
    if (this.fx) playVanish(this.fx.ctx, this.fx.master, harsh);
  }

  /** Keeps the HUD door control showing a locked "Full" (re-applied every frame since the HUD re-renders). */
  private lockDoorControl(): void {
    const { store } = this.deps;
    if (store.getDoorPolicy() !== 'full') store.setDoorPolicy('full');
    const pill = this.hudEl?.querySelector<HTMLButtonElement>('.open-toggle-pill');
    if (!pill) return;
    if (pill.dataset.horrorTip === undefined) {
      pill.dataset.horrorTip = pill.dataset.tooltip ?? '';
      pill.dataset.horrorAria = pill.getAttribute('aria-label') ?? '';
    }
    pill.disabled = true;
    pill.dataset.tooltip = DOOR_LOCK_TIP;
    pill.setAttribute('aria-label', `Full. ${DOOR_LOCK_TIP}`);
    pill.style.cursor = 'not-allowed';
    pill.style.filter = 'saturate(0.4)';
    // Our blocker sits over the HUD, so draw the hover tooltip ourselves (and briefly at the start)
    const r = pill.getBoundingClientRect();
    const hover = this.pointer.x >= r.left && this.pointer.x <= r.right && this.pointer.y >= r.top && this.pointer.y <= r.bottom;
    const show = hover || (this.time > 0.3 && this.time < 4.5);
    this.doorTipEl.style.opacity = show ? '1' : '0';
    if (show) {
      this.doorTipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - 170, r.left + r.width / 2 - 75))}px`;
      this.doorTipEl.style.top = `${r.bottom + 8}px`;
    }
  }

  releaseDoorLock(): void {
    if (this.doorReleased) return;
    this.doorReleased = true;
    this.unlockDoorControl();
  }

  private unlockDoorControl(): void {
    for (const pill of document.querySelectorAll<HTMLButtonElement>('.open-toggle-pill')) {
      if (pill.dataset.horrorTip === undefined) continue;
      pill.disabled = false;
      pill.dataset.tooltip = pill.dataset.horrorTip;
      pill.setAttribute('aria-label', pill.dataset.horrorAria ?? '');
      delete pill.dataset.horrorTip;
      delete pill.dataset.horrorAria;
      pill.style.cursor = '';
      pill.style.filter = '';
    }
    this.deps.store.setDoorPolicy(this.prevDoorPolicy);
  }

  /** Starts the dirge (and rain swell). Retried every frame until the browser lets audio run. */
  private startAudio(): void {
    if (this.audioStarted) return;
    const { audioModule: audio, store } = this.deps;
    this.fx = audio.getEventAudioOutput();
    if (!this.fx || this.fx.ctx.state !== 'running') return;
    this.audioStarted = true;
    this.dirge = new Dirge(this.fx.ctx, this.fx.master, Math.max(0.6, audio.getMusicVolume()));
    this.dirge.start(4);
    if (store.data.weathersById.get(store.getState().weatherId)?.particleType === 'rain') {
      this.rain = new RainSwell(this.fx.ctx, this.fx.weather);
    }
  }

  tick(dt: number): void {
    const sm = this.deps.sceneManager;
    this.time += dt;
    if (!this.audioStarted && this.time < 40) this.startAudio();
    this.pollT -= dt;
    if (this.pollT <= 0 && this.held) {
      this.pollT = 0.5;
      this.pollVictims();
    }
    if (!this.doorReleased) this.lockDoorControl();

    // lights (after SceneManager's own writes this frame); whole-scene light only moves slowly
    this.globalNow = damp(this.globalNow, this.globalLight, 1.4, dt);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.dimmer.apply(this.globalNow * (1 + this.flash * 2.4), this.rigMult);

    let dark = 0;
    if (this.darkPulse >= 0) {
      this.darkPulse += dt;
      const p = this.darkPulse;
      dark = p < 0.16 ? p / 0.16 : p < 0.3 ? 1 : Math.max(0, 1 - (p - 0.3) / 0.4);
      if (p >= 0.16 && this.darkPeak) {
        const cb = this.darkPeak;
        this.darkPeak = null;
        cb();
      }
      if (p > 0.7) this.darkPulse = -1;
    }

    // colour grade + overlay
    const e = this.esc;
    const filter = `saturate(${e.sat.toFixed(3)}) contrast(${e.con.toFixed(3)}) brightness(${(e.bri * (1 + this.flash * 0.5)).toFixed(3)})`;
    if (filter !== this.lastFilter) {
      this.lastFilter = filter;
      this.canvas.style.filter = filter;
    }
    this.vignetteEl.style.opacity = e.vignette.toFixed(3);
    this.grainEl.style.opacity = e.grain.toFixed(3);
    this.flashEl.style.opacity = (this.flash * 0.55).toFixed(3);
    this.darkEl.style.opacity = (dark * 0.72).toFixed(3);
    for (const bar of this.barEls) bar.style.height = `${(e.letterbox * 100).toFixed(2)}vh`;
    this.grainT -= dt;
    if (this.grainT <= 0) {
      this.grainT = 1 / 12;
      this.grainEl.style.transform = `translate(${Math.floor(Math.random() * 160)}px, ${Math.floor(Math.random() * 160)}px)`;
    }

    // camera: our follow point + a faint unsteady sway (IsometricCamera rebuilds its transform each frame)
    if (this.followTarget) {
      this.follow.x = damp(this.follow.x, this.followTarget.x, this.followRate, dt);
      this.follow.z = damp(this.follow.z, this.followTarget.z, this.followRate, dt);
    }
    const cam = sm.isoCamera.camera;
    const a = this.reducedMotion ? 0 : e.sway;
    cam.position.x += Math.sin(this.time * 0.83) * a;
    cam.position.y += Math.sin(this.time * 1.21 + 1.3) * a * 0.6;
    cam.position.z += Math.cos(this.time * 0.67) * a;
    cam.rotateZ(Math.sin(this.time * 0.53) * a * 0.12);

    this.shadowT -= dt;
    if (this.shadowT <= 0) {
      this.shadowT = 1 / 15;
      sm.markShadowsDirty();
    }
  }

  restore(fadeAudio: number): void {
    const { store, sceneManager: sm } = this.deps;
    this.dimmer.restore();
    this.swaps.restoreAll();
    this.canvas.style.filter = this.origFilter;
    const hud = this.origHud;
    if (this.hudEl && hud) {
      this.hudEl.style.opacity = hud[0];
      window.setTimeout(() => {
        if (this.hudEl && this.hudEl.style.opacity === hud[0]) this.hudEl.style.transition = hud[1];
      }, 1300);
    }
    this.fxLayer.remove();
    this.blocker.remove();
    this.skipBtn.remove();
    this.doorTipEl.remove();
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointermove', this.onPointer);
    this.releaseDoorLock();
    if (this.origTarget) {
      sm.setCameraFollowProvider(null);
      sm.isoCamera.setZoom(this.origZoom);
      sm.isoCamera.setTargetSmooth(this.origTarget.x, this.origTarget.z);
    }
    this.closeDoors();
    sm.scene.remove(this.root);
    if (this.wasCycleRunning) store.setTimeCycleRunning(true);
    this.dirge?.stop(fadeAudio);
    this.rain?.stop(Math.max(1, fadeAudio));
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
  }
}

// ---------------------------------------------------------------------------
// The Last Guest
// ---------------------------------------------------------------------------

type LGPhase = 'approach' | 'shock' | 'duel' | 'panic' | 'hunt' | 'toSeat' | 'sit' | 'flowers' | 'stare' | 'silence';

interface LampState {
  /** < 0 alive; otherwise seconds since it started dying. */
  dieT: number;
  val: number;
  next: number;
  x: number;
  z: number;
}

const LAMP_DIE_S = 1.4;
const LAMP_DEAD = 0.03;

class LastGuestScript {
  private readonly rig: LastGuestRig;
  private readonly he = { x: 0, z: 0, yaw: 0, path: [] as WorldPoint[] };
  private readonly entryPoint: WorldPoint;
  private phase: LGPhase = 'approach';
  private camOn = false;
  private readonly doorPoint: WorldPoint | null;
  private t = 0;
  private total = 0;
  private huntT = 0;
  private killed = 0;
  private victimTotal = 0;
  private freezeT = 0;
  private nextFreeze = 4;
  private lookT = 0;
  private nextLook = 4;
  private headYaw = 0;
  private headRoll = 0.2;
  private duck = 0;
  private sit = 0;
  private zoom0 = 1;
  private reach = 0;
  private target: Victim | null = null;
  private repath = 0;
  private retarget = 0;
  private blinkCd = 5;
  private killNext = 3;
  private decay = 0.08;
  private frameDt = 0;
  private readonly lamps = new Map<string, LampState>();
  private readonly dusts: DustBurst[] = [];
  private readonly props: Array<{ m: THREE.Mesh; t: number; from: THREE.Vector3; to: THREE.Vector3; vy: number }> = [];
  private readonly propGeo = new THREE.BoxGeometry(0.11, 0.13, 0.11);
  private readonly propMats = ['#e9dfcf', '#b65a4a', '#6f8fb0'].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true }),
  );
  /** Set by the director: Gojo can face him instead of vanishing (returns true when handled). */
  confront: ((gojo: { id: string; root: THREE.Object3D; x: number; z: number }, guestPos: { x: number; z: number }) => boolean) | null = null;
  private confronted = false;
  private paused = false;
  private gojo: Victim | null = null;
  private banishT = -1;
  private seat: { x: number; z: number; y: number; yaw: number } | null = null;
  private sitFrom = { x: 0, z: 0, yaw: 0 };
  private flowersFrom: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;

  constructor(private readonly s: Stage) {
    this.rig = createLastGuestRig();
    s.root.add(this.rig.root);
    this.rig.root.visible = false;

    // He walks in from the edge of the world: out past the street/pier/trail, up the path, to the door.
    const door = s.frontDoor;
    const route = s.route;
    const stop = route.stopPoint;
    const out = Math.hypot(stop.wx, stop.wz) || 1;
    const extra = route.kind === 'elevator' ? 0 : route.kind === 'car' ? 9 : 5;
    this.he.x = stop.wx + (stop.wx / out) * extra;
    this.he.z = stop.wz + (stop.wz / out) * extra;
    const path: WorldPoint[] = [stop, ...route.approachWaypoints];
    const edge = path[path.length - 1];
    if (door) {
      const inside = tileCenterToWorld(door.insideTile.x, door.insideTile.z, s.W, s.D);
      path.push(...s.pathTo(edge.wx, edge.wz, door.outsideTile), door.outsideWorld, inside);
      this.entryPoint = inside;
      this.doorPoint = door.outsideWorld;
    } else {
      const c = s.tileAt(s.houseCenter.x, s.houseCenter.z);
      path.push(...s.pathTo(edge.wx, edge.wz, c));
      this.entryPoint = tileCenterToWorld(c.x, c.z, s.W, s.D);
      this.doorPoint = null;
    }
    this.he.path = path;
    this.he.yaw = Math.atan2(path[0].wx - this.he.x, path[0].wz - this.he.z);
    // The camera stays where the player left it until he is nearly at the house (see 'approach').
    s.followTarget = null;
    s.globalLight = 0.8;
    s.esc.vignette = 0.35;
    s.lightning();
    s.rigMult = (uid, x, z) => this.lampMult(uid, x, z);
  }

  /**
   * Lamps near him stutter: irregular dips that get faster and deeper as he closes in, a frantic
   * near-dark stutter right beside him, then they die. Local to each light source; the whole-scene
   * light only ever changes slowly. Reduced motion: a slow fade instead.
   */
  private lampMult(uid: string, x: number, z: number): number {
    let L = this.lamps.get(uid);
    if (!L) {
      L = { dieT: -1, val: 1, next: 0, x, z };
      this.lamps.set(uid, L);
    }
    L.x = x;
    L.z = z;
    if (L.dieT >= 0) return this.dyingValue(L);
    if (!this.rig.root.visible) return 1;
    const d = dist2(this.he.x, this.he.z, x, z);
    if (d < 2.2 && this.phase !== 'stare' && this.phase !== 'silence') {
      L.dieT = 0;
      return this.dyingValue(L);
    }
    const p = clamp01((6 - d) / 3.8);
    if (p <= 0.02) return 1;
    if (this.s.reducedMotion) return 1 - 0.55 * p;
    L.next -= this.frameDt;
    if (L.next <= 0) {
      const dip = Math.random() < 0.25 + 0.6 * p;
      L.val = dip ? 1 - (0.25 + 0.72 * Math.random()) * Math.pow(p, 0.7) : 1;
      L.next = (0.45 - 0.4 * p) * (0.3 + Math.random() * 1.1);
    }
    return L.val;
  }

  private dyingValue(L: LampState): number {
    if (L.dieT >= LAMP_DIE_S) return LAMP_DEAD;
    const k = L.dieT / LAMP_DIE_S;
    if (this.s.reducedMotion) return 1 - (1 - LAMP_DEAD) * smooth(k);
    L.next -= this.frameDt;
    if (L.next <= 0) {
      L.val = Math.random() < 0.55 ? 0.02 + 0.1 * Math.random() : (0.4 + 0.6 * Math.random()) * (1 - 0.7 * k);
      L.next = 0.025 + Math.random() * 0.06;
    }
    return Math.max(LAMP_DEAD, L.val);
  }

  private nearestAlive(): Victim | null {
    let best: Victim | null = null;
    let bd = Infinity;
    for (const v of this.s.alive()) {
      if (v.mode === 'vanish') continue;
      const d = dist2(v.x, v.z, this.he.x, this.he.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  /** Takes a guest, unless it's Gojo and someone handles that confrontation (then the hunt pauses). */
  private erase(v: Victim): void {
    if (v.h.typeId === 'gojo' && !this.confronted && this.confront?.({ id: v.h.id, root: v.h.root, x: v.x, z: v.z }, { x: this.he.x, z: this.he.z })) {
      this.confronted = true;
      this.paused = true;
      this.gojo = v;
      v.mode = 'gojo';
      return;
    }
    this.startVanish(v);
  }

  private startVanish(v: Victim): void {
    if (v.mode === 'vanish' || v.removed) return;
    const k = this.killed++;
    v.mode = 'vanish';
    v.t = 0;
    v.style = k < 2 ? 'dust' : 'smear';
    v.dur = v.style === 'dust' ? 2.0 : Math.max(0.9, 1.3 - k * 0.08);
    // bubbles are sprites under the rig root: hide them all, and only ever move the rig's child groups
    v.h.root.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) o.visible = false;
    });
    v.kids = v.h.root.children
      .filter((o) => !(o as THREE.Sprite).isSprite)
      .map((o) => ({ o, p: o.position.clone(), vis: o.visible }));
    this.s.beginFade(v);
    this.s.vanishSound(v.style === 'smear');
  }

  private updateVanish(v: Victim, dt: number): void {
    v.t += dt;
    const k = clamp01(v.t / v.dur);
    const fade = v.fade ?? [];
    const kids = v.kids ?? [];
    this.s.crackGuestRow(v, k);
    if (v.style === 'dust') {
      // greys to ash, then crumbles into falling dust (proportions untouched: only a slight settle)
      const g = clamp01(k / 0.4);
      const crumble = clamp01((k - 0.4) / 0.6);
      for (const f of fade) {
        if (f.c0 && f.m.color) {
          const lum = f.c0.r * 0.3 + f.c0.g * 0.59 + f.c0.b * 0.11;
          f.m.color.copy(f.c0).lerp(new THREE.Color(lum * 0.8 + 0.15, lum * 0.8 + 0.15, lum * 0.8 + 0.16), g);
        }
        f.m.opacity = f.o0 * (1 - smooth(crumble));
      }
      if (k >= 0.4 && !v.dusted) {
        v.dusted = true;
        const d = new DustBurst(new THREE.Vector3(v.x, 0, v.z), 1.1 + v.y, '#8f8b86', 80);
        this.s.root.add(d.mesh);
        this.dusts.push(d);
      }
      for (const kid of kids) kid.o.position.set(kid.p.x, kid.p.y - 0.05 * crumble, kid.p.z);
    } else {
      // later vanishes go wrong: inked out, then a sharp sideways glitch (stepped jumps) before it's gone
      const ink = clamp01(k / 0.3);
      const inkColor = new THREE.Color('#1b1e27');
      for (const f of fade) {
        if (f.c0 && f.m.color) f.m.color.copy(f.c0).lerp(inkColor, ink);
        f.m.opacity = f.o0 * (1 - smooth((k - 0.35) / 0.65));
      }
      const step = Math.floor(v.t / 0.08);
      const jolt = k > 0.3 ? ((((step * 7919) % 13) / 13) - 0.5) * 0.32 : 0;
      const blink = k > 0.45 && step % 5 === 0;
      for (const kid of kids) {
        kid.o.position.set(kid.p.x + jolt, kid.p.y, kid.p.z);
        kid.o.visible = kid.vis && !blink;
      }
      if (k >= 0.3 && !v.dusted) {
        v.dusted = true;
        const d = new DustBurst(new THREE.Vector3(v.x, 0, v.z), 1.0 + v.y, '#2b2e38', 55);
        this.s.root.add(d.mesh);
        this.dusts.push(d);
      }
    }
    if (k >= 1) this.s.removeVictim(v);
  }

  /** Everyone runs, except the strongest guest(s), who go to fight him. */
  private assignRoles(): void {
    const alive = this.s.alive().filter((v) => v.mode !== 'vanish');
    const strength = (v: Victim) => STRENGTH[v.h.typeId] ?? (v.h.kind === 'staff' ? 3 : 2);
    let fighters = alive.filter((v) => v.h.typeId === 'gojo' || v.h.typeId === 'baki');
    if (fighters.length === 0 && alive.length > 0) {
      const top = Math.max(...alive.map(strength));
      const best = alive.filter((v) => strength(v) === top);
      fighters = [best[Math.floor(Math.random() * best.length)]];
    }
    for (const v of alive) {
      v.y = 0;
      v.t = 0;
      if (fighters.includes(v)) {
        v.fighter = true;
        v.mode = 'charge';
        v.thrower = Math.random() < 0.5;
        v.repath = 0;
        v.h.bubble.showEmote(EMOTE_FIGHT, 'neutral', 2.2, 0.6);
      } else {
        this.flee(v);
      }
    }
  }

  /** Run for the room's corners and walls (inside the house), away from him, huddling near the others. */
  private flee(v: Victim): void {
    const s = this.s;
    const nav = s.nav;
    v.mode = 'flee';
    v.t = 0;
    v.flees += 1;
    v.y = 0;
    const start = s.tileAt(v.x, v.z);
    const reach = computeReachableDistances(nav, start);
    let insideReachable = false;
    for (const idx of reach.keys()) {
      if (nav.hasFloorTile[Math.floor(idx / nav.depth)][idx % nav.depth]) {
        insideReachable = true;
        break;
      }
    }
    const taken = new Set(s.alive().filter((o) => o !== v && o.goal >= 0).map((o) => o.goal));
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best: GridCoord | null = null;
    let bestScore = -Infinity;
    for (const [idx, steps] of reach) {
      const tx = Math.floor(idx / nav.depth);
      const tz = idx % nav.depth;
      if (!nav.walkable[tx][tz] || (insideReachable && !nav.hasFloorTile[tx][tz])) continue;
      let walls = 0;
      let huddle = 0;
      for (const [dx, dz] of dirs) {
        const nx = tx + dx;
        const nz = tz + dz;
        const out = !inGridBounds(nx, nz, nav.width, nav.depth);
        if (out || hasWallEdgeBetween(nav, { x: tx, z: tz }, { x: nx, z: nz }) || (insideReachable && !nav.hasFloorTile[nx][nz])) walls += 1;
        else if (!nav.walkable[nx][nz]) walls += 0.4; // tucked in beside furniture
        if (!out && taken.has(tileIndex(nx, nz, nav.depth))) huddle += 1;
      }
      const w = tileCenterToWorld(tx, tz, s.W, s.D);
      const score =
        dist2(w.wx, w.wz, this.he.x, this.he.z) +
        walls * 1.4 +
        (walls >= 2 ? 1.5 : 0) +
        Math.min(2, huddle) * 0.8 -
        (taken.has(idx) ? 6 : 0) -
        steps * 0.03 +
        Math.random() * 0.6;
      if (score > bestScore) {
        bestScore = score;
        best = { x: tx, z: tz };
      }
    }
    v.goal = best ? tileIndex(best.x, best.z, nav.depth) : -1;
    v.path = best ? s.pathTo(v.x, v.z, best) : [];
    v.h.bubble.showEmote(EMOTE_PANIC, 'neutral', 2.6, 0.6);
  }

  private throwProp(v: Victim): void {
    const m = new THREE.Mesh(this.propGeo, this.propMats[Math.floor(Math.random() * this.propMats.length)]);
    const from = new THREE.Vector3(v.x, 0.75 + v.y, v.z);
    const dir = new THREE.Vector3(this.he.x - v.x, 0, this.he.z - v.z).normalize();
    const to = new THREE.Vector3(this.he.x, 1.45, this.he.z).addScaledVector(dir, 0.9); // passes straight through him
    m.position.copy(from);
    this.s.root.add(m);
    this.props.push({ m, t: 0, from, to, vy: 0 });
  }

  private updateProps(dt: number): void {
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      p.t += dt;
      if (p.t < 0.6) {
        const k = p.t / 0.6;
        p.m.position.lerpVectors(p.from, p.to, k);
        p.m.position.y += Math.sin(k * Math.PI) * 0.5;
        p.m.rotation.x += dt * 9;
      } else if (p.m.position.y > 0.08) {
        p.vy -= 9 * dt;
        p.m.position.y = Math.max(0.08, p.m.position.y + p.vy * dt);
      }
      if (p.t > 2.4) p.m.scale.setScalar(Math.max(0.001, 1 - (p.t - 2.4) / 0.6));
      if (p.t > 3) {
        p.m.removeFromParent();
        this.props.splice(i, 1);
      }
    }
  }

  private updateVictim(v: Victim, dt: number): void {
    if (v.removed || v.mode === 'gojo') return;
    if (v.mode === 'vanish') {
      this.updateVanish(v, dt);
      return;
    }
    v.t += dt;
    const d = dist2(v.x, v.z, this.he.x, this.he.z);
    // Once he hunts, everyone near him is gone. Before that the fighter is touched (duel) and the
    // others only watch from where they ran to.
    if (this.phase === 'hunt' && d <= KILL_RADIUS && !this.paused) {
      this.erase(v);
      return;
    }
    const faceHe = Math.atan2(this.he.x - v.x, this.he.z - v.z);
    const run = v.h.walkSpeed * 1.1;
    let pose: Parameters<HorrorVictimHandle['animate']>[1] = v.y > 0.05 ? 'sit' : 'idle';
    let speed = v.h.walkSpeed;
    switch (v.mode) {
      case 'calm':
        if (this.phase !== 'approach') {
          v.mode = 'shock';
          v.t = 0;
          v.h.bubble.showEmote(EMOTE_SHOCK, 'neutral', 2.4, 0.6);
        }
        break;
      case 'shock':
        v.yaw = dampAngle(v.yaw, faceHe, 4, dt);
        if (d < 2.3 && d > 0.01) {
          v.y = 0;
          v.x += ((v.x - this.he.x) / d) * 1.1 * dt;
          v.z += ((v.z - this.he.z) / d) * 1.1 * dt;
          pose = 'walk';
        }
        if (this.phase !== 'approach' && this.phase !== 'shock' && v.t > 0.6) this.flee(v); // late arrivals just run
        break;
      case 'flee': {
        const h = moveAlong(v, v.path, GUEST_FLEE_SPEED * dt);
        if (h !== null) v.yaw = dampAngle(v.yaw, h, 10, dt);
        pose = 'walk';
        speed = run;
        if (v.path.length === 0) {
          v.mode = 'cower';
          v.t = 0;
        }
        break;
      }
      case 'cower':
        // huddled on the floor against the wall, watching him
        v.yaw = dampAngle(v.yaw, faceHe, 5, dt);
        v.y = damp(v.y, 0.3, 8, dt);
        pose = 'sit';
        if (this.phase === 'hunt' && d < 3.1 && v.flees < 3 && v.t > 1.2) this.flee(v);
        else if (v.t > 3 && Math.random() < dt * 0.25) v.h.bubble.showEmote(EMOTE_PANIC, 'neutral', 2.2, 0.4);
        break;
      case 'charge': {
        v.repath -= dt;
        if (v.repath <= 0) {
          v.repath = 0.6;
          v.path = this.s.pathTo(v.x, v.z, this.s.tileAt(this.he.x, this.he.z));
          if (v.path.length === 0) v.path = [{ wx: this.he.x, wz: this.he.z }];
        }
        const h = moveAlong(v, v.path, 2.2 * dt);
        if (h !== null) v.yaw = dampAngle(v.yaw, h, 10, dt);
        pose = 'walk';
        speed = run * 1.15;
        if (v.thrower && !v.thrown && d < 3.7) {
          v.mode = 'throw';
          v.t = 0;
        } else if (d < 1.2) {
          v.mode = 'fight';
          v.t = 0;
          v.h.bubble.showEmote(EMOTE_BOOM, 'neutral', 2.6, 0.8);
        }
        break;
      }
      case 'fight': {
        // swings and kicks that land on nothing: he doesn't even flinch
        const ax = (v.x - this.he.x) / (d || 1);
        const az = (v.z - this.he.z) / (d || 1);
        const lunge = Math.max(0, Math.sin(v.t * 7.2)) * 0.22;
        v.x = this.he.x + ax * (1.1 - lunge);
        v.z = this.he.z + az * (1.1 - lunge);
        v.yaw = dampAngle(v.yaw, faceHe, 12, dt);
        const swing = Math.floor(v.t / 0.44) % 2 === 0;
        pose = swing ? (KICKERS.has(v.h.typeId) ? 'kick' : 'stumble') : 'dance';
        speed = run;
        break;
      }
      case 'throw':
        v.yaw = dampAngle(v.yaw, faceHe, 8, dt);
        pose = 'admire';
        if (v.t > 0.35 && !v.thrown) {
          v.thrown = true;
          this.throwProp(v);
        }
        if (v.t > 0.8) {
          v.mode = 'charge';
          v.repath = 0;
        }
        break;
      default:
        break;
    }
    v.h.animate(dt, pose, speed, v.y);
    this.s.place(v);
    if (v.mode === 'cower' && !this.s.reducedMotion) v.h.root.position.x += Math.sin(this.total * 31 + v.z) * 0.006;
  }

  private onLampDied(): void {
    // ...and after the dark, he is closer than he should be.
    const t = this.target;
    if (!t || this.blinkCd > 0 || this.he.path.length === 0 || this.phase !== 'hunt') return;
    const d = dist2(t.x, t.z, this.he.x, this.he.z);
    if (d < KILL_RADIUS + 1.6 || Math.random() > 0.6) return;
    this.blinkCd = 6;
    const distance = Math.min(2.6, d - KILL_RADIUS - 0.5);
    this.s.pulseDark(() => {
      if (distance > 0) moveAlong(this.he, this.he.path, distance);
      this.he.yaw = Math.atan2(t.x - this.he.x, t.z - this.he.z);
    });
  }

  private pickSeat(): { x: number; z: number; y: number; yaw: number } | null {
    const { store, sceneManager: sm } = this.s.deps;
    let best: { x: number; z: number; y: number; yaw: number; score: number } | null = null;
    for (const it of store.getState().items) {
      const def = store.data.itemsById.get(it.itemId);
      if (!def || def.layer !== 'floor' || def.subLayer === 'tile') continue;
      const seatLike = def.tags.includes('seating') || /chair|sofa|stool|bench|loveseat|booth|beanbag|armchair/.test(def.id);
      if (!seatLike || def.tags.includes('surface')) continue;
      const g = sm.getItemObject(it.uid);
      if (!g) continue;
      const yaw = -it.rotation * (Math.PI / 2);
      const pos = new THREE.Vector3();
      g.getWorldPosition(pos);
      const y = it.itemId.includes('stool') ? 0.6 : it.itemId === 'beanbag_puff' ? 0.3 : 0.44;
      const score = dist2(pos.x, pos.z, this.he.x, this.he.z) + (/bed|toilet/.test(def.id) ? 50 : 0);
      if (!best || score < best.score) best = { x: pos.x + Math.sin(yaw) * 0.05, z: pos.z + Math.cos(yaw) * 0.05, y, yaw, score };
    }
    return best;
  }

  /** Erase him mid-scene: freeze, dissolve; dirge silenced, lights/colour/door back; guests stay. */
  banish(): void {
    if (this.banishT >= 0) return;
    this.banishT = 0;
    this.paused = true;
    const s = this.s;
    s.dirge?.stop(0.15);
    s.rain?.stop(1);
    for (const L of this.lamps.values()) L.dieT = -1;
    s.rigMult = () => 1;
    s.globalLight = 1;
    Object.assign(s.esc, { sat: 1, con: 1, bri: 1, vignette: 0, grain: 0, sway: 0, letterbox: 0 });
    s.releaseDoorLock();
    for (const v of s.victims) if (v.mode === 'vanish') s.removeVictim(v); // already-taken guests stay gone
    this.rig.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if ((o as THREE.Mesh).isMesh && m) m.transparent = true;
    });
  }

  /** Guests he didn't take (after banish), with where they are now. */
  survivors(): Victim[] {
    return this.s.alive().filter((v) => v.mode !== 'vanish');
  }

  update(dt: number): 'running' | 'done' {
    const s = this.s;
    const cam = s.deps.sceneManager.isoCamera;
    this.frameDt = dt;
    if (this.banishT >= 0) {
      this.banishT += dt;
      const k = clamp01(this.banishT / 0.9);
      this.rig.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if ((o as THREE.Mesh).isMesh && m) m.opacity = 1 - k;
      });
      this.rig.root.position.x = this.he.x + (k > 0.2 && Math.floor(this.banishT / 0.07) % 2 === 0 ? 0.06 * k : 0);
      for (const d of this.dusts) if (d.age < d.life) d.update(dt);
      return k >= 1 ? 'done' : 'running';
    }
    if (this.paused) {
      // Gojo is facing him: everything holds its breath until the other code calls banish()
      for (const v of s.victims) if (v !== this.gojo) this.updateVictim(v, dt);
      for (const d of this.dusts) if (d.age < d.life) d.update(dt);
      this.updateProps(dt);
      return 'running';
    }
    this.t += dt;
    this.total += dt;
    this.blinkCd -= dt;
    if (this.phase !== 'approach' && this.phase !== 'shock') this.huntT += dt;
    for (const L of this.lamps.values()) {
      if (L.dieT < 0) continue;
      const before = L.dieT;
      L.dieT += dt;
      if (before < LAMP_DIE_S && L.dieT >= LAMP_DIE_S) this.onLampDied();
    }

    let stride = 0;
    let frozen = false;
    const duckTarget = this.sit > 0.5 ? 0 : s.nearestDoorDist(this.he.x, this.he.z) < 0.9 ? 1 : 0;
    let reachTarget = 0;
    let lookCam = false;
    // camera: tight on him at the door; framing the house while he hunts; close again at the end
    let follow: { x: number; z: number } | null = { x: this.he.x, z: this.he.z };

    switch (this.phase) {
      case 'approach': {
        if (this.t > 0.6) this.rig.root.visible = true;
        // a slow, unhurried walk with the odd stutter-freeze
        if (this.freezeT > 0) {
          this.freezeT -= dt;
          frozen = true;
        } else {
          this.nextFreeze -= dt;
          if (this.nextFreeze <= 0) {
            this.freezeT = 0.5 + Math.random() * 0.6;
            this.nextFreeze = 4 + Math.random() * 4;
          }
          const step = APPROACH_SPEED * dt;
          const h = moveAlong(this.he, this.he.path, step);
          stride = step;
          if (h !== null) this.he.yaw = dampAngle(this.he.yaw, h, 2.2, dt);
        }
        const near = this.doorPoint ?? this.entryPoint;
        const dDoor = dist2(this.he.x, this.he.z, near.wx, near.wz);
        if (!this.camOn && (dDoor < 4.5 || this.he.path.length <= 2)) {
          this.camOn = true; // only now does the camera find him: close in as he reaches the door
          s.focus();
          cam.setZoom(1.9);
          s.followRate = 1.2;
        }
        if (dDoor < 1.9) {
          s.hold();
          if (this.doorPoint) s.openDoorsNear(this.doorPoint.wx, this.doorPoint.wz, 1.9, true);
        }
        if (!this.camOn) follow = null;
        if (dist2(this.he.x, this.he.z, this.entryPoint.wx, this.entryPoint.wz) < 0.5 || this.he.path.length === 0 || this.t > 90) {
          s.hold();
          s.shutDoorsBehind();
          this.phase = 'shock';
          this.t = 0;
          this.he.path = [];
        }
        break;
      }
      case 'shock':
        lookCam = this.t > 0.6 && this.t < 2.2;
        if (this.t > 2.6) {
          this.phase = 'duel';
          this.t = 0;
          this.victimTotal = s.victims.length;
          this.assignRoles();
          cam.setZoom(1.75);
          s.followRate = 1.0;
        }
        break;
      case 'duel': {
        // The strongest stands up to him. We watch it fail.
        const f = s.alive().find((v) => v.fighter && v.mode !== 'vanish');
        if (!f) {
          if (!s.alive().some((v) => v.fighter)) {
            this.phase = 'panic';
            this.t = 0;
            for (const v of s.alive()) {
              if (v.mode === 'vanish') continue;
              v.flees = 0;
              this.flee(v);
            }
            cam.setZoom(Math.max(0.8, Math.min(1.2, s.origZoom)));
            s.followRate = 0.7;
          }
          break;
        }
        this.target = f;
        follow = { x: (this.he.x + f.x) / 2, z: (this.he.z + f.z) / 2 };
        const d = dist2(f.x, f.z, this.he.x, this.he.z);
        if (d > 1.4) {
          this.repath -= dt;
          if (this.repath <= 0) {
            this.repath = 0.9;
            this.he.path = s.pathTo(this.he.x, this.he.z, s.tileAt(f.x, f.z));
          }
          const step = 0.55 * dt;
          const h = moveAlong(this.he, this.he.path, step);
          stride = step;
          if (h !== null) this.he.yaw = dampAngle(this.he.yaw, h, 2.0, dt);
        } else {
          this.he.yaw = dampAngle(this.he.yaw, Math.atan2(f.x - this.he.x, f.z - this.he.z), 2, dt);
        }
        reachTarget = f.mode === 'fight' ? (f.t > 1.3 ? 1 : 0.3) : 0.15;
        if (f.mode === 'fight' && f.t > 2.8 && this.reach > 0.8) this.erase(f); // a touch
        break;
      }
      case 'panic':
        // ...then everyone panics
        if (this.t > 1.2) {
          this.phase = 'hunt';
          this.t = 0;
        }
        break;
      case 'hunt': {
        follow = {
          x: s.houseCenter.x + (this.he.x - s.houseCenter.x) * 0.35,
          z: s.houseCenter.z + (this.he.z - s.houseCenter.z) * 0.35,
        };
        this.victimTotal = Math.max(this.victimTotal, s.victims.length);
        this.retarget -= dt;
        if (!this.target || this.target.mode === 'vanish' || this.target.removed || this.retarget <= 0) {
          this.target = this.nearestAlive();
          this.retarget = 1.2;
          this.repath = 0;
        }
        const t = this.target;
        if (!t) {
          if (s.alive().length === 0) {
            this.phase = 'toSeat';
            this.t = 0;
          }
          break;
        }
        const d = dist2(t.x, t.z, this.he.x, this.he.z);
        reachTarget = d < 3.4 ? 1 : 0;
        this.repath -= dt;
        if (this.repath <= 0) {
          this.repath = 0.9;
          this.he.path = s.pathTo(this.he.x, this.he.z, s.tileAt(t.x, t.z));
          if (this.he.path.length === 0 && d > KILL_RADIUS) this.he.path = [{ wx: t.x, wz: t.z }];
        }
        // Unstoppable: after a long hunt the dark simply carries him to them
        if (this.huntT > 95 && this.blinkCd <= 0 && d > KILL_RADIUS) {
          this.blinkCd = 1.5;
          s.pulseDark(() => {
            const a = Math.atan2(this.he.x - t.x, this.he.z - t.z);
            this.he.x = t.x + Math.sin(a) * (KILL_RADIUS - 0.3);
            this.he.z = t.z + Math.cos(a) * (KILL_RADIUS - 0.3);
            this.he.path = [];
          });
        }
        // stutter-freeze
        if (this.freezeT > 0) {
          this.freezeT -= dt;
          frozen = true;
        } else {
          this.nextFreeze -= dt;
          if (this.nextFreeze <= 0) {
            this.freezeT = 0.45 + Math.random() * 0.6;
            this.nextFreeze = 3.2 + Math.random() * 4;
          }
        }
        if (!frozen && d > KILL_RADIUS - 0.25) {
          const step = HUNT_SPEED * dt * (0.85 + 0.3 * Math.max(0, Math.sin(this.total * 1.6)));
          const h = moveAlong(this.he, this.he.path, step);
          stride = step;
          if (h !== null) this.he.yaw = dampAngle(this.he.yaw, h, 2.0, dt);
        } else if (!frozen) {
          this.he.yaw = dampAngle(this.he.yaw, Math.atan2(t.x - this.he.x, t.z - this.he.z), 1.5, dt);
        }
        // the lights fail room by room as the dread builds
        if (this.escalation() > 0.55) {
          this.killNext -= dt;
          if (this.killNext <= 0) {
            this.killNext = 3;
            let best: LampState | null = null;
            let bd = Infinity;
            for (const L of this.lamps.values()) {
              if (L.dieT >= 0) continue;
              const dd = dist2(L.x, L.z, this.he.x, this.he.z);
              if (dd < bd) {
                bd = dd;
                best = L;
              }
            }
            if (best) best.dieT = 0;
          }
        }
        break;
      }
      case 'toSeat': {
        // nobody left: he goes to the last empty chair
        if (this.t < dt * 1.5) {
          this.seat = this.pickSeat();
          const goal = this.seat
            ? s.tileAt(this.seat.x + Math.sin(this.seat.yaw) * 0.85, this.seat.z + Math.cos(this.seat.yaw) * 0.85)
            : s.tileAt(s.houseCenter.x, s.houseCenter.z);
          this.he.path = s.pathTo(this.he.x, this.he.z, goal);
          if (this.seat) {
            this.he.path.push({ wx: this.seat.x + Math.sin(this.seat.yaw) * 0.55, wz: this.seat.z + Math.cos(this.seat.yaw) * 0.55 });
          }
          cam.setZoom(1.6);
          s.followRate = 0.9;
        }
        const h = moveAlong(this.he, this.he.path, 0.9 * dt);
        stride = 0.9 * dt;
        if (h !== null) this.he.yaw = dampAngle(this.he.yaw, h, 2.0, dt);
        if (this.he.path.length === 0 || this.t > 30) {
          this.phase = this.seat ? 'sit' : 'flowers';
          this.t = 0;
          this.sitFrom = { x: this.he.x, z: this.he.z, yaw: this.he.yaw };
        }
        break;
      }
      case 'sit': {
        const seat = this.seat;
        if (!seat) break;
        const k = smooth(this.t / 1.8);
        this.he.x = this.sitFrom.x + (seat.x - this.sitFrom.x) * k;
        this.he.z = this.sitFrom.z + (seat.z - this.sitFrom.z) * k;
        this.he.yaw = dampAngle(this.he.yaw, seat.yaw, 3, dt);
        this.sit = smooth((this.t - 0.3) / 1.5);
        if (this.t > 2.0) {
          this.phase = 'flowers';
          this.t = 0;
        }
        break;
      }
      case 'flowers': {
        // ...and lays the flowers down
        reachTarget = this.t < 1.6 ? 0.55 : 0;
        if (!this.flowersFrom && this.t > 0.6) {
          s.root.attach(this.rig.bouquet);
          this.flowersFrom = { p: this.rig.bouquet.position.clone(), q: this.rig.bouquet.quaternion.clone() };
        }
        if (this.flowersFrom) {
          const k = smooth((this.t - 0.6) / 1.4);
          const to = new THREE.Vector3(this.he.x + Math.sin(this.he.yaw) * 0.62, 0.07, this.he.z + Math.cos(this.he.yaw) * 0.62);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, this.he.yaw + 0.5, 0, 'YXZ'));
          this.rig.bouquet.position.lerpVectors(this.flowersFrom.p, to, k);
          this.rig.bouquet.quaternion.slerpQuaternions(this.flowersFrom.q, q, k);
        }
        if (this.t > 2.4) {
          this.phase = 'stare';
          this.t = 0;
          this.zoom0 = cam.getZoom();
        }
        break;
      }
      case 'stare': {
        // his face turns square to the screen and stays there; the camera pushes in; the record wears out
        const k = smooth(this.t / 8);
        cam.setZoom(this.zoom0 + (2.45 - this.zoom0) * k);
        s.followRate = 0.8;
        this.decay = Math.min(1, this.decay + dt / 5);
        if (this.t > 5.5 && s.dirge) {
          s.dirge.stop(1.5); // crackle fades to silence
          s.dirge = null;
        }
        if (this.t > 8.5) {
          this.phase = 'silence';
          this.t = 0;
        }
        break;
      }
      case 'silence':
        // a held beat of nothing while he stares, then a hard cut to black
        if (this.t > 2.6) return 'done';
        break;
    }

    // head: tilts toward the camera now and then; otherwise toward whoever he's closing on
    if (this.phase === 'hunt') {
      this.lookT -= dt;
      if (this.lookT <= 0) {
        this.nextLook -= dt;
        if (this.nextLook <= 0) {
          this.lookT = 2.2;
          this.nextLook = 5 + Math.random() * 4;
        }
      } else {
        lookCam = true;
      }
    }
    const camPos = cam.camera.position;
    let yawTarget = 0;
    let rollTarget = 0.2;
    const staring = this.phase === 'stare' || this.phase === 'silence';
    if (staring) {
      yawTarget = 0; // faceDir below turns the photo square to the screen
      rollTarget = this.phase === 'stare' && this.t > 3 ? 0.16 : 0.03; // the one slight tilt
    } else if (lookCam) {
      yawTarget = Math.max(-1.35, Math.min(1.35, angleDiff(this.he.yaw, Math.atan2(camPos.x - this.he.x, camPos.z - this.he.z))));
      rollTarget = 0.42;
    } else if (this.target && this.phase === 'hunt') {
      yawTarget = Math.max(-0.9, Math.min(0.9, angleDiff(this.he.yaw, Math.atan2(this.target.x - this.he.x, this.target.z - this.he.z))));
    }
    if (!frozen) {
      this.headYaw = damp(this.headYaw, yawTarget, 1.6, dt);
      this.headRoll = damp(this.headRoll, rollTarget, 1.2, dt);
      this.duck = damp(this.duck, duckTarget, 4, dt);
      this.reach = damp(this.reach, reachTarget, 1.3, dt);
    }

    this.rig.root.position.set(this.he.x, 0, this.he.z);
    this.rig.root.rotation.y = this.he.yaw;
    this.rig.update(dt, {
      stride,
      frozen,
      duck: this.duck,
      sit: this.sit,
      seatY: this.seat?.y ?? 0,
      // once seated: the photo faces the screen squarely, whatever that does to his neck
      faceDir: staring ? cam.camera.getWorldDirection(new THREE.Vector3()).negate() : undefined,
      reach: this.reach,
      headYaw: this.headYaw,
      headRoll: this.headRoll,
    });
    if (this.rig.root.visible) s.openDoorsNear(this.he.x, this.he.z, 1.45);
    for (const v of s.victims) this.updateVictim(v, dt);
    for (const d of this.dusts) if (d.age < d.life) d.update(dt); // piles stay until he leaves
    this.updateProps(dt);

    // escalation → colour drain, vignette, grain, sway, light, rain, dirge wear
    const ending = this.phase === 'toSeat' || this.phase === 'sit' || this.phase === 'flowers' || staring;
    const e = ending ? Math.min(0.55, this.escalation()) : this.escalation();
    s.esc.sat = 1 - 0.88 * this.escalation();
    s.esc.con = 1 + 0.2 * e;
    s.esc.bri = 1 - 0.12 * e;
    s.esc.vignette = 0.3 + 0.45 * e;
    s.esc.grain = 0.05 + 0.22 * e;
    s.esc.sway = 0.012 + 0.075 * e;
    s.globalLight = 0.85 - 0.3 * e;
    s.rain?.setLevel(0.25 + 0.75 * e);
    if (!ending) this.decay = Math.max(this.decay, 0.08 + 0.62 * e);
    s.dirge?.setDecay(this.decay);
    if (staring) {
      // frame his face, not his feet: aim at the ground point that sits behind his face on screen
      const fwd = new THREE.Vector3();
      cam.camera.getWorldDirection(fwd);
      const len = Math.hypot(fwd.x, fwd.z) || 1;
      follow = { x: this.he.x + (fwd.x / len) * 1.5, z: this.he.z + (fwd.z / len) * 1.5 };
      const st = this.phase === 'stare' ? smooth(this.t / 6) : 1;
      s.esc.vignette = Math.max(s.esc.vignette, 0.45 + 0.5 * st);
      s.esc.letterbox = 0.12 * (this.phase === 'stare' ? smooth(this.t / 3) : 1);
      s.esc.sway = 0;
    }
    s.followTarget = follow;
    return 'running';
  }

  /** The ending fades slowly to black (Adi preferred the original fade-out to a hard cut). */
  readonly hardCut = false;

  private escalation(): number {
    if (this.phase === 'approach') return 0.05;
    const kills = this.victimTotal > 0 ? this.killed / this.victimTotal : 1;
    return clamp01(0.1 + 0.6 * kills + 0.3 * Math.min(1, this.huntT / 90));
  }

  /** For tests/screenshots. */
  debugInfo(): { phase: LGPhase; x: number; z: number; yaw: number; killed: number; alive: number; tris: number } {
    return {
      phase: this.phase,
      x: this.he.x,
      z: this.he.z,
      yaw: this.he.yaw,
      killed: this.killed,
      alive: this.s.alive().length,
      tris: countTriangles(this.rig.root),
    };
  }

  dispose(): void {
    for (const d of this.dusts) d.dispose();
    this.dusts.length = 0;
    for (const p of this.props) p.m.removeFromParent();
    this.props.length = 0;
    this.propGeo.dispose();
    for (const m of this.propMats) m.dispose();
    this.rig.bouquet.removeFromParent();
    this.rig.root.removeFromParent();
    this.rig.dispose();
  }
}

// ---------------------------------------------------------------------------
// Director: trigger, run lifecycle, aftermath
// ---------------------------------------------------------------------------

interface Run {
  stage: Stage;
  script: LastGuestScript;
  ending: boolean;
  banished: boolean;
}

let instance: HorrorDirector | null = null;

export class HorrorDirector {
  private run: Run | null = null;
  private pending = false;
  private aftermath: { t: number; staffAt: number; musicAt: number; staffDone: boolean; musicDone: boolean } | null = null;
  private curtain: { el: HTMLDivElement; o: number; target: number; rate: number; onBlack: (() => void) | null } | null = null;

  constructor(private readonly deps: Deps) {
    instance = this;
    deps.sceneManager.addTickHook((_simDt, realDt) => this.tick(realDt));
    deps.visitorModule.horrorLegendarySlot = () => this.takeLegendarySlot();
  }

  /**
   * Optional: when The Last Guest reaches Gojo, the hunt pauses and this is called instead of Gojo
   * vanishing (e.g. to play a Gojo attack). Call banish() to end him. Unset: Gojo vanishes too.
   */
  onGojoConfronts: ((gojo: { id: string; root: THREE.Object3D; x: number; z: number }, guestPos: { x: number; z: number }) => void) | null = null;

  /** Erase The Last Guest mid-scene; surviving guests stay, then the normal cleanup runs. */
  banish(): void {
    const run = this.run;
    if (!run || run.ending || run.banished) return;
    run.banished = true;
    run.script.banish();
    setGrudge(true);
  }

  /** The player's camera view from before the event, for a cutscene that plays inside it. */
  getPlayerView(): { zoom: number; x: number; z: number } | null {
    return this.run?.stage.playerView() ?? null;
  }

  /** True while the event is playing or about to (for mutual exclusion with other cutscenes). */
  isActive(): boolean {
    return this.run !== null || this.pending;
  }

  /** Starts The Last Guest now, any weather or hour (dev list, tests). */
  start(): boolean {
    if (this.run || this.curtain) {
      this.deps.store.notify('Something is already here…', 'info');
      return false;
    }
    this.pending = false;
    this.completeAftermath();
    // Cutscenes always play at 1× and the game stays at 1× afterwards.
    this.deps.store.setSimSpeed(1);
    const stage = new Stage(this.deps, 'The Last Guest', () => this.skip());
    const script = new LastGuestScript(stage);
    script.confront = (gojo, guestPos) => {
      if (!this.onGojoConfronts) return false; // no handler: Gojo vanishes like everyone else
      this.onGojoConfronts(gojo, guestPos);
      return true;
    };
    this.run = { stage, script, ending: false, banished: false };
    return true;
  }

  /** Jump to the end state: everyone gone, he is gone, camera/lights/music/door control restored. */
  skip(): void {
    const run = this.run;
    if (!run || run.ending) return;
    run.ending = true;
    this.fadeCurtain(1, 0.35, () => {
      this.finish(run, true);
      this.fadeCurtain(0, 0.9, null);
    });
  }

  /** Night + not Peaceful Mode + not met this session + no showdown running + a full house (> 5 guests) + not already running (weather checked by callers). */
  canArrive(): boolean {
    if (isPeacefulMode() || hasMetLastGuest() || this.run || this.pending || this.aftermath || this.curtain) return false;
    if (this.deps.visitorModule.isShowdownActive()) return false;
    if (this.deps.store.getState().timeOfDay !== 'night') return false;
    return this.deps.visitorModule.getActiveVisitors().length > MIN_GUESTS_EXCLUSIVE;
  }

  /** After Gojo beat him: any rainy or stormy night with at least one guest and no Gojo, he comes. */
  private tickGrudge(): void {
    if (!holdsGrudge() || isPeacefulMode() || this.run || this.pending || this.aftermath || this.curtain) return;
    const state = this.deps.store.getState();
    if (state.timeOfDay !== 'night' || (state.weatherId !== 'rain' && state.weatherId !== 'thunderstorm')) return;
    if (this.deps.visitorModule.isShowdownActive()) return;
    const guests = this.deps.visitorModule.getActiveVisitors();
    if (guests.length === 0 || guests.some((g) => g.visitorId === 'gojo')) return;
    setGrudge(false); // one guaranteed return; beat him again to earn another
    this.arrive();
  }

  private arrive(): void {
    try {
      sessionStorage.setItem(MET_KEY, '1'); // once per session: rare, and never twice in one sitting
    } catch {
      // storage blocked: he may come again
    }
    this.pending = true; // starts next frame
  }

  debugInfo(): ReturnType<LastGuestScript['debugInfo']> | null {
    return this.run ? this.run.script.debugInfo() : null;
  }

  /** Called from VisitorModule's legendary spawner: The Last Guest may take the arrival slot. */
  private takeLegendarySlot(): boolean {
    if (!this.canArrive() || !LAST_GUEST_WEATHERS.has(this.deps.store.getState().weatherId)) return false;
    // likely on a rainy or stormy night, less so in fog
    const chance = this.deps.store.getState().weatherId === 'fog' ? 0.35 : 0.85;
    if (Math.random() >= chance) return false;
    this.arrive(); // starts next frame, outside VisitorModule.update()
    return true;
  }

  private tick(realDt: number): void {
    const dt = Math.min(0.05, Math.max(0, realDt));
    if (this.pending && !this.run) this.start();
    const run = this.run;
    if (run) {
      if (!run.ending && run.script.update(dt) === 'done') {
        run.ending = true;
        if (run.banished) {
          this.finish(run, false);
        } else {
          this.fadeCurtain(1, run.script.hardCut ? 0.05 : 2.2, () => {
            this.finish(run, false);
            this.fadeCurtain(0, 2.4, null);
          });
        }
      }
      if (this.run === run) run.stage.tick(dt);
    } else {
      this.tickAftermath(dt);
      this.tickGrudge();
    }
    this.tickCurtain(dt);
  }

  private finish(run: Run, skipped: boolean): void {
    if (this.run !== run) return;
    this.run = null;
    if (run.banished) {
      // the survivors stay: hand them back to the sim right where they stand
      for (const v of run.script.survivors()) {
        run.stage.restoreKids(v);
        v.h.bubble.sprite.visible = false;
        if (v.h.kind === 'visitor') this.deps.visitorModule.horrorReturnVisitor(v.h.id, v.x, v.z, v.yaw);
      }
      run.script.dispose();
      run.stage.restore(0.15);
      this.aftermath = { t: 0, staffAt: 0, musicAt: 3, staffDone: false, musicDone: false };
      return;
    }
    run.script.dispose();
    run.stage.hold();
    run.stage.removeEveryone();
    run.stage.restore(skipped ? 1.2 : 2.5);
    this.aftermath = {
      t: 0,
      staffAt: skipped ? 2.2 : STAFF_RETURN_S,
      musicAt: skipped ? 3.5 : MUSIC_RETURN_S,
      staffDone: false,
      musicDone: false,
    };
  }

  private tickAftermath(dt: number): void {
    const a = this.aftermath;
    if (!a) return;
    a.t += dt;
    if (!a.staffDone && a.t >= a.staffAt) {
      a.staffDone = true;
      this.deps.visitorModule.setHorrorHold(false, ARRIVALS_COOLDOWN_SIM);
      this.deps.visitorModule.horrorRestoreStaff();
    }
    if (!a.musicDone && a.t >= a.musicAt) {
      a.musicDone = true;
      this.deps.audioModule.setMusicSuspended(false);
    }
    if (a.staffDone && a.musicDone) this.aftermath = null;
  }

  private completeAftermath(): void {
    if (!this.aftermath) return;
    this.aftermath.t = Infinity;
    this.tickAftermath(0);
  }

  private fadeCurtain(target: number, seconds: number, onBlack: (() => void) | null): void {
    if (!this.curtain) {
      const el = div('position:fixed;inset:0;background:#000;opacity:0;z-index:2147483000;pointer-events:auto;');
      document.body.appendChild(el);
      this.curtain = { el, o: 0, target, rate: 1, onBlack: null };
    }
    const c = this.curtain;
    c.target = target;
    c.rate = Math.abs(target - c.o) / Math.max(0.05, seconds);
    c.onBlack = onBlack;
  }

  private tickCurtain(dt: number): void {
    const c = this.curtain;
    if (!c) return;
    const step = c.rate * dt;
    c.o = c.o < c.target ? Math.min(c.target, c.o + step) : Math.max(c.target, c.o - step);
    c.el.style.opacity = c.o.toFixed(3);
    if (c.o !== c.target) return;
    if (c.onBlack) {
      const cb = c.onBlack;
      c.onBlack = null;
      cb();
    } else if (c.target === 0) {
      c.el.remove();
      this.curtain = null;
    }
  }
}

// ---------------------------------------------------------------------------
// HUD builders (called from small hook lines in HudController)
// ---------------------------------------------------------------------------

/** Menu setting: "Peaceful Mode" switch (localStorage `cozyhouse:peaceful`, default off) with a hint. */
export function buildPeacefulModeRow(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  const row = document.createElement('div');
  row.className = 'toggle-setting-row';
  const label = document.createElement('span');
  label.className = 'toggle-setting-label';
  label.textContent = 'Peaceful Mode';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-label', 'Peaceful Mode');
  const knob = document.createElement('span');
  knob.className = 'sb-toggle-knob';
  btn.appendChild(knob);
  const sync = () => {
    const on = isPeacefulMode();
    btn.className = on ? 'sb-toggle-switch on' : 'sb-toggle-switch';
    btn.setAttribute('aria-checked', String(on));
  };
  btn.addEventListener('click', () => {
    setPeacefulMode(!isPeacefulMode());
    sync();
  });
  sync();
  row.append(label, btn);
  const hint = document.createElement('div');
  hint.textContent = 'For when it comes during the night';
  hint.style.cssText = 'font-size:11px;font-style:italic;opacity:0.65;margin:4px 4px 0;';
  wrap.append(row, hint);
  return wrap;
}

/** DEV · Legendary Guests card (same markup as the others); Invite starts the event immediately. */
export function buildLastGuestDevCard(): HTMLElement {
  const name = 'The Last Guest';
  const line = 'Comes in from the rain. Nobody stays.';
  const card = document.createElement('div');
  card.className = 'invite-visitor-card';
  card.title = line;
  const portrait = document.createElement('div');
  portrait.className = 'visitor-portrait special-portrait';
  portrait.style.background = 'color-mix(in srgb, #3b3f4c 36%, #FCF9F2)';
  const img = document.createElement('img');
  img.className = 'visitor-portrait-img';
  img.alt = name;
  img.draggable = false;
  img.src = getLastGuestPortrait();
  const badge = document.createElement('span');
  badge.className = 'visitor-archetype-badge special';
  badge.textContent = '✦';
  badge.setAttribute('aria-hidden', 'true');
  portrait.append(img, badge);
  const body = document.createElement('div');
  body.className = 'invite-visitor-body';
  const nameEl = document.createElement('div');
  nameEl.className = 'invite-visitor-name';
  nameEl.textContent = name;
  const star = document.createElement('span');
  star.className = 'special-sparkle-badge';
  star.textContent = '✦';
  nameEl.appendChild(star);
  const sub = document.createElement('div');
  sub.className = 'invite-visitor-sub';
  sub.textContent = `🖼️ ${line}`;
  body.append(nameEl, sub);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn primary btn-xs';
  const text = document.createElement('span');
  text.textContent = 'Invite';
  btn.appendChild(text);
  btn.addEventListener('click', () => {
    instance?.start();
  });
  card.append(portrait, body, btn);
  return card;
}
