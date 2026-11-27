import * as THREE from 'three';
import type {
  FurnitureItemDef,
  GameDataBundle,
  HouseState,
  PlacedItem,
  SceneryViewDef,
  TimeOfDay,
  WeatherDef,
} from '../data/schemas';
import type { HouseStore } from '../state/houseStore';
import { AssetLoader } from './AssetLoader';
import {
  CEILING_HEIGHT,
  GridVisual,
  WALL_THICKNESS,
  canonicalWallEdgeKey,
  getEffectiveFootprint,
  parseCanonicalWallEdgeKey,
  tileToWorldCenter,
  wallEdgeToWorldTransform,
} from './GridSystem';
import { IsometricCamera } from './IsometricCamera';
import { ModelPreviewRenderer } from './ModelPreviewRenderer';

interface RenderedItemEntry {
  uid: string;
  item: PlacedItem;
  group: THREE.Group;
  bounceTime: number;
  wallOpacity: number;
  wallOpacityInitialized: boolean;
  spinTargets: THREE.Object3D[];
  isDynamicGroup: boolean;
}

interface InstancedFloorSubMesh {
  mesh: THREE.InstancedMesh;
  subLocalMatrix: THREE.Matrix4;
}

interface InstancedFloorItemRecord {
  uid: string;
  item: PlacedItem;
  def: FurnitureItemDef;
  instanceIndex: number;
  worldMatrix: THREE.Matrix4;
  subMeshes: InstancedFloorSubMesh[];
  localHeight: number;
  localCenterY: number;
}

interface DynamicLightRig {
  uid: string;
  itemId: string;
  root: THREE.Group;
  pointLights: Array<{ light: THREE.PointLight; baseIntensity: number }>;
  poolMat?: THREE.MeshBasicMaterial;
  basePoolOpacity: number;
  beamMats: THREE.MeshBasicMaterial[];
  spotMats: THREE.MeshBasicMaterial[];
  spinRig?: THREE.Group;
  spinSpeed: number;
  flicker: boolean;
  phase: number;
}

interface TimeAtmosphereStop {
  hour: number;
  skyTint: THREE.Color;
  skyMix: number;
  sunTint: THREE.Color;
  sunMix: number;
  ambTint: THREE.Color;
  ambMix: number;
  groundColor: THREE.Color;
  ambIntensityMult: number;
  fillColor: THREE.Color;
  fillIntensity: number;
  lightBoost: number;
  poolBoost: number;
  beamOpacity: number;
  spotOpacity: number;
}

interface SampledAtmosphere {
  skyTint: THREE.Color;
  skyMix: number;
  sunTint: THREE.Color;
  sunMix: number;
  ambTint: THREE.Color;
  ambMix: number;
  groundColor: THREE.Color;
  ambIntensityMult: number;
  fillColor: THREE.Color;
  fillIntensity: number;
  lightBoost: number;
  poolBoost: number;
  beamOpacity: number;
  spotOpacity: number;
}

const MAX_ACTIVE_POINT_LIGHTS = 12;
const DYNAMIC_SHADOW_INTERVAL = 1 / 15; // ~15 Hz while visitors/bounces move; 0 Hz when idle

const LIGHT_EMITTER_IDS = new Set([
  'table_lamp',
  'lamp_floor_arc',
  'lamp_pendant',
  'lamp_desk',
  'lamp_lava',
  'neon_sign',
  'neon_drink_menu',
  'fairy_lights',
  'string_lights',
  'scented_candle',
  'floor_uplight',
  'party_spotlight',
  'laser_bar',
  'disco_ball',
  'diner_jukebox',
  'dance_floor_tile',
  'led_strip_wall',
]);

const LAMP_POOL_IDS = new Set([
  'table_lamp',
  'lamp_floor_arc',
  'lamp_pendant',
  'lamp_desk',
  'lamp_lava',
  'scented_candle',
  'floor_uplight',
]);

const ROTATING_RIG_IDS = new Set(['disco_ball', 'party_spotlight', 'laser_bar']);
const FLICKER_IDS = new Set(['scented_candle', 'lamp_lava']);
const BASS_PULSE_IDS = new Set(['speaker_tower', 'subwoofer_box']);
const VIVID_COLOR_LIGHT_IDS = new Set([
  'neon_sign',
  'neon_drink_menu',
  'lamp_lava',
  'floor_uplight',
  'party_spotlight',
  'laser_bar',
  'disco_ball',
  'dance_floor_tile',
  'led_strip_wall',
  'diner_jukebox',
]);

function makeStop(
  hour: number,
  skyTint: string,
  skyMix: number,
  sunTint: string,
  sunMix: number,
  ambTint: string,
  ambMix: number,
  groundColor: string,
  ambIntensityMult: number,
  fillColor: string,
  fillIntensity: number,
  lightBoost: number,
  poolBoost: number,
  beamOpacity: number,
  spotOpacity: number,
): TimeAtmosphereStop {
  return {
    hour,
    skyTint: new THREE.Color(skyTint),
    skyMix,
    sunTint: new THREE.Color(sunTint),
    sunMix,
    ambTint: new THREE.Color(ambTint),
    ambMix,
    groundColor: new THREE.Color(groundColor),
    ambIntensityMult,
    fillColor: new THREE.Color(fillColor),
    fillIntensity,
    lightBoost,
    poolBoost,
    beamOpacity,
    spotOpacity,
  };
}

/**
 * Periodic 24-hour atmosphere keyframes (hour 24 mirrors hour 0) interpolated
 * with smooth cubic Hermite curves so dragging the Time Slider glides seamlessly.
 */
const TIME_ATMOSPHERE_STOPS: readonly TimeAtmosphereStop[] = [
  makeStop(0.0, '#16203b', 1.0, '#9ab4e8', 1.0, '#4a5f94', 1.0, '#232a42', 0.24, '#556da8', 0.14, 2.45, 1.48, 0.31, 0.54),
  makeStop(4.5, '#1e2a4a', 0.98, '#9eb8ec', 1.0, '#55699e', 0.96, '#2b324c', 0.27, '#5f76af', 0.16, 2.32, 1.42, 0.29, 0.50),
  makeStop(6.0, '#e8b5a8', 0.58, '#ffac78', 0.72, '#ebbcb6', 0.62, '#a6888a', 0.58, '#cbb6de', 0.26, 1.58, 1.20, 0.24, 0.40),
  makeStop(7.5, '#fce2cf', 0.22, '#ffd7b0', 0.40, '#ffece0', 0.28, '#d8c8bc', 0.88, '#dce8ff', 0.36, 1.10, 1.00, 0.19, 0.30),
  makeStop(10.0, '#fff5ea', 0.04, '#fff4e4', 0.06, '#fff8f0', 0.04, '#d8cec2', 0.98, '#dce8f7', 0.36, 0.88, 0.84, 0.18, 0.28),
  makeStop(12.5, '#ffffff', 0.0, '#ffffff', 0.0, '#ffffff', 0.0, '#d8cec2', 1.0, '#dce8f7', 0.35, 0.85, 0.82, 0.18, 0.28),
  makeStop(16.0, '#faebd4', 0.12, '#ffe3ba', 0.22, '#fff0dc', 0.15, '#d6c6b8', 0.95, '#e2e4f4', 0.34, 0.96, 0.88, 0.18, 0.29),
  makeStop(17.75, '#f2bc9c', 0.36, '#ffa664', 0.54, '#ebb5b0', 0.64, '#b28c8e', 0.76, '#cfa6ca', 0.30, 1.32, 1.08, 0.22, 0.36),
  makeStop(18.75, '#e89f8c', 0.48, '#ff8e52', 0.68, '#d69bb0', 0.96, '#8f7080', 0.62, '#b997cf', 0.26, 1.58, 1.22, 0.24, 0.40),
  makeStop(19.75, '#48416e', 0.86, '#9a98cc', 0.96, '#6c689c', 1.0, '#3f3b5b', 0.38, '#7376ad', 0.19, 2.08, 1.36, 0.28, 0.47),
  makeStop(21.25, '#1c2746', 1.0, '#9ab4e8', 1.0, '#53689c', 1.0, '#272e47', 0.27, '#5a72ab', 0.15, 2.38, 1.44, 0.30, 0.52),
  makeStop(23.0, '#1a2542', 1.0, '#9ab4e8', 1.0, '#53689c', 1.0, '#272e47', 0.26, '#5a72ab', 0.14, 2.42, 1.46, 0.30, 0.53),
  makeStop(24.0, '#16203b', 1.0, '#9ab4e8', 1.0, '#4a5f94', 1.0, '#232a42', 0.24, '#556da8', 0.14, 2.45, 1.48, 0.31, 0.54),
];

function defaultHourForTimeOfDay(timeOfDay: TimeOfDay): number {
  switch (timeOfDay) {
    case 'morning':
      return 7.5;
    case 'sunset':
      return 18.75;
    case 'night':
      return 23;
    case 'day':
    default:
      return 12;
  }
}

function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 12;
  return ((hour % 24) + 24) % 24;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function sampleAtmosphereCurve(hour: number, out: SampledAtmosphere): SampledAtmosphere {
  const h = normalizeHour(hour);
  let a = TIME_ATMOSPHERE_STOPS[0];
  let b = TIME_ATMOSPHERE_STOPS[TIME_ATMOSPHERE_STOPS.length - 1];

  for (let i = 0; i < TIME_ATMOSPHERE_STOPS.length - 1; i++) {
    const s0 = TIME_ATMOSPHERE_STOPS[i];
    const s1 = TIME_ATMOSPHERE_STOPS[i + 1];
    if (h >= s0.hour && h <= s1.hour) {
      a = s0;
      b = s1;
      break;
    }
  }

  const rawT = b.hour > a.hour ? (h - a.hour) / (b.hour - a.hour) : 0;
  // Cubic Hermite smoothstep for C1-smooth color and intensity transitions
  const t = rawT * rawT * (3 - 2 * rawT);

  out.skyTint.lerpColors(a.skyTint, b.skyTint, t);
  out.skyMix = THREE.MathUtils.lerp(a.skyMix, b.skyMix, t);
  out.sunTint.lerpColors(a.sunTint, b.sunTint, t);
  out.sunMix = THREE.MathUtils.lerp(a.sunMix, b.sunMix, t);
  out.ambTint.lerpColors(a.ambTint, b.ambTint, t);
  out.ambMix = THREE.MathUtils.lerp(a.ambMix, b.ambMix, t);
  out.groundColor.lerpColors(a.groundColor, b.groundColor, t);
  out.ambIntensityMult = THREE.MathUtils.lerp(a.ambIntensityMult, b.ambIntensityMult, t);
  out.fillColor.lerpColors(a.fillColor, b.fillColor, t);
  out.fillIntensity = THREE.MathUtils.lerp(a.fillIntensity, b.fillIntensity, t);
  out.lightBoost = THREE.MathUtils.lerp(a.lightBoost, b.lightBoost, t);
  out.poolBoost = THREE.MathUtils.lerp(a.poolBoost, b.poolBoost, t);
  out.beamOpacity = THREE.MathUtils.lerp(a.beamOpacity, b.beamOpacity, t);
  out.spotOpacity = THREE.MathUtils.lerp(a.spotOpacity, b.spotOpacity, t);
  return out;
}

function isDescendantOfAny(obj: THREE.Object3D, ancestors: THREE.Object3D[]): boolean {
  if (ancestors.length === 0) return false;
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (ancestors.includes(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

export class SceneManager {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly isoCamera: IsometricCamera;
  readonly assetLoader: AssetLoader;
  private _gridVisual: GridVisual;
  readonly itemsRoot = new THREE.Group();
  readonly overlayRoot = new THREE.Group();
  readonly lightsRoot = new THREE.Group();
  readonly ceilingRoot = new THREE.Group();
  private readonly instancedFloorsRoot = new THREE.Group();

  private readonly store: HouseStore;
  private readonly data: GameDataBundle;
  private readonly ambientLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;

  private currentGridWidth: number;
  private currentGridDepth: number;
  private currentTimeOfDay: TimeOfDay = 'day';
  private currentTimeHour = 12;
  private previewRenderer: ModelPreviewRenderer | null = null;
  private renderedItems = new Map<string, RenderedItemEntry>();
  private instancedFloorItems = new Map<string, InstancedFloorItemRecord>();
  private instancedFloorMeshes: THREE.InstancedMesh[] = [];
  private lastFloorSignature = '';
  private lastCeilingSignature = '';
  private lastDynamicLightsSignature = '';
  private activeLightRigs: DynamicLightRig[] = [];
  private glowPoolTexture: THREE.CanvasTexture | null = null;
  private beamGradientTexture: THREE.CanvasTexture | null = null;

  // Pre-filtered hot-loop lists (rebuilt only in syncFromState)
  private wallEntries: RenderedItemEntry[] = [];
  private mountedEntries: RenderedItemEntry[] = [];
  private spinnerEntries: RenderedItemEntry[] = [];
  private bassPulseEntries: RenderedItemEntry[] = [];
  private bouncingEntries: RenderedItemEntry[] = [];

  // Enclosed-room & cutaway cache + reusable scratch objects
  private enclosedCells: boolean[][] = [];
  private floorTileCells: boolean[][] = [];
  private occupiedCells: boolean[][] = [];
  private enclosedCellCount = 0;
  private readonly camForwardScratch = new THREE.Vector3();
  private readonly wallTargetsMap = new Map<string, number>();
  private readonly outlineBoxScratch = new THREE.Box3();
  private readonly outlineSizeScratch = new THREE.Vector3();
  private readonly outlineCenterScratch = new THREE.Vector3();
  private readonly tilePosScratch = new THREE.Vector3();
  private readonly tileQuatScratch = new THREE.Quaternion();
  private readonly tileScaleScratch = new THREE.Vector3(1, 1, 1);
  private readonly tileZeroScaleScratch = new THREE.Vector3(0, 0, 0);
  private readonly tileUpAxis = new THREE.Vector3(0, 1, 0);
  private readonly tileMatScratch = new THREE.Matrix4();
  private readonly sampledAtmoScratch: SampledAtmosphere = {
    skyTint: new THREE.Color(),
    skyMix: 0,
    sunTint: new THREE.Color(),
    sunMix: 0,
    ambTint: new THREE.Color(),
    ambMix: 0,
    groundColor: new THREE.Color(),
    ambIntensityMult: 1,
    fillColor: new THREE.Color(),
    fillIntensity: 0.35,
    lightBoost: 0.85,
    poolBoost: 0.82,
    beamOpacity: 0.18,
    spotOpacity: 0.28,
  };
  private readonly skyColorScratch = new THREE.Color();
  private readonly weatherTintScratch = new THREE.Color();
  private readonly sunColorScratch = new THREE.Color();
  private readonly ambColorScratch = new THREE.Color();
  private lastWallCamX = Number.NaN;
  private lastWallCamZ = Number.NaN;
  private wallsTransitioning = true;

  // Smart on-demand shadow refresh tracking
  private dynamicShadowAccum = 0;
  private visitorsRootRef: THREE.Object3D | null = null;
  private lastVisitorCount = 0;
  private lastVisitorMotionChecksum = 0;

  private selectionOutlinesGroup = new THREE.Group();
  private selectionOutlinePool: THREE.LineSegments[] = [];
  private hoverOutline: THREE.LineSegments;
  private hoverOutlineUid: string | null = null;
  private eraseHoverOutline: THREE.LineSegments;
  private eraseHoverUid: string | null = null;
  private movingHiddenUid: string | null = null;

  private rafId = 0;
  private lastTime = performance.now();
  private elapsedTime = 0;
  private tickHooks = new Set<(dt: number) => void>();
  private resizeObserver: ResizeObserver;

  get gridVisual(): GridVisual {
    return this._gridVisual;
  }

  /**
   * Resolves the placed item UID for a raycast hit, supporting both instanced floor tiles
   * (`hit.object.userData.instanceUids[hit.instanceId]`) and regular item meshes (`userData.itemUid`).
   */
  static resolveHitUid(hit: THREE.Intersection): string | undefined {
    if (hit.instanceId !== undefined) {
      const uids = hit.object.userData.instanceUids as string[] | undefined;
      if (uids && hit.instanceId >= 0 && hit.instanceId < uids.length) {
        return uids[hit.instanceId];
      }
    }
    return hit.object.userData.itemUid as string | undefined;
  }

  resolveHitUid(hit: THREE.Intersection): string | undefined {
    return SceneManager.resolveHitUid(hit);
  }

  constructor(
    container: HTMLElement,
    store: HouseStore,
    onCameraQuarterChange?: (quarter: number) => void,
  ) {
    this.container = container;
    this.store = store;
    this.data = store.data;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#EFECE4');

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    container.appendChild(this.renderer.domElement);

    this.isoCamera = new IsometricCamera(width, height, onCameraQuarterChange);
    const initialState = store.getState();
    this.currentTimeOfDay = initialState.timeOfDay ?? 'day';
    this.currentTimeHour = normalizeHour(
      initialState.timeHour ?? defaultHourForTimeOfDay(this.currentTimeOfDay),
    );
    this.isoCamera.setPanLimit(initialState.gridWidth, initialState.gridDepth);

    // Warm indoor/diorama lighting with soft on-demand shadows
    this.ambientLight = new THREE.HemisphereLight(0xfff7ed, 0xd8cec2, 0.95);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff2dc, 1.18);
    this.sunLight.position.set(14, 22, 12);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 80;
    this.updateShadowFrustum(initialState.gridWidth, initialState.gridDepth);
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.028;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0xdce8f7, 0.35);
    this.fillLight.position.set(-12, 10, -10);
    this.scene.add(this.fillLight);

    this.assetLoader = new AssetLoader(this.data);
    this.currentGridWidth = initialState.gridWidth;
    this.currentGridDepth = initialState.gridDepth;
    this._gridVisual = new GridVisual(initialState.gridWidth, initialState.gridDepth);
    this._gridVisual.setGridVisible(store.isEditMode() || store.isGridVisible());
    this.scene.add(this._gridVisual.group);

    this.itemsRoot.name = 'PlacedItemsRoot';
    this.instancedFloorsRoot.name = 'InstancedFloorsRoot';
    this.instancedFloorsRoot.matrixAutoUpdate = false;
    this.instancedFloorsRoot.updateMatrix();
    this.itemsRoot.add(this.instancedFloorsRoot);

    this.overlayRoot.name = 'PlacementOverlayRoot';
    this.lightsRoot.name = 'DynamicLightsRoot';
    this.ceilingRoot.name = 'CeilingOverlayRoot';
    this.scene.add(this.itemsRoot);
    this.scene.add(this.ceilingRoot);
    this.scene.add(this.lightsRoot);
    this.scene.add(this.overlayRoot);

    this.selectionOutlinesGroup.name = 'SelectionOutlinesGroup';
    this.overlayRoot.add(this.selectionOutlinesGroup);

    this.hoverOutline = this.createBoxOutline(0x4a90d9, 0.92);
    this.hoverOutline.visible = false;
    this.overlayRoot.add(this.hoverOutline);

    this.eraseHoverOutline = this.createBoxOutline(0xe05252, 0.96);
    this.eraseHoverOutline.visible = false;
    this.overlayRoot.add(this.eraseHoverOutline);

    // Apply initial atmosphere for continuous timeHour right away
    const initView = this.data.viewsById.get(initialState.sceneryViewId);
    const initWeather = this.data.weathersById.get(initialState.weatherId);
    if (initView && initWeather) {
      this.applyAtmosphere(initView, initWeather, this.currentTimeOfDay, this.currentTimeHour);
    }

    this.syncFromState(initialState);

    store.on('houseChanged', ({ state, reason }) => this.syncFromState(state, reason));
    store.on('selectionChanged', ({ selectedUids }) => this.updateSelectionHighlights(selectedUids));
    store.on('editModeChanged', ({ editMode }) => {
      this.syncGridVisibility();
      if (!editMode) {
        this.setHoverOutlineUid(null);
        this.setEraseHoverUid(null);
        this.setMovingHiddenUid(null);
      }
    });
    store.on('gridVisibilityChanged', () => this.syncGridVisibility());
    store.on('wallViewChanged', () => {
      this.ceilingRoot.visible = this.store.isCeilingVisible() && this.enclosedCellCount > 0;
      this.wallsTransitioning = true;
      this.updateWallTranslucency(0, false);
    });
    store.on('itemInteracted', ({ item }) => {
      const def = this.data.itemsById.get(item.itemId);
      if (!def?.interaction) return;
      const entry = this.renderedItems.get(item.uid);
      if (entry) {
        entry.bounceTime = 0.001;
        entry.group.matrixAutoUpdate = true;
        if (!this.bouncingEntries.includes(entry)) {
          this.bouncingEntries.push(entry);
        }
        this.markShadowsDirty();
      }
    });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.startLoop();
  }

  /** Marks the directional shadow map dirty so it re-renders on the next frame. */
  markShadowsDirty(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  private syncGridVisibility(): void {
    this._gridVisual.setGridVisible(this.store.isEditMode() || this.store.isGridVisible());
  }

  private updateShadowFrustum(gridWidth: number, gridDepth: number): void {
    const d = Math.max(14, Math.max(gridWidth, gridDepth) * 0.85);
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.updateProjectionMatrix();
    this.markShadowsDirty();
  }

  private createBoxOutline(color = 0xe07a5f, opacity = 0.95): THREE.LineSegments {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(boxGeo);
    boxGeo.dispose();
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
    });
    return new THREE.LineSegments(edges, mat);
  }

  private getGlowPoolTexture(): THREE.CanvasTexture {
    if (this.glowPoolTexture) return this.glowPoolTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      grad.addColorStop(0.35, 'rgba(255, 250, 235, 0.5)');
      grad.addColorStop(0.75, 'rgba(255, 244, 220, 0.14)');
      grad.addColorStop(1, 'rgba(255, 240, 210, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.glowPoolTexture = tex;
    return tex;
  }

  private getBeamGradientTexture(): THREE.CanvasTexture {
    if (this.beamGradientTexture) return this.beamGradientTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Canvas y=0 maps to ConeGeometry UV v=1 (apex); y=128 maps to v=0 (base).
      const grad = ctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
      grad.addColorStop(0.24, 'rgba(255, 255, 255, 0.52)');
      grad.addColorStop(0.62, 'rgba(255, 255, 255, 0.16)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    this.beamGradientTexture = tex;
    return tex;
  }

  addTickHook(fn: (dt: number) => void): () => void {
    this.tickHooks.add(fn);
    return () => this.tickHooks.delete(fn);
  }

  getPreviewRenderer(): ModelPreviewRenderer {
    if (!this.previewRenderer) {
      this.previewRenderer = new ModelPreviewRenderer(this.assetLoader, 112);
    }
    return this.previewRenderer;
  }

  applyAtmosphere(
    view: SceneryViewDef,
    weather: WeatherDef,
    timeOfDay: TimeOfDay = 'day',
    timeHour?: number,
  ): void {
    const resolvedHour = normalizeHour(timeHour ?? defaultHourForTimeOfDay(timeOfDay));
    const timeChanged =
      this.currentTimeOfDay !== timeOfDay || Math.abs(this.currentTimeHour - resolvedHour) > 0.0005;
    this.currentTimeOfDay = timeOfDay;
    this.currentTimeHour = resolvedHour;

    const atmo = sampleAtmosphereCurve(resolvedHour, this.sampledAtmoScratch);
    const weatherAmb = 0.75 + 0.25 * weather.lightMultiplier;

    // Continuous sky background color (zero per-call allocations)
    this.skyColorScratch
      .set(view.fogColor)
      .lerp(atmo.skyTint, atmo.skyMix)
      .multiply(this.weatherTintScratch.set(weather.skyTint));

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.skyColorScratch);
    } else {
      this.scene.background = this.skyColorScratch.clone();
    }

    // Continuous 24-hour sun (5:15..19:45 East->Overhead->West) and moon (19:45..5:15) arc.
    // Intensity reaches 0 at the exact 5:15 and 19:45 horizon handovers for zero shadow pop.
    const prevSunX = this.sunLight.position.x;
    const prevSunY = this.sunLight.position.y;
    const prevSunZ = this.sunLight.position.z;

    let sunX: number;
    let sunY: number;
    let sunZ: number;
    let sunIntensityMult: number;

    if (resolvedHour >= 5.25 && resolvedHour <= 19.75) {
      const u = (resolvedHour - 5.25) / 14.5;
      const angle = u * Math.PI;
      const sinA = Math.sin(angle);
      const cosA = Math.cos(angle);
      sunX = cosA * 23 + sinA * 6;
      sunY = 4.5 + sinA * 18.5;
      sunZ = 8 + u * 6;

      const riseFade = smoothstep(5.25, 6.65, resolvedHour);
      const setFade = 1 - smoothstep(18.7, 19.75, resolvedHour);
      const elevBoost = 0.78 + 0.24 * sinA;
      sunIntensityMult = riseFade * setFade * elevBoost;
    } else {
      const nightElapsed =
        resolvedHour >= 19.75 ? resolvedHour - 19.75 : resolvedHour + (24 - 19.75);
      const tm = nightElapsed / 9.5;
      const moonAngle = tm * Math.PI;
      const sinM = Math.sin(moonAngle);
      const cosM = Math.cos(moonAngle);
      sunX = cosM * 16 - sinM * 6;
      sunY = 8 + sinM * 12;
      sunZ = -10 - sinM * 2.5;

      const moonRise = smoothstep(0, 1.0, nightElapsed);
      const moonSet = 1 - smoothstep(8.5, 9.5, nightElapsed);
      sunIntensityMult = 0.24 * moonRise * moonSet;
    }

    this.sunLight.position.set(sunX, sunY, sunZ);
    this.sunColorScratch.set(view.sunColor).lerp(atmo.sunTint, atmo.sunMix);
    this.sunLight.color.copy(this.sunColorScratch);
    this.sunLight.intensity = view.sunIntensity * sunIntensityMult * weather.lightMultiplier;

    this.ambColorScratch.set(view.ambientColor).lerp(atmo.ambTint, atmo.ambMix);
    this.ambientLight.color.copy(this.ambColorScratch);
    this.ambientLight.groundColor.copy(atmo.groundColor);
    this.ambientLight.intensity = view.ambientIntensity * atmo.ambIntensityMult * weatherAmb;

    this.fillLight.color.copy(atmo.fillColor);
    this.fillLight.intensity = atmo.fillIntensity;

    this._gridVisual.setYardColor(view.groundColor);

    if (
      Math.abs(sunX - prevSunX) > 1e-4 ||
      Math.abs(sunY - prevSunY) > 1e-4 ||
      Math.abs(sunZ - prevSunZ) > 1e-4
    ) {
      this.markShadowsDirty();
    }

    if (timeChanged) {
      this.refreshLightRigIntensities();
    }
  }

  getItemObject(uid: string): THREE.Group | undefined {
    return this.renderedItems.get(uid)?.group;
  }

  getInteractableMeshes(): THREE.Object3D[] {
    return this.itemsRoot.children;
  }

  private setInstancedFloorTileVisible(uid: string, visible: boolean): void {
    const rec = this.instancedFloorItems.get(uid);
    if (!rec) return;
    if (visible) {
      for (const sub of rec.subMeshes) {
        this.tileMatScratch.multiplyMatrices(rec.worldMatrix, sub.subLocalMatrix);
        sub.mesh.setMatrixAt(rec.instanceIndex, this.tileMatScratch);
        sub.mesh.instanceMatrix.needsUpdate = true;
      }
    } else {
      this.tileMatScratch.makeScale(0, 0, 0);
      for (const sub of rec.subMeshes) {
        sub.mesh.setMatrixAt(rec.instanceIndex, this.tileMatScratch);
        sub.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  setMovingHiddenUid(uid: string | null): void {
    if (this.movingHiddenUid === uid) return;
    if (this.movingHiddenUid) {
      const prev = this.renderedItems.get(this.movingHiddenUid);
      if (prev) {
        prev.group.visible = true;
        this.markShadowsDirty();
      } else if (this.instancedFloorItems.has(this.movingHiddenUid)) {
        this.setInstancedFloorTileVisible(this.movingHiddenUid, true);
      }
    }
    this.movingHiddenUid = uid;
    if (uid) {
      const next = this.renderedItems.get(uid);
      if (next) {
        next.group.visible = false;
        this.markShadowsDirty();
      } else if (this.instancedFloorItems.has(uid)) {
        this.setInstancedFloorTileVisible(uid, false);
      }
    }
  }

  private computeItemWorldPosition(
    item: PlacedItem,
    state: HouseState,
  ): { x: number; y: number; z: number; rotY: number } | null {
    const def = this.data.itemsById.get(item.itemId);
    if (!def) return null;

    if (def.layer === 'wall') {
      const mountOffset = def.wallKind === 'mounted' ? WALL_THICKNESS / 2 + 0.01 : 0;
      const t = wallEdgeToWorldTransform(
        item.x,
        item.z,
        item.rotation,
        state.gridWidth,
        state.gridDepth,
        mountOffset,
      );
      return { x: t.wx, y: item.y, z: t.wz, rotY: t.rotY };
    }

    const eff = getEffectiveFootprint(def, item.rotation);
    const center = tileToWorldCenter(
      item.x,
      item.z,
      eff.w,
      eff.d,
      state.gridWidth,
      state.gridDepth,
    );
    return {
      x: center.wx,
      y: item.y,
      z: center.wz,
      rotY: -item.rotation * (Math.PI / 2),
    };
  }

  private clearDynamicLights(): void {
    for (const rig of this.activeLightRigs) {
      this.lightsRoot.remove(rig.root);
      this.disposeGroup(rig.root);
    }
    this.activeLightRigs = [];
  }

  private refreshLightRigIntensities(): void {
    const atmo = sampleAtmosphereCurve(this.currentTimeHour, this.sampledAtmoScratch);
    const boost = atmo.lightBoost;
    const poolBoost = atmo.poolBoost;
    const beamOp = atmo.beamOpacity;
    const spotOp = atmo.spotOpacity;
    for (const rig of this.activeLightRigs) {
      for (const pl of rig.pointLights) {
        pl.light.intensity = pl.baseIntensity * boost;
      }
      if (rig.poolMat) {
        rig.poolMat.opacity = Math.min(0.68, rig.basePoolOpacity * poolBoost);
      }
      for (const bm of rig.beamMats) {
        bm.opacity = beamOp;
      }
      for (const sm of rig.spotMats) {
        sm.opacity = spotOp;
      }
    }
  }

  private rebuildDynamicLights(state: HouseState): void {
    const activeLights: PlacedItem[] = [];
    for (const item of state.items) {
      if (item.active && LIGHT_EMITTER_IDS.has(item.itemId)) {
        activeLights.push(item);
      }
    }

    let sig = `${state.gridWidth}x${state.gridDepth}|${activeLights.length}`;
    for (let i = 0; i < activeLights.length; i++) {
      const it = activeLights[i];
      sig += `;${it.uid}:${it.itemId}:${it.variantId}:${it.x},${it.y},${it.z},${it.rotation}`;
    }
    if (sig === this.lastDynamicLightsSignature) {
      return;
    }
    this.lastDynamicLightsSignature = sig;

    this.clearDynamicLights();
    if (activeLights.length === 0) return;

    // Prioritize rotating party fixtures and lamps under the 12-PointLight budget
    const sorted = [...activeLights].sort((a, b) => {
      const aPri = ROTATING_RIG_IDS.has(a.itemId) ? 2 : LAMP_POOL_IDS.has(a.itemId) ? 1 : 0;
      const bPri = ROTATING_RIG_IDS.has(b.itemId) ? 2 : LAMP_POOL_IDS.has(b.itemId) ? 1 : 0;
      return bPri - aPri;
    });

    const atmo = sampleAtmosphereCurve(this.currentTimeHour, this.sampledAtmoScratch);
    const todBoost = atmo.lightBoost;
    const poolBoost = atmo.poolBoost;
    const beamOp = atmo.beamOpacity;
    const spotOp = atmo.spotOpacity;
    const glowTex = this.getGlowPoolTexture();
    const beamTex = this.getBeamGradientTexture();
    const downAxis = new THREE.Vector3(0, -1, 0);
    let pointLightsUsed = 0;

    for (let idx = 0; idx < sorted.length; idx++) {
      const item = sorted[idx];
      const def = this.data.itemsById.get(item.itemId);
      if (!def) continue;
      const transform = this.computeItemWorldPosition(item, state);
      if (!transform) continue;

      const variant = def.variants.find((v) => v.id === item.variantId) ?? def.variants[0];
      const lightColor = new THREE.Color(variant.color);
      if (!VIVID_COLOR_LIGHT_IDS.has(item.itemId)) {
        lightColor.lerp(new THREE.Color('#ffdca8'), 0.55);
      }

      const rigRoot = new THREE.Group();
      rigRoot.name = `LightRig_${item.uid}`;
      const rigLights: Array<{ light: THREE.PointLight; baseIntensity: number }> = [];
      const beamMats: THREE.MeshBasicMaterial[] = [];
      const spotMats: THREE.MeshBasicMaterial[] = [];

      let lx = transform.x;
      let ly = transform.y + def.height * 0.78;
      let lz = transform.z;

      if (def.layer === 'ceiling') {
        ly = transform.y - def.height * 0.65;
      } else if (def.layer === 'wall' && def.wallKind === 'mounted') {
        ly = transform.y;
        lx += Math.sin(transform.rotY) * 0.28;
        lz += Math.cos(transform.rotY) * 0.28;
      } else if (item.itemId === 'dance_floor_tile') {
        ly = 0.25;
      }

      rigRoot.position.set(lx, ly, lz);

      const isRotating = ROTATING_RIG_IDS.has(item.itemId);
      let spinRig: THREE.Group | undefined;

      if (isRotating) {
        // Rotating disco ball / spotlight / laser soft volumetric projection rig
        spinRig = new THREE.Group();
        spinRig.name = 'LightProjectionRig';
        const beamColors =
          item.itemId === 'laser_bar'
            ? ['#ff7bc6', '#6cf0e6', '#b996ff']
            : ['#ff95cc', '#82eee6', '#ffe38d'];
        const floorDropY = 0.036 - ly;

        for (let b = 0; b < 3; b++) {
          const angle = (b / 3) * Math.PI * 2;
          const beamColor = beamColors[b % beamColors.length];
          const radiusOut = item.itemId === 'disco_ball' ? 1.85 : 1.35;
          const spotX = Math.cos(angle) * radiusOut;
          const spotZ = Math.sin(angle) * radiusOut;

          // Smooth vertical-fade volumetric beam cone: apex at (0,0,0), wide base at (spotX, floorDropY, spotZ)
          const beamVec = new THREE.Vector3(spotX, floorDropY, spotZ);
          const beamLen = Math.max(0.5, beamVec.length());
          const beamDir = beamVec.clone().normalize();
          const coneRadius = item.itemId === 'laser_bar' ? 0.16 : 0.34;
          const coneGeo = new THREE.ConeGeometry(coneRadius, beamLen, 16, 1, true);
          const coneMat = new THREE.MeshBasicMaterial({
            color: beamColor,
            map: beamTex,
            transparent: true,
            opacity: beamOp,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          beamMats.push(coneMat);

          const cone = new THREE.Mesh(coneGeo, coneMat);
          cone.position.copy(beamVec).multiplyScalar(0.5);
          cone.quaternion.setFromUnitVectors(downAxis, beamDir);
          cone.updateMatrix();
          cone.matrixAutoUpdate = false;
          spinRig.add(cone);

          // Soft orbiting disco floor reflection spot
          const spotRadius = item.itemId === 'laser_bar' ? 0.28 : 0.42;
          const spotGeo = new THREE.CircleGeometry(spotRadius, 16);
          spotGeo.rotateX(-Math.PI / 2);
          const spotMat = new THREE.MeshBasicMaterial({
            map: glowTex,
            color: beamColor,
            transparent: true,
            opacity: spotOp,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          spotMats.push(spotMat);

          const spot = new THREE.Mesh(spotGeo, spotMat);
          spot.position.set(spotX, floorDropY, spotZ);
          spot.updateMatrix();
          spot.matrixAutoUpdate = false;
          spinRig.add(spot);

          if (b < 2 && pointLightsUsed < MAX_ACTIVE_POINT_LIGHTS) {
            const baseIntensity = 1.65;
            const pl = new THREE.PointLight(beamColor, baseIntensity * todBoost, 6.5, 1.5);
            pl.castShadow = false;
            pl.position.set(spotX * 0.72, floorDropY + 0.55, spotZ * 0.72);
            pl.updateMatrix();
            pl.matrixAutoUpdate = false;
            spinRig.add(pl);
            rigLights.push({ light: pl, baseIntensity });
            pointLightsUsed += 1;
          }
        }
        rigRoot.add(spinRig);
      } else if (pointLightsUsed < MAX_ACTIVE_POINT_LIGHTS) {
        const baseIntensity =
          item.itemId === 'scented_candle'
            ? 0.95
            : item.itemId === 'lamp_pendant' || item.itemId === 'lamp_floor_arc'
              ? 2.2
              : item.itemId === 'neon_sign' || item.itemId === 'neon_drink_menu'
                ? 1.85
                : 1.55;
        const distance =
          item.itemId === 'lamp_pendant' || item.itemId === 'lamp_floor_arc'
            ? 8.2
            : item.itemId === 'scented_candle'
              ? 5.2
              : 6.5;
        const pl = new THREE.PointLight(lightColor, baseIntensity * todBoost, distance, 1.5);
        pl.castShadow = false;
        pl.updateMatrix();
        pl.matrixAutoUpdate = false;
        rigRoot.add(pl);
        rigLights.push({ light: pl, baseIntensity });
        pointLightsUsed += 1;
      }

      // Warm visible light-pool glow disc under lamps so ON/OFF reads clearly even in Day mode
      let poolMat: THREE.MeshBasicMaterial | undefined;
      let basePoolOpacity = 0;
      if (LAMP_POOL_IDS.has(item.itemId)) {
        const poolRadius =
          item.itemId === 'lamp_pendant' || item.itemId === 'lamp_floor_arc'
            ? 1.35
            : item.itemId === 'scented_candle'
              ? 0.52
              : 0.82;
        const poolY =
          def.layer === 'surface'
            ? transform.y + 0.012 - ly
            : 0.032 - ly;
        basePoolOpacity = item.itemId === 'scented_candle' ? 0.34 : 0.42;
        const poolGeo = new THREE.CircleGeometry(poolRadius, 18);
        poolGeo.rotateX(-Math.PI / 2);
        poolMat = new THREE.MeshBasicMaterial({
          map: glowTex,
          color: lightColor,
          transparent: true,
          opacity: Math.min(0.68, basePoolOpacity * poolBoost),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const pool = new THREE.Mesh(poolGeo, poolMat);
        pool.position.set(0, poolY, 0);
        pool.updateMatrix();
        pool.matrixAutoUpdate = false;
        rigRoot.add(pool);
      }

      rigRoot.updateMatrix();
      rigRoot.matrixAutoUpdate = false;
      this.lightsRoot.add(rigRoot);
      this.activeLightRigs.push({
        uid: item.uid,
        itemId: item.itemId,
        root: rigRoot,
        pointLights: rigLights,
        poolMat,
        basePoolOpacity,
        beamMats,
        spotMats,
        spinRig,
        spinSpeed: item.itemId === 'disco_ball' ? 0.95 : 1.35,
        flicker: FLICKER_IDS.has(item.itemId),
        phase: idx * 1.7 + 0.4,
      });
    }
  }

  private clearInstancedFloorTiles(): void {
    for (const im of this.instancedFloorMeshes) {
      this.instancedFloorsRoot.remove(im);
      // Releases instanceMatrix GPU attribute without disposing shared prototype geometry/material
      im.dispose();
    }
    this.instancedFloorMeshes = [];
    this.instancedFloorItems.clear();
  }

  private canInstanceFloorTile(def: FurnitureItemDef): boolean {
    return def.layer === 'floor' && def.subLayer === 'tile';
  }

  /**
   * Batches identical floor tiles by `(itemId, variantId, active)` into shared
   * `THREE.InstancedMesh` pools (one InstancedMesh per merged sub-mesh of each tile type),
   * collapsing 64–400 floor tiles into ~2–6 total draw calls while preserving exact
   * per-tile raycast picking via `instancedMesh.userData.instanceUids`.
   */
  private rebuildInstancedFloorTiles(
    state: HouseState,
    floorTiles: Array<{ item: PlacedItem; def: FurnitureItemDef }>,
  ): boolean {
    let sig = `${state.gridWidth}x${state.gridDepth}|${floorTiles.length}`;
    for (let i = 0; i < floorTiles.length; i++) {
      const it = floorTiles[i].item;
      sig += `;${it.uid}:${it.itemId}:${it.variantId}:${it.active ? 1 : 0}:${it.x},${it.y},${it.z},${it.rotation}`;
    }

    if (sig === this.lastFloorSignature) {
      return false;
    }
    this.lastFloorSignature = sig;

    this.clearInstancedFloorTiles();
    if (floorTiles.length === 0) {
      return true;
    }

    const buckets = new Map<
      string,
      { def: FurnitureItemDef; variantId: string; active: boolean; items: PlacedItem[] }
    >();

    for (let i = 0; i < floorTiles.length; i++) {
      const { item, def } = floorTiles[i];
      const active = Boolean(item.active);
      const key = `${item.itemId}__${item.variantId}__${active ? 1 : 0}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { def, variantId: item.variantId, active, items: [] };
        buckets.set(key, bucket);
      }
      bucket.items.push(item);
    }

    for (const [bucketKey, bucket] of buckets.entries()) {
      const proto = this.assetLoader.getOrBuildPrototype(
        bucket.def,
        bucket.variantId,
        bucket.active,
      );
      proto.updateMatrixWorld(true);

      this.outlineBoxScratch.setFromObject(proto);
      let localHeight = 0.024;
      let localCenterY = 0.012;
      if (!this.outlineBoxScratch.isEmpty()) {
        this.outlineBoxScratch.getSize(this.outlineSizeScratch);
        this.outlineBoxScratch.getCenter(this.outlineCenterScratch);
        localHeight = Math.max(0.016, this.outlineSizeScratch.y);
        localCenterY = this.outlineCenterScratch.y;
      }

      const protoSubMeshes: Array<{
        geometry: THREE.BufferGeometry;
        material: THREE.Material | THREE.Material[];
        localMatrix: THREE.Matrix4;
        castShadow: boolean;
        receiveShadow: boolean;
      }> = [];

      proto.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry && obj.material) {
          protoSubMeshes.push({
            geometry: obj.geometry,
            material: obj.material,
            localMatrix: obj.matrixWorld.clone(),
            castShadow: obj.castShadow,
            receiveShadow: obj.receiveShadow,
          });
        }
      });

      if (protoSubMeshes.length === 0) continue;

      const count = bucket.items.length;
      const uidList: string[] = new Array(count);
      const tileWorldMatrices: THREE.Matrix4[] = new Array(count);

      for (let i = 0; i < count; i++) {
        const item = bucket.items[i];
        uidList[i] = item.uid;
        const transform = this.computeItemWorldPosition(item, state);
        const wm = new THREE.Matrix4();
        if (transform) {
          this.tilePosScratch.set(transform.x, transform.y, transform.z);
          this.tileQuatScratch.setFromAxisAngle(this.tileUpAxis, transform.rotY);
          wm.compose(this.tilePosScratch, this.tileQuatScratch, this.tileScaleScratch);
        }
        tileWorldMatrices[i] = wm;
      }

      const bucketSubMeshes: InstancedFloorSubMesh[] = [];
      for (let s = 0; s < protoSubMeshes.length; s++) {
        const sub = protoSubMeshes[s];
        const im = new THREE.InstancedMesh(sub.geometry, sub.material, count);
        im.name = `InstancedFloor_${bucketKey}_${s}`;
        im.castShadow = sub.castShadow;
        im.receiveShadow = sub.receiveShadow;
        im.userData.instanceUids = uidList;

        for (let i = 0; i < count; i++) {
          const uid = uidList[i];
          if (uid === this.movingHiddenUid) {
            this.tileMatScratch.compose(
              this.tilePosScratch.set(0, 0, 0),
              this.tileQuatScratch.identity(),
              this.tileZeroScaleScratch,
            );
          } else {
            this.tileMatScratch.multiplyMatrices(tileWorldMatrices[i], sub.localMatrix);
          }
          im.setMatrixAt(i, this.tileMatScratch);
        }

        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingBox();
        im.computeBoundingSphere();
        im.updateMatrix();
        im.matrixAutoUpdate = false;

        this.instancedFloorsRoot.add(im);
        this.instancedFloorMeshes.push(im);
        bucketSubMeshes.push({ mesh: im, subLocalMatrix: sub.localMatrix });
      }

      for (let i = 0; i < count; i++) {
        const item = bucket.items[i];
        this.instancedFloorItems.set(item.uid, {
          uid: item.uid,
          item: { ...item },
          def: bucket.def,
          instanceIndex: i,
          worldMatrix: tileWorldMatrices[i],
          subMeshes: bucketSubMeshes,
          localHeight,
          localCenterY,
        });
      }
    }

    return true;
  }

  private freezeStaticSubtree(group: THREE.Group, spinTargets: THREE.Object3D[], dynamicGroup: boolean): void {
    group.traverse((obj) => {
      if (obj === group) return;
      if (isDescendantOfAny(obj, spinTargets)) {
        obj.matrixAutoUpdate = true;
      } else {
        obj.updateMatrix();
        obj.matrixAutoUpdate = false;
      }
    });
    group.updateMatrix();
    group.matrixAutoUpdate = dynamicGroup;
  }

  syncFromState(state: HouseState, reason?: string): void {
    const nextTod = state.timeOfDay ?? 'day';
    const nextHour = normalizeHour(state.timeHour ?? defaultHourForTimeOfDay(nextTod));
    const timeChanged =
      nextTod !== this.currentTimeOfDay || Math.abs(nextHour - this.currentTimeHour) > 0.0005;

    if (timeChanged || reason === 'scenery' || reason === 'weather') {
      const view = this.data.viewsById.get(state.sceneryViewId);
      const weather = this.data.weathersById.get(state.weatherId);
      if (view && weather) {
        this.applyAtmosphere(view, weather, nextTod, nextHour);
      } else if (timeChanged) {
        this.currentTimeOfDay = nextTod;
        this.currentTimeHour = nextHour;
        this.refreshLightRigIntensities();
      }
    }

    // Fast-path: pure atmosphere/metadata updates never change items, grid, walls, or ceilings
    if (
      reason === 'timeOfDay' ||
      reason === 'scenery' ||
      reason === 'weather' ||
      reason === 'roomOverride'
    ) {
      return;
    }

    let shadowsDirty = false;

    if (state.gridWidth !== this.currentGridWidth || state.gridDepth !== this.currentGridDepth) {
      const prevColor = this._gridVisual.getYardColor();
      const prevVisible = this._gridVisual.isYardVisible();
      this.scene.remove(this._gridVisual.group);
      this._gridVisual.dispose();
      this._gridVisual = new GridVisual(state.gridWidth, state.gridDepth);
      this._gridVisual.setYardColor(prevColor);
      this._gridVisual.setYardVisible(prevVisible);
      this._gridVisual.setGridVisible(this.store.isEditMode() || this.store.isGridVisible());
      this.scene.add(this._gridVisual.group);
      this.currentGridWidth = state.gridWidth;
      this.currentGridDepth = state.gridDepth;
      this.isoCamera.setPanLimit(state.gridWidth, state.gridDepth);
      this.updateShadowFrustum(state.gridWidth, state.gridDepth);
      shadowsDirty = true;
    }

    const nextIds = new Set<string>();
    const regularIds = new Set<string>();
    const floorTiles: Array<{ item: PlacedItem; def: FurnitureItemDef }> = [];
    const regularItems: Array<{ item: PlacedItem; def: FurnitureItemDef }> = [];

    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      nextIds.add(item.uid);
      const def = this.data.itemsById.get(item.itemId);
      if (!def) continue;
      if (this.canInstanceFloorTile(def)) {
        floorTiles.push({ item, def });
      } else {
        regularIds.add(item.uid);
        regularItems.push({ item, def });
      }
    }

    // Remove deleted or newly-instanced items from individual groups
    for (const [uid, entry] of this.renderedItems.entries()) {
      if (!regularIds.has(uid)) {
        this.itemsRoot.remove(entry.group);
        this.disposeGroup(entry.group);
        this.renderedItems.delete(uid);
        shadowsDirty = true;
      }
    }

    // Rebuild instanced floor tile pools only when floor layout/variants change
    if (this.rebuildInstancedFloorTiles(state, floorTiles)) {
      shadowsDirty = true;
    }

    // Add or update non-instanced items
    for (let i = 0; i < regularItems.length; i++) {
      const { item, def } = regularItems[i];
      const existing = this.renderedItems.get(item.uid);
      const needsRebuild =
        !existing ||
        existing.item.itemId !== item.itemId ||
        existing.item.variantId !== item.variantId ||
        existing.item.active !== item.active;
      const movedOrRotated =
        !existing ||
        existing.item.x !== item.x ||
        existing.item.y !== item.y ||
        existing.item.z !== item.z ||
        existing.item.rotation !== item.rotation;

      if (needsRebuild || movedOrRotated) {
        shadowsDirty = true;
      }

      let group: THREE.Group;
      let spinTargets: THREE.Object3D[];
      const bounceTime = existing?.bounceTime ?? 0;

      if (needsRebuild) {
        if (existing) {
          this.itemsRoot.remove(existing.group);
          this.disposeGroup(existing.group);
        }
        group = this.assetLoader.createPlaceholderMesh(def, item.variantId, {
          active: item.active,
        });
        spinTargets = [];
        group.userData.itemUid = item.uid;
        group.traverse((child) => {
          child.userData.itemUid = item.uid;
          if (child.name === 'SpinTarget') {
            spinTargets.push(child);
          }
        });
        if (item.uid === this.movingHiddenUid) {
          group.visible = false;
        }
        this.itemsRoot.add(group);
      } else {
        group = existing.group;
        spinTargets = existing.spinTargets;
      }

      const isDynamicGroup = Boolean(item.active && BASS_PULSE_IDS.has(item.itemId));
      const transform = this.computeItemWorldPosition(item, state);
      if (transform) {
        group.position.set(transform.x, transform.y, transform.z);
        group.rotation.set(0, transform.rotY, 0);
      }
      if (!isDynamicGroup && bounceTime === 0) {
        group.scale.set(1, 1, 1);
      }
      this.freezeStaticSubtree(group, spinTargets, isDynamicGroup || bounceTime > 0);

      this.renderedItems.set(item.uid, {
        uid: item.uid,
        item: { ...item },
        group,
        bounceTime,
        wallOpacity: existing && !needsRebuild ? existing.wallOpacity : 1,
        wallOpacityInitialized: Boolean(existing && !needsRebuild && existing.wallOpacityInitialized),
        spinTargets,
        isDynamicGroup,
      });
    }

    // Rebuild pre-filtered hot-loop lists once per state change
    this.wallEntries = [];
    this.mountedEntries = [];
    this.spinnerEntries = [];
    this.bassPulseEntries = [];
    this.bouncingEntries = this.bouncingEntries.filter((e) => regularIds.has(e.uid) && e.bounceTime > 0);

    for (const entry of this.renderedItems.values()) {
      const def = this.data.itemsById.get(entry.item.itemId);
      if (!def) continue;
      if (def.layer === 'wall' && def.wallKind === 'structure') {
        this.wallEntries.push(entry);
      } else if (def.layer === 'wall' && def.wallKind === 'mounted') {
        this.mountedEntries.push(entry);
      }
      if (def.interaction?.type === 'spin' && entry.spinTargets.length > 0) {
        this.spinnerEntries.push(entry);
      }
      if (entry.isDynamicGroup) {
        this.bassPulseEntries.push(entry);
      }
      if (entry.bounceTime > 0 && !this.bouncingEntries.includes(entry)) {
        this.bouncingEntries.push(entry);
      }
    }

    this.computeEnclosedRooms(state);
    this.rebuildCeilingOverlay(state);
    this.wallsTransitioning = true;
    this.updateWallTranslucency(0, true);
    this.rebuildDynamicLights(state);
    this.updateSelectionHighlights(this.store.getSelectedUids());
    if (this.hoverOutlineUid) {
      this.setHoverOutlineUid(nextIds.has(this.hoverOutlineUid) ? this.hoverOutlineUid : null);
    }
    if (this.eraseHoverUid) {
      this.setEraseHoverUid(nextIds.has(this.eraseHoverUid) ? this.eraseHoverUid : null);
    }

    if (shadowsDirty) {
      this.markShadowsDirty();
    }
  }

  getEnclosedCellCount(): number {
    return this.enclosedCellCount;
  }

  private computeEnclosedRooms(state: HouseState): void {
    const W = state.gridWidth;
    const D = state.gridDepth;

    const wallEdges = new Set<string>();
    const floorTiles: boolean[][] = Array.from({ length: W }, () => Array<boolean>(D).fill(false));
    const occupied: boolean[][] = Array.from({ length: W }, () => Array<boolean>(D).fill(false));

    for (const item of state.items) {
      const def = this.data.itemsById.get(item.itemId);
      if (!def) continue;
      if (def.layer === 'wall' && def.wallKind === 'structure') {
        wallEdges.add(canonicalWallEdgeKey(item.x, item.z, item.rotation));
      } else if (def.layer === 'floor') {
        const eff = getEffectiveFootprint(def, item.rotation);
        const isTile = def.subLayer === 'tile';
        for (let dx = 0; dx < eff.w; dx++) {
          for (let dz = 0; dz < eff.d; dz++) {
            const cx = item.x + dx;
            const cz = item.z + dz;
            if (cx >= 0 && cx < W && cz >= 0 && cz < D) {
              if (isTile) floorTiles[cx][cz] = true;
              else occupied[cx][cz] = true;
            }
          }
        }
      }
    }

    // Flood-fill from a 1-tile exterior ring [-1..W] x [-1..D] across non-wall edges
    const pw = W + 2;
    const pd = D + 2;
    const visited = new Uint8Array(pw * pd);
    const queueX = new Int16Array(pw * pd);
    const queueZ = new Int16Array(pw * pd);
    let head = 0;
    let tail = 0;

    visited[0] = 1;
    queueX[tail] = -1;
    queueZ[tail] = -1;
    tail += 1;

    while (head < tail) {
      const gx = queueX[head];
      const gz = queueZ[head];
      head += 1;

      if (gz - 1 >= -1) {
        const idx = (gx + 1) * pd + (gz - 1 + 1);
        if (!visited[idx] && !wallEdges.has(`H:${gx}:${gz}`)) {
          visited[idx] = 1;
          queueX[tail] = gx;
          queueZ[tail] = gz - 1;
          tail += 1;
        }
      }
      if (gz + 1 <= D) {
        const idx = (gx + 1) * pd + (gz + 1 + 1);
        if (!visited[idx] && !wallEdges.has(`H:${gx}:${gz + 1}`)) {
          visited[idx] = 1;
          queueX[tail] = gx;
          queueZ[tail] = gz + 1;
          tail += 1;
        }
      }
      if (gx - 1 >= -1) {
        const idx = (gx - 1 + 1) * pd + (gz + 1);
        if (!visited[idx] && !wallEdges.has(`V:${gx}:${gz}`)) {
          visited[idx] = 1;
          queueX[tail] = gx - 1;
          queueZ[tail] = gz;
          tail += 1;
        }
      }
      if (gx + 1 <= W) {
        const idx = (gx + 1 + 1) * pd + (gz + 1);
        if (!visited[idx] && !wallEdges.has(`V:${gx + 1}:${gz}`)) {
          visited[idx] = 1;
          queueX[tail] = gx + 1;
          queueZ[tail] = gz;
          tail += 1;
        }
      }
    }

    const enclosed: boolean[][] = Array.from({ length: W }, () => Array<boolean>(D).fill(false));
    let count = 0;
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        if (!visited[(x + 1) * pd + (z + 1)]) {
          enclosed[x][z] = true;
          count += 1;
        }
      }
    }

    this.enclosedCells = enclosed;
    this.floorTileCells = floorTiles;
    this.occupiedCells = occupied;
    this.enclosedCellCount = count;
  }

  private clearCeilingOverlay(): void {
    while (this.ceilingRoot.children.length > 0) {
      const child = this.ceilingRoot.children[0];
      this.ceilingRoot.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  private rebuildCeilingOverlay(state: HouseState): void {
    const W = state.gridWidth;
    const D = state.gridDepth;
    let sig = `${W}x${D}|${this.enclosedCellCount}|`;
    if (this.enclosedCellCount > 0) {
      for (let x = 0; x < W; x++) {
        for (let z = 0; z < D; z++) {
          if (this.enclosedCells[x]?.[z]) {
            sig += `${x},${z};`;
          }
        }
      }
    }
    if (sig === this.lastCeilingSignature) {
      this.ceilingRoot.visible = this.store.isCeilingVisible() && this.enclosedCellCount > 0;
      return;
    }
    this.lastCeilingSignature = sig;

    this.clearCeilingOverlay();
    if (this.enclosedCellCount === 0) {
      this.ceilingRoot.visible = false;
      return;
    }

    const halfW = W / 2;
    const halfD = D / 2;
    const y = CEILING_HEIGHT;
    const yEdge = CEILING_HEIGHT + 0.006;

    const positions: number[] = [];
    const normals: number[] = [];
    const cornicePoints: number[] = [];

    const isEnc = (x: number, z: number): boolean =>
      x >= 0 && x < W && z >= 0 && z < D && Boolean(this.enclosedCells[x]?.[z]);

    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        if (!isEnc(x, z)) continue;
        const x0 = x - halfW;
        const x1 = x0 + 1;
        const z0 = z - halfD;
        const z1 = z0 + 1;

        positions.push(x0, y, z0, x0, y, z1, x1, y, z1);
        positions.push(x0, y, z0, x1, y, z1, x1, y, z0);
        for (let k = 0; k < 6; k++) {
          normals.push(0, 1, 0);
        }

        if (!isEnc(x, z - 1)) cornicePoints.push(x0, yEdge, z0, x1, yEdge, z0);
        if (!isEnc(x, z + 1)) cornicePoints.push(x0, yEdge, z1, x1, yEdge, z1);
        if (!isEnc(x - 1, z)) cornicePoints.push(x0, yEdge, z0, x0, yEdge, z1);
        if (!isEnc(x + 1, z)) cornicePoints.push(x1, yEdge, z0, x1, yEdge, z1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    const mat = new THREE.MeshStandardMaterial({
      color: '#FFFDF8',
      transparent: true,
      opacity: 0.16,
      roughness: 0.35,
      metalness: 0.02,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ceilingMesh = new THREE.Mesh(geo, mat);
    ceilingMesh.name = 'EnclosedCeilingMesh';
    ceilingMesh.castShadow = false;
    ceilingMesh.receiveShadow = false;
    ceilingMesh.raycast = () => {};
    ceilingMesh.updateMatrix();
    ceilingMesh.matrixAutoUpdate = false;
    this.ceilingRoot.add(ceilingMesh);

    if (cornicePoints.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(cornicePoints, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: '#D5C9BA',
        transparent: true,
        opacity: 0.48,
      });
      const cornice = new THREE.LineSegments(lineGeo, lineMat);
      cornice.name = 'EnclosedCeilingCornice';
      cornice.raycast = () => {};
      cornice.updateMatrix();
      cornice.matrixAutoUpdate = false;
      this.ceilingRoot.add(cornice);
    }

    this.ceilingRoot.visible = this.store.isCeilingVisible();
  }

  private applyWallOpacityToGroup(group: THREE.Group, factor: number): boolean {
    let shadowChanged = false;
    group.userData.isTranslucentCutaway = factor < 0.55;
    group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.userData.baseCastShadow === undefined) {
        obj.userData.baseCastShadow = obj.castShadow;
      }
      const nextCast = factor >= 0.65 ? (obj.userData.baseCastShadow as boolean) : false;
      if (obj.castShadow !== nextCast) {
        obj.castShadow = nextCast;
        shadowChanged = true;
      }

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial)) {
          continue;
        }
        if (m.userData.baseOpacity === undefined) {
          m.userData.baseOpacity = m.opacity;
          m.userData.baseTransparent = m.transparent;
          m.userData.baseDepthWrite = m.depthWrite;
        }
        const baseOp = m.userData.baseOpacity as number;
        const baseTrans = m.userData.baseTransparent as boolean;
        const baseDW = m.userData.baseDepthWrite as boolean;
        if (factor >= 0.995) {
          m.opacity = baseOp;
          m.transparent = baseTrans;
          m.depthWrite = baseDW;
        } else {
          const eff = baseOp * factor;
          m.opacity = eff;
          m.transparent = eff < 0.99;
          m.depthWrite = eff >= 0.95;
        }
      }
    });
    return shadowChanged;
  }

  private updateWallTranslucency(dt: number, snapUninit = false): void {
    if (this.wallEntries.length === 0 && this.mountedEntries.length === 0) {
      this.wallsTransitioning = false;
      return;
    }

    // Horizontal look-from direction (target -> camera) in XZ
    this.isoCamera.camera.getWorldDirection(this.camForwardScratch);
    let camX = -this.camForwardScratch.x;
    let camZ = -this.camForwardScratch.z;
    const camLen = Math.hypot(camX, camZ);
    if (camLen > 1e-5) {
      camX /= camLen;
      camZ /= camLen;
    } else {
      camX = Math.SQRT1_2;
      camZ = Math.SQRT1_2;
    }

    // Skip work completely when camera orientation is steady and no wall is transitioning
    if (
      !snapUninit &&
      !this.wallsTransitioning &&
      Math.abs(camX - this.lastWallCamX) < 0.0002 &&
      Math.abs(camZ - this.lastWallCamZ) < 0.0002
    ) {
      return;
    }
    this.lastWallCamX = camX;
    this.lastWallCamZ = camZ;

    const mode = this.store.getWallViewMode();
    const W = this.currentGridWidth;
    const D = this.currentGridDepth;
    const smooth = dt > 0 ? 1 - Math.exp(-14 * dt) : 1;

    this.wallTargetsMap.clear();
    let anyMoving = false;
    let anyShadowChanged = false;

    const isInterior = (x: number, z: number): boolean => {
      if (x < 0 || x >= W || z < 0 || z >= D) return false;
      return Boolean(this.enclosedCells[x]?.[z] || this.floorTileCells[x]?.[z]);
    };

    const hasInteriorBehind = (x: number, z: number): boolean => {
      if (x < 0 || x >= W || z < 0 || z >= D) return false;
      return Boolean(this.enclosedCells[x]?.[z] || this.occupiedCells[x]?.[z]);
    };

    // Pass 1: pre-filtered structural walls
    for (let i = 0; i < this.wallEntries.length; i++) {
      const entry = this.wallEntries[i];
      const parsed = parseCanonicalWallEdgeKey(
        canonicalWallEdgeKey(entry.item.x, entry.item.z, entry.item.rotation),
      );

      let inA = false;
      let inB = false;
      let normAToBX = 0;
      let normAToBZ = 0;
      let farCellX = 0;
      let farCellZ = 0;

      if (parsed.axis === 'H') {
        inA = isInterior(parsed.ex, parsed.ez - 1);
        inB = isInterior(parsed.ex, parsed.ez);
        normAToBX = 0;
        normAToBZ = 1;
        farCellX = parsed.ex;
        farCellZ = camZ > 0 ? parsed.ez - 1 : parsed.ez;
      } else {
        inA = isInterior(parsed.ex - 1, parsed.ez);
        inB = isInterior(parsed.ex, parsed.ez);
        normAToBX = 1;
        normAToBZ = 0;
        farCellX = camX > 0 ? parsed.ex - 1 : parsed.ex;
        farCellZ = parsed.ez;
      }

      let target = 1.0;
      if (mode === 'solid') {
        target = 1.0;
      } else if (mode === 'translucent') {
        target = inA || inB ? 0.2 : 1.0;
      } else {
        if (inA !== inB) {
          const outX = inA ? normAToBX : -normAToBX;
          const outZ = inA ? normAToBZ : -normAToBZ;
          const dot = outX * camX + outZ * camZ;
          target = dot > 0.1 ? 0.18 : 1.0;
        } else if (inA && inB) {
          const align = Math.abs(normAToBX * camX + normAToBZ * camZ);
          if (align > 0.1 && hasInteriorBehind(farCellX, farCellZ)) {
            target = 0.3;
          }
        }
      }

      this.wallTargetsMap.set(entry.uid, target);

      const shouldSnap = snapUninit && !entry.wallOpacityInitialized;
      const nextOp = shouldSnap
        ? target
        : THREE.MathUtils.lerp(entry.wallOpacity, target, smooth);
      const snapped = Math.abs(nextOp - target) < 0.004 ? target : nextOp;

      if (snapped !== target) {
        anyMoving = true;
      }

      if (shouldSnap || Math.abs(snapped - entry.wallOpacity) > 0.001) {
        entry.wallOpacity = snapped;
        entry.wallOpacityInitialized = true;
        if (this.applyWallOpacityToGroup(entry.group, snapped)) {
          anyShadowChanged = true;
        }
      } else if (!entry.wallOpacityInitialized) {
        entry.wallOpacityInitialized = true;
        if (this.applyWallOpacityToGroup(entry.group, snapped)) {
          anyShadowChanged = true;
        }
      }
    }

    // Pass 2: pre-filtered wall-mounted items
    for (let i = 0; i < this.mountedEntries.length; i++) {
      const entry = this.mountedEntries[i];
      const parentTarget = entry.item.parentUid
        ? (this.wallTargetsMap.get(entry.item.parentUid) ?? 1.0)
        : 1.0;
      const target =
        mode === 'translucent' && parentTarget < 0.9
          ? 0.22
          : parentTarget < 0.9
            ? Math.max(0.2, parentTarget)
            : 1.0;

      const shouldSnap = snapUninit && !entry.wallOpacityInitialized;
      const nextOp = shouldSnap
        ? target
        : THREE.MathUtils.lerp(entry.wallOpacity, target, smooth);
      const snapped = Math.abs(nextOp - target) < 0.004 ? target : nextOp;

      if (snapped !== target) {
        anyMoving = true;
      }

      if (shouldSnap || Math.abs(snapped - entry.wallOpacity) > 0.001) {
        entry.wallOpacity = snapped;
        entry.wallOpacityInitialized = true;
        if (this.applyWallOpacityToGroup(entry.group, snapped)) {
          anyShadowChanged = true;
        }
      } else if (!entry.wallOpacityInitialized) {
        entry.wallOpacityInitialized = true;
        if (this.applyWallOpacityToGroup(entry.group, snapped)) {
          anyShadowChanged = true;
        }
      }
    }

    this.wallsTransitioning = anyMoving;
    if (anyShadowChanged) {
      this.markShadowsDirty();
    }
  }

  private positionOutlineForItem(outline: THREE.LineSegments, uid: string, pad = 0.04): boolean {
    if (uid === this.movingHiddenUid) return false;

    const instanced = this.instancedFloorItems.get(uid);
    if (instanced) {
      const eff = getEffectiveFootprint(instanced.def, instanced.item.rotation);
      const center = tileToWorldCenter(
        instanced.item.x,
        instanced.item.z,
        eff.w,
        eff.d,
        this.currentGridWidth,
        this.currentGridDepth,
      );
      outline.position.set(center.wx, instanced.item.y + instanced.localCenterY, center.wz);
      outline.rotation.set(0, 0, 0);
      outline.scale.set(
        Math.max(0.08, eff.w + pad),
        Math.max(0.06, instanced.localHeight + pad),
        Math.max(0.08, eff.d + pad),
      );
      return true;
    }

    const entry = this.renderedItems.get(uid);
    if (!entry || !entry.group.visible) return false;

    entry.group.updateWorldMatrix(true, true);
    this.outlineBoxScratch.setFromObject(entry.group);
    if (this.outlineBoxScratch.isEmpty()) return false;

    this.outlineBoxScratch.getSize(this.outlineSizeScratch);
    this.outlineBoxScratch.getCenter(this.outlineCenterScratch);

    outline.position.copy(this.outlineCenterScratch);
    outline.rotation.set(0, 0, 0);
    outline.scale.set(
      Math.max(0.08, this.outlineSizeScratch.x + pad),
      Math.max(0.06, this.outlineSizeScratch.y + pad),
      Math.max(0.08, this.outlineSizeScratch.z + pad),
    );
    return true;
  }

  updateSelectionHighlight(selectedUid: string | null): void {
    this.updateSelectionHighlights(selectedUid ? [selectedUid] : []);
  }

  updateSelectionHighlights(selectedUids: string[]): void {
    let activeCount = 0;
    for (const uid of selectedUids) {
      let outline = this.selectionOutlinePool[activeCount];
      if (!outline) {
        outline = this.createBoxOutline(0xe07a5f, 0.95);
        this.selectionOutlinePool.push(outline);
        this.selectionOutlinesGroup.add(outline);
      }
      if (this.positionOutlineForItem(outline, uid, 0.04)) {
        outline.visible = true;
        activeCount += 1;
      }
    }
    for (let i = activeCount; i < this.selectionOutlinePool.length; i++) {
      this.selectionOutlinePool[i].visible = false;
    }
  }

  setHoverOutlineUid(uid: string | null): void {
    this.hoverOutlineUid = uid;
    if (!uid) {
      this.hoverOutline.visible = false;
      return;
    }
    this.hoverOutline.visible = this.positionOutlineForItem(this.hoverOutline, uid, 0.055);
  }

  setEraseHoverUid(uid: string | null): void {
    this.eraseHoverUid = uid;
    if (!uid) {
      this.eraseHoverOutline.visible = false;
      return;
    }
    this.eraseHoverOutline.visible = this.positionOutlineForItem(this.eraseHoverOutline, uid, 0.06);
  }

  private disposeGroup(group: THREE.Group): void {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        if (obj.geometry && !obj.geometry.userData?.sharedGeo) {
          geos.add(obj.geometry);
        }
        if (Array.isArray(obj.material)) {
          for (const m of obj.material) {
            if (m && !m.userData?.sharedMat) mats.add(m);
          }
        } else if (obj.material && !obj.material.userData?.sharedMat) {
          mats.add(obj.material);
        }
      } else if (obj instanceof THREE.Sprite) {
        if (obj.material && !obj.material.userData?.sharedMat) {
          mats.add(obj.material);
        }
      }
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  }

  private handleResize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.isoCamera.resize(width, height);
    this.renderer.setSize(width, height);
  }

  /**
   * Detects active visitor motion or animated bouncing/pulsing shadow casters so the
   * on-demand shadow map refreshes at ~15 Hz during motion and 0 Hz when completely idle.
   */
  private updateDynamicShadowSchedule(dt: number): void {
    if (!this.visitorsRootRef) {
      this.visitorsRootRef = this.scene.getObjectByName('VisitorsRoot') ?? null;
    }

    let visitorCountChanged = false;
    let visitorsMoving = false;
    const visitors = this.visitorsRootRef?.children;
    const visitorCount = visitors ? visitors.length : 0;

    if (visitorCount !== this.lastVisitorCount) {
      this.lastVisitorCount = visitorCount;
      visitorCountChanged = true;
    }

    if (visitors && visitorCount > 0) {
      let checksum = 0;
      for (let i = 0; i < visitorCount; i++) {
        const v = visitors[i];
        const body = v.children[0];
        checksum +=
          v.position.x * 3.1 +
          v.position.z * 7.3 +
          v.rotation.y * 1.9 +
          v.scale.x * 5.7 +
          (body ? body.position.y * 11.3 : 0);
      }
      if (Math.abs(checksum - this.lastVisitorMotionChecksum) > 0.002) {
        this.lastVisitorMotionChecksum = checksum;
        visitorsMoving = true;
      }
    } else {
      this.lastVisitorMotionChecksum = 0;
    }

    if (visitorCountChanged) {
      this.dynamicShadowAccum = 0;
      this.markShadowsDirty();
      return;
    }

    const hasDynamicShadowMotion =
      visitorsMoving || this.bouncingEntries.length > 0 || this.bassPulseEntries.length > 0;

    if (hasDynamicShadowMotion) {
      this.dynamicShadowAccum += dt;
      if (this.dynamicShadowAccum >= DYNAMIC_SHADOW_INTERVAL) {
        this.dynamicShadowAccum = 0;
        this.markShadowsDirty();
      }
    } else {
      this.dynamicShadowAccum = 0;
    }
  }

  private startLoop(): void {
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.elapsedTime += dt;

      this.isoCamera.update(dt);
      this.updateWallTranslucency(dt, false);

      // Animate rotating light projections and warm lamp flicker
      if (this.activeLightRigs.length > 0) {
        const atmo = sampleAtmosphereCurve(this.currentTimeHour, this.sampledAtmoScratch);
        const todBoost = atmo.lightBoost;
        const poolBoost = atmo.poolBoost;
        for (let i = 0; i < this.activeLightRigs.length; i++) {
          const rig = this.activeLightRigs[i];
          if (rig.spinRig) {
            rig.spinRig.rotation.y += dt * rig.spinSpeed;
          }
          if (rig.flicker) {
            const wave =
              1 +
              0.12 * Math.sin(this.elapsedTime * 7.2 + rig.phase) +
              0.06 * Math.sin(this.elapsedTime * 13.7 + rig.phase * 1.9);
            for (let j = 0; j < rig.pointLights.length; j++) {
              const pl = rig.pointLights[j];
              pl.light.intensity = pl.baseIntensity * todBoost * wave;
            }
            if (rig.poolMat) {
              rig.poolMat.opacity = Math.min(0.68, rig.basePoolOpacity * poolBoost * wave);
            }
          }
        }
      }

      // Spin ALL SpinTarget descendants across pre-filtered spinner entries (axis + speed aware)
      for (let i = 0; i < this.spinnerEntries.length; i++) {
        const entry = this.spinnerEntries[i];
        if (!entry.item.active) continue;
        const targets = entry.spinTargets;
        for (let j = 0; j < targets.length; j++) {
          const target = targets[j];
          const speed = (target.userData.spinSpeed as number | undefined) ?? 1.8;
          const axis = (target.userData.spinAxis as 'x' | 'y' | 'z' | undefined) ?? 'y';
          if (axis === 'x') target.rotation.x += dt * speed;
          else if (axis === 'z') target.rotation.z += dt * speed;
          else target.rotation.y += dt * speed;
        }
      }

      // Animate subtle bass-thump pulse on active speakers / subwoofers
      if (this.bassPulseEntries.length > 0) {
        const pulse = 1 + 0.028 * Math.pow(Math.max(0, Math.sin(this.elapsedTime * 7.8)), 4);
        const pulseY = 1 + (pulse - 1) * 0.5;
        for (let i = 0; i < this.bassPulseEntries.length; i++) {
          const entry = this.bassPulseEntries[i];
          if (entry.bounceTime === 0) {
            entry.group.scale.set(pulse, pulseY, pulse);
          }
        }
      }

      // Animate active click-interaction bounces
      for (let i = this.bouncingEntries.length - 1; i >= 0; i--) {
        const entry = this.bouncingEntries[i];
        entry.bounceTime += dt;
        const duration = 0.24;
        if (entry.bounceTime >= duration) {
          entry.bounceTime = 0;
          entry.group.scale.set(1, 1, 1);
          entry.group.updateMatrix();
          if (!entry.isDynamicGroup) {
            entry.group.matrixAutoUpdate = false;
          }
          const last = this.bouncingEntries.pop()!;
          if (i < this.bouncingEntries.length) {
            this.bouncingEntries[i] = last;
          }
          this.markShadowsDirty();
        } else {
          const t = entry.bounceTime / duration;
          const s = 1 + Math.sin(t * Math.PI) * 0.06;
          const invSqrt = 1 / Math.sqrt(s);
          entry.group.scale.set(invSqrt, s, invSqrt);
        }
      }

      for (const hook of this.tickHooks) {
        hook(dt);
      }

      this.updateDynamicShadowSchedule(dt);
      this.renderer.render(this.scene, this.isoCamera.camera);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    this.clearDynamicLights();
    this.clearCeilingOverlay();
    this.clearInstancedFloorTiles();
    if (this.glowPoolTexture) {
      this.glowPoolTexture.dispose();
      this.glowPoolTexture = null;
    }
    if (this.beamGradientTexture) {
      this.beamGradientTexture.dispose();
      this.beamGradientTexture = null;
    }
    for (const entry of this.renderedItems.values()) {
      this.disposeGroup(entry.group);
    }
    this.renderedItems.clear();
    this.wallEntries = [];
    this.mountedEntries = [];
    this.spinnerEntries = [];
    this.bassPulseEntries = [];
    this.bouncingEntries = [];
    for (const outline of this.selectionOutlinePool) {
      outline.geometry.dispose();
      (outline.material as THREE.Material).dispose();
    }
    this.selectionOutlinePool = [];
    this.hoverOutline.geometry.dispose();
    (this.hoverOutline.material as THREE.Material).dispose();
    this.eraseHoverOutline.geometry.dispose();
    (this.eraseHoverOutline.material as THREE.Material).dispose();
    this._gridVisual.dispose();
    this.previewRenderer?.dispose();
    this.previewRenderer = null;
    this.assetLoader.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
