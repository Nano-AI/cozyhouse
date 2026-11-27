import * as THREE from 'three';
import type { AudioModule } from '../audio/AudioModule';
import type {
  DialogueData,
  FurnitureItemDef,
  HouseState,
  PlacedItem,
  VisitorDef,
  VisitorMood,
} from '../data/schemas';
import { DialogueEngine } from '../dialogue/DialogueEngine';
import {
  getEffectiveFootprint,
  tileToWorldCenter,
  wallEdgeToWorldTransform,
} from '../engine/GridSystem';
import type { SceneManager } from '../engine/SceneManager';
import type { HouseStore } from '../state/houseStore';
import { ArrivalTransportManager, type BiomeRoute } from './ArrivalTransport';
import {
  type GridCoord,
  type NavGrid,
  type WorldPoint,
  buildNavGrid,
  canStepBetween,
  computeReachableDistances,
  findGridPath,
  findNearestWalkableTile,
  inGridBounds,
  isTightCorridor,
  pickExitLocation,
  pickSpawnLocation,
  resolveItemApproach,
  resolveSafeMovement,
  tileCenterToWorld,
  tileIndex,
} from './Pathfinder';
import { resolveEmoteEmoji } from './SpeechBubble';
import { VisitorMesh, type VisitorPose, type VisitorVariantIndex } from './VisitorMesh';

export interface VisitorPersonaInfo {
  name: string;
  pronouns: string;
  trait: string;
}

interface VisitorDefWithPersonas extends VisitorDef {
  archetypeIcon?: string;
  personas?: VisitorPersonaInfo[];
}

export interface ActiveVisitorSnapshot {
  instanceId: string;
  visitorId: string;
  variantIndex?: number;
  name?: string;
  archetypeName?: string;
  pronouns?: string;
  personality?: string;
  color?: string;
  mood: VisitorMood;
  moodScore?: number;
  interests?: string[];
  matchedInterests?: string[];
  dislikes?: string[];
  matchedDislikes?: string[];
  thought?: string;
  activity?: string;
  lastLine?: string;
  lastEmote?: string;
  x: number;
  z: number;
}

type VisitorPhase =
  | 'arriving_transport'
  | 'entering'
  | 'walking'
  | 'mounting_seat'
  | 'using'
  | 'dismounting_seat'
  | 'idle'
  | 'leaving'
  | 'waiting_pickup';

interface LocalSeatSlot {
  x: number;
  z: number;
  seatY: number;
  /** Facing yaw in item-local space (0 = +Z front). */
  localYaw?: number;
}

interface SeatAnchor {
  wx: number;
  wy: number;
  wz: number;
  facingYaw: number;
  returnX: number;
  returnZ: number;
  itemUid: string;
  slotIndex: number;
}

interface RoomAffinity {
  likedScore: number;
  dislikedScore: number;
  netScore: number;
  hasSpecialtyMatch: boolean;
  matchedInterests: string[];
  missingInterests: string[];
  presentDislikedTags: string[];
}

interface ActiveVisitorRuntime {
  instanceId: string;
  def: VisitorDefWithPersonas;
  variantIndex: VisitorVariantIndex;
  persona: VisitorPersonaInfo;
  mesh: VisitorMesh;
  isAutonomous: boolean;
  mood: VisitorMood;
  moodScore: number;
  matchedInterests: string[];
  matchedDislikes: string[];
  thought: string;
  phase: VisitorPhase;
  pose: VisitorPose;
  activity: string;
  worldX: number;
  worldY: number;
  worldZ: number;
  velX: number;
  velZ: number;
  smoothVelX: number;
  smoothVelZ: number;
  rotY: number;
  targetYaw: number;
  currentTile: GridCoord;
  path: WorldPoint[];
  pathTiles: GridCoord[];
  exteriorPath: WorldPoint[];
  targetItemUid: string | null;
  targetTile: GridCoord | null;
  faceTarget: WorldPoint | null;
  seatAnchor: SeatAnchor | null;
  seatBlend: number;
  pendingRoute: BiomeRoute | null;
  departureRoute: BiomeRoute | null;
  useTimer: number;
  idleTimer: number;
  speechCooldown: number;
  hasSpokenInitial: boolean;
  interactionBoost: number;
  patienceRemaining: number;
  spawnPopTimer: number;
  leavingPopTimer: number;
  stuckExitTimer: number;
  blockedProgressTimer: number;
  replanCooldown: number;
  yieldTimer: number;
  lastWaypointDist: number;
  dismissedVoluntarily: boolean;
  lastLineId?: string;
  lastEmote?: string;
  lastTargetItemUid?: string;
}

const PERSONAL_SPACE = 0.78;
const AVOIDANCE_RADIUS = 1.08;
const MAX_SEPARATION_SPEED = 0.85;
const SPAWN_POP_DURATION = 0.28;
const LEAVE_POP_DURATION = 0.34;
const SEAT_MOUNT_DURATION = 0.32;
const SEAT_DISMOUNT_DURATION = 0.28;
const DOOR_TRIGGER_RADIUS = 1.3;
const DOOR_HOLD_SECONDS = 1.0;
const MAX_AUTONOMOUS_VISITORS = 4;

/**
 * Per-item local seat slots (before item.rotation; +Z is item front).
 */
const SEAT_SLOTS_BY_ITEM_ID: Record<string, LocalSeatSlot[]> = {
  sofa_plush: [
    { x: -0.45, z: 0.06, seatY: 0.44 },
    { x: 0.45, z: 0.06, seatY: 0.44 },
  ],
  sofa_sectional: [
    { x: -0.55, z: 0.12, seatY: 0.44 },
    { x: 0.25, z: 0.12, seatY: 0.44 },
    { x: 0.55, z: -0.45, seatY: 0.44, localYaw: -Math.PI / 2 },
  ],
  loveseat_tufted: [
    { x: -0.38, z: 0.05, seatY: 0.44 },
    { x: 0.38, z: 0.05, seatY: 0.44 },
  ],
  cafe_booth: [
    { x: -0.38, z: 0.05, seatY: 0.44 },
    { x: 0.38, z: 0.05, seatY: 0.44 },
  ],
  armchair_plush: [{ x: 0, z: 0.04, seatY: 0.44 }],
  dining_chair: [{ x: 0, z: 0.04, seatY: 0.44 }],
  chair_office: [{ x: 0, z: 0.04, seatY: 0.44 }],
  bar_stool: [{ x: 0, z: 0.0, seatY: 0.62 }],
  diner_stool: [{ x: 0, z: 0.0, seatY: 0.58 }],
  beanbag_puff: [{ x: 0, z: 0.0, seatY: 0.30 }],
  bed_cozy: [
    { x: -0.42, z: 0.25, seatY: 0.46 },
    { x: 0.42, z: 0.25, seatY: 0.46 },
  ],
  bed_canopy: [
    { x: -0.42, z: 0.25, seatY: 0.46 },
    { x: 0.42, z: 0.25, seatY: 0.46 },
  ],
  bed_daybed: [
    { x: -0.35, z: 0.25, seatY: 0.46 },
    { x: 0.35, z: 0.25, seatY: 0.46 },
  ],
};

const DISLIKE_EMOTES: Array<{ id: string; glyph: string; label: string; color: string }> = [
  { id: 'thumbsDown', glyph: '👎', label: 'Dislike', color: '#F4C3C2' },
  { id: 'unimpressed', glyph: '😒', label: 'Unimpressed', color: '#E5D4E8' },
  { id: 'grimace', glyph: '😖', label: 'Not my vibe', color: '#F5CDB6' },
];

const FALLBACK_PERSONAS: Record<string, [VisitorPersonaInfo, VisitorPersonaInfo, VisitorPersonaInfo]> = {
  bookworm: [
    { name: 'Maya', pronouns: 'she/her', trait: 'Collects annotated paperbacks and seeks out warm reading lamps.' },
    { name: 'Julian', pronouns: 'he/him', trait: 'Always carries a well-loved novel and a soft knit scarf.' },
    { name: 'Rowan', pronouns: 'they/them', trait: 'Finds pure bliss in quiet shelves, warm tea, and plush chairs.' },
  ],
  coffee_snob: [
    { name: 'Leo', pronouns: 'he/him', trait: 'Can identify a single-origin espresso roast from three rooms away.' },
    { name: 'Clara', pronouns: 'she/her', trait: 'Judges every space by its crema, pastries, and café seating.' },
    { name: 'Devon', pronouns: 'they/them', trait: 'Chases velvety oat lattes and minimalist café counter vibes.' },
  ],
  cat_person: [
    { name: 'Mina', pronouns: 'she/her', trait: 'Immediately befriends every cat and checks out the softest cushions.' },
    { name: 'Toby', pronouns: 'he/him', trait: 'Never walks past a cat tree without offering gentle chin scratches.' },
    { name: 'Avery', pronouns: 'they/them', trait: 'Dreams of running a sunlit cat lounge stocked with cozy toys.' },
  ],
  party_goer: [
    { name: 'Zara', pronouns: 'she/her', trait: 'Brings nonstop energy wherever there is a glowing beat and dance floor.' },
    { name: 'Nico', pronouns: 'he/him', trait: 'Lives for turntable drops, disco reflections, and upbeat basslines.' },
    { name: 'Kai', pronouns: 'they/them', trait: 'Chases neon lights, synth grooves, and midnight mocktails.' },
  ],
  plant_lover: [
    { name: 'Elena', pronouns: 'she/her', trait: 'Knows the Latin name of every fern and checks how the sunlight falls.' },
    { name: 'Mateo', pronouns: 'he/him', trait: 'Happiest around terracotta pots, bright picture windows, and vines.' },
    { name: 'Sage', pronouns: 'they/them', trait: 'Propagates clippings everywhere and admires trailing ceiling ivy.' },
  ],
  night_owl: [
    { name: 'Sora', pronouns: 'they/them', trait: 'Thrives under warm desk lamps, neon glow, and late-night beats.' },
    { name: 'Nadia', pronouns: 'she/her', trait: 'Loves midnight playlists, moody lighting, and quiet bar stools.' },
    { name: 'Ethan', pronouns: 'he/him', trait: 'Stays up sketching with lo-fi records and a strong evening brew.' },
  ],
  foodie: [
    { name: 'Chloe', pronouns: 'she/her', trait: 'Admires stocked pantries, warm stoves, and inviting dining tables.' },
    { name: 'Omar', pronouns: 'he/him', trait: 'Inspects every kitchen island and dreams up cozy tasting menus.' },
    { name: 'Jules', pronouns: 'they/them', trait: 'Loves retro diners, whistling kettles, and fresh-baked pastries.' },
  ],
  artist: [
    { name: 'Priya', pronouns: 'she/her', trait: 'Studies gallery walls, warm color palettes, and sculpted ceramics.' },
    { name: 'Theo', pronouns: 'he/him', trait: 'Draws inspiration from indie posters, sunlit mirrors, and lush foliage.' },
    { name: 'Quinn', pronouns: 'they/them', trait: 'Curates cozy textures, woven tapestries, and sculptural lamps.' },
  ],
  musician: [
    { name: 'Marcus', pronouns: 'he/him', trait: 'Flips through vinyl crates listening for warm analog crackle.' },
    { name: 'Yuki', pronouns: 'she/her', trait: 'Pairs mellow jazz records with soft lighting and warm coffee.' },
    { name: 'Alex', pronouns: 'they/them', trait: 'Collects rare pressings and loves a cozy listening lounge.' },
  ],
  homebody: [
    { name: 'Hannah', pronouns: 'she/her', trait: 'Ranks every sofa by nap potential and adores soft woven rugs.' },
    { name: 'Ben', pronouns: 'he/him', trait: 'Nothing beats a fluffy bed, a warm lamp, and a quiet afternoon in.' },
    { name: 'Sam', pronouns: 'they/them', trait: 'Collects squishy plushies and loves a calm, welcoming sanctuary.' },
  ],
};

const TAG_FRIENDLY_LABELS: Record<string, string> = {
  read: 'books',
  cozy: 'cozy touches',
  light: 'warm lighting',
  coffee: 'fresh coffee',
  cafe: 'café charm',
  serve: 'a serving counter',
  seating: 'comfy seating',
  drinks: 'drinks',
  cat: 'cats',
  pet: 'pet gear',
  plushie: 'plushies',
  party: 'party gear',
  music: 'music',
  nightlife: 'neon & nightlife',
  dance: 'a dance spot',
  plants: 'houseplants',
  window: 'bright windows',
  decor: 'decor',
  bar: 'bar seating',
  cook: 'cooking gear',
  kitchen: 'a kitchen setup',
  dining: 'dining space',
  food: 'tasty snacks',
  diner: 'diner vibes',
  art: 'wall art',
  home: 'homey comforts',
  sleep: 'beds',
};

let visitorSeq = 1;
function nextVisitorInstanceId(): string {
  visitorSeq += 1;
  return `vis_${Date.now().toString(36)}_${visitorSeq.toString(36)}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function shortestAngleDiff(current: number, target: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const alpha = 1 - Math.exp(-lambda * dt);
  return current + shortestAngleDiff(current, target) * alpha;
}

function estimateBlabberDuration(text: string, speedMultiplier = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const raw = 0.7 + words * 0.28;
  return Math.max(0.85, Math.min(2.15, raw / Math.max(0.65, speedMultiplier)));
}

function resolvePersona(def: VisitorDefWithPersonas, variantIndex: VisitorVariantIndex): VisitorPersonaInfo {
  const fromData = def.personas?.[variantIndex];
  if (fromData && fromData.name) {
    return fromData;
  }
  const fallback = FALLBACK_PERSONAS[def.id]?.[variantIndex];
  if (fallback) {
    return fallback;
  }
  const genericNames = ['Robin', 'Taylor', 'Morgan'];
  const genericPronouns = ['she/her', 'he/him', 'they/them'];
  return {
    name: genericNames[variantIndex % 3],
    pronouns: genericPronouns[variantIndex % 3],
    trait: def.description,
  };
}

function getSeatSlotsForItem(def: FurnitureItemDef): LocalSeatSlot[] | null {
  if (SEAT_SLOTS_BY_ITEM_ID[def.id]) {
    return SEAT_SLOTS_BY_ITEM_ID[def.id];
  }
  if (def.layer === 'floor' && def.subLayer === 'object' && def.tags.includes('seating') && !def.tags.includes('surface')) {
    return [{ x: 0, z: 0.04, seatY: 0.44 }];
  }
  return null;
}

/**
 * Manages invited & autonomous visitors:
 * - 30 gender-diverse stylized figurines (10 personalities × 3 variants) with 2-segment knee legs
 * - True seated mounting ON couches, chairs, bar stools, beanbags & beds (with multi-slot support)
 * - Automatic proximity front-door opening & closing (`sceneManager.setDoorVisitorOpen`) + latch audio
 * - Open/Closed autonomous guest arrival loop with likes & dislikes reactions (`👎` / `😒` / `😖`)
 * - Biome-specific arrival & departure transports (Suburbs car, Beach boat, City elevator, outdoor trails)
 */
export class VisitorModule {
  readonly store: HouseStore;
  readonly sceneManager: SceneManager;
  readonly visitorDefs: VisitorDef[];
  readonly dialogue: DialogueData;

  private readonly dialogueEngine: DialogueEngine;
  private readonly visitorsRoot = new THREE.Group();
  private readonly transport: ArrivalTransportManager;
  private audioModule: AudioModule | null;

  private navGrid: NavGrid;
  private currentBiome: string;
  private active: ActiveVisitorRuntime[] = [];
  private changeListeners = new Set<() => void>();
  private itemTriggerCooldowns = new Map<string, number>();
  private doorHoldTimers = new Map<string, number>();
  private variantCounters = new Map<string, number>();
  private unsubscribeHouse: () => void;
  private unsubscribeOpen: (() => void) | null = null;
  private spawnCounter = 0;
  private autonomousSpawnTimer = 2.5;

  constructor(
    store: HouseStore,
    sceneManager: SceneManager,
    audioModule?: AudioModule,
  ) {
    this.store = store;
    this.sceneManager = sceneManager;
    this.audioModule = audioModule ?? null;
    this.visitorDefs = store.data.visitors.visitors;
    this.dialogue = store.data.dialogue;
    this.dialogueEngine = new DialogueEngine(this.dialogue);

    this.visitorsRoot.name = 'VisitorsRoot';
    this.sceneManager.scene.add(this.visitorsRoot);

    const initialState = store.getState();
    this.currentBiome = initialState.sceneryViewId;
    this.navGrid = buildNavGrid(initialState, store.data);
    this.transport = new ArrivalTransportManager(this.sceneManager.scene);
    this.transport.syncEnvironment(
      initialState.sceneryViewId,
      initialState.gridWidth,
      initialState.gridDepth,
    );

    this.unsubscribeHouse = store.on('houseChanged', () => this.handleHouseChanged());

    // Subscribe to Open/Closed toggle on HouseStore (compatible with @catalog's houseOpenChanged event)
    const openableStore = store as unknown as {
      on?: (ev: string, fn: (payload: { open: boolean }) => void) => () => void;
    };
    if (typeof openableStore.on === 'function') {
      this.unsubscribeOpen = openableStore.on('houseOpenChanged', ({ open }) => {
        this.handleHouseOpenChanged(open);
      });
    }
  }

  private isHouseOpen(): boolean {
    const s = this.store as unknown as { isHouseOpen?: () => boolean };
    return typeof s.isHouseOpen === 'function' ? s.isHouseOpen() : true;
  }

  private setDoorVisitorOpenSafe(uid: string, open: boolean): void {
    const sm = this.sceneManager as unknown as {
      setDoorVisitorOpen?: (doorUid: string, isOpen: boolean) => void;
    };
    sm.setDoorVisitorOpen?.(uid, open);
  }

  setAudioModule(audio: AudioModule | null): void {
    this.audioModule = audio;
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  private nextVariantFor(visitorId: string): VisitorVariantIndex {
    const count = this.variantCounters.get(visitorId) ?? 0;
    this.variantCounters.set(visitorId, count + 1);
    return (count % 3) as VisitorVariantIndex;
  }

  private handleHouseOpenChanged(open: boolean): void {
    if (open) {
      this.autonomousSpawnTimer = Math.min(this.autonomousSpawnTimer, 2.2);
      return;
    }

    // House closed: stop spawning and gently nudge existing autonomous visitors home
    let changed = false;
    for (const v of this.active) {
      if (!v.isAutonomous) continue;
      if (v.phase === 'leaving' || v.phase === 'waiting_pickup') continue;
      v.dismissedVoluntarily = true;
      this.beginLeaving(v, 'House closed — heading home', true);
      v.thought = "Looks like they're closing up — see you next time!";
      changed = true;
    }
    if (changed) {
      this.emitChange();
    }
  }

  invite(visitorId: string): ActiveVisitorSnapshot | null {
    return this.spawnVisitorInternal(visitorId, false);
  }

  private spawnVisitorInternal(
    visitorId: string,
    isAutonomous: boolean,
  ): ActiveVisitorSnapshot | null {
    const def = this.store.data.visitorsById.get(visitorId) as VisitorDefWithPersonas | undefined;
    if (!def) return null;

    const state = this.store.getState();
    this.navGrid = buildNavGrid(state, this.store.data);
    this.transport.syncEnvironment(state.sceneryViewId, state.gridWidth, state.gridDepth);

    const slotIdx = this.spawnCounter++;
    const route = this.transport.computeRoute(slotIdx);
    const variantIndex = this.nextVariantFor(visitorId);
    const persona = resolvePersona(def, variantIndex);
    const mesh = new VisitorMesh(def, variantIndex);

    const usesDeferredVehicle = route.kind === 'car' || route.kind === 'boat' || route.kind === 'elevator';
    const startX = route.stopPoint.wx;
    const startZ = route.stopPoint.wz;

    mesh.root.position.set(startX, 0, startZ);
    mesh.setScalePop(0.05);
    mesh.root.visible = !usesDeferredVehicle;
    this.visitorsRoot.add(mesh.root);

    const affinity = this.evaluateRoomAffinity(def, state);
    const initialMood: VisitorMood =
      affinity.dislikedScore >= 2.0 && affinity.netScore < 1.5
        ? 'neutral'
        : affinity.netScore >= 2.4 && affinity.dislikedScore < 1.5
          ? 'happy'
          : 'neutral';
    const initialScore = this.computeMoodScore(
      initialMood,
      affinity.netScore,
      def.patienceSeconds,
      def.patienceSeconds,
      false,
      affinity.presentDislikedTags.length > 0,
    );

    const runtime: ActiveVisitorRuntime = {
      instanceId: nextVisitorInstanceId(),
      def,
      variantIndex,
      persona,
      mesh,
      isAutonomous,
      mood: initialMood,
      moodScore: initialScore,
      matchedInterests: affinity.matchedInterests,
      matchedDislikes: affinity.presentDislikedTags,
      thought: usesDeferredVehicle
        ? `${route.arrivalLabel} to visit!`
        : 'Walking up the path to check this place out!',
      phase: usesDeferredVehicle ? 'arriving_transport' : 'entering',
      pose: 'walk',
      activity: route.arrivalLabel,
      worldX: startX,
      worldY: 0,
      worldZ: startZ,
      velX: 0,
      velZ: 0,
      smoothVelX: 0,
      smoothVelZ: 0,
      rotY: 0,
      targetYaw: 0,
      currentTile: { ...route.lotEdgeTile },
      path: [],
      pathTiles: [],
      exteriorPath: [...route.approachWaypoints],
      targetItemUid: null,
      targetTile: null,
      faceTarget: null,
      seatAnchor: null,
      seatBlend: 0,
      pendingRoute: route,
      departureRoute: null,
      useTimer: 0,
      idleTimer: 0.35,
      speechCooldown: usesDeferredVehicle ? 2.4 : 1.5,
      hasSpokenInitial: false,
      interactionBoost: 0,
      patienceRemaining: def.patienceSeconds,
      spawnPopTimer: usesDeferredVehicle ? 0 : 0.001,
      leavingPopTimer: 0,
      stuckExitTimer: 0,
      blockedProgressTimer: 0,
      replanCooldown: 0,
      yieldTimer: 0,
      lastWaypointDist: Infinity,
      dismissedVoluntarily: false,
    };

    // Tag root and every descendant so Live Mode canvas raycasting cleanly identifies this visitor
    runtime.mesh.root.traverse((obj) => {
      obj.userData.visitorInstanceId = runtime.instanceId;
    });

    // Plan the interior route from lotEdgeTile cleanly through the front door!
    this.planDoorEntryPath(runtime, route.lotEdgeTile);

    if (runtime.exteriorPath.length > 0) {
      const nextPt = runtime.exteriorPath[0];
      runtime.rotY = Math.atan2(nextPt.wx - startX, nextPt.wz - startZ);
      runtime.targetYaw = runtime.rotY;
      mesh.root.rotation.y = runtime.rotY;
    }

    this.active.push(runtime);

    if (usesDeferredVehicle) {
      this.transport.dispatchArrival(route, () => {
        // Guard if visitor was dismissed or disposed while vehicle was driving in
        if (!this.active.includes(runtime)) return;
        if (runtime.phase !== 'arriving_transport') return;
        runtime.phase = 'entering';
        runtime.mesh.root.visible = true;
        runtime.spawnPopTimer = 0.001;
        runtime.activity = 'Walking to the door';
        runtime.thought = this.buildContextualThought(
          runtime,
          this.evaluateRoomAffinity(runtime.def, this.store.getState()),
        );
        this.emitChange();
      });
    } else {
      this.transport.dispatchArrival(route, () => {});
    }

    this.emitChange();
    return this.toSnapshot(runtime);
  }

  /**
   * Builds the grid path from the biome lot entry tile straight to & through the front door
   * so visitors walk naturally from the walkway/pier/elevator right through the placed door!
   */
  private planDoorEntryPath(v: ActiveVisitorRuntime, lotEntryTile: GridCoord): void {
    const state = this.store.getState();
    const safeEntry = this.navGrid.walkable[lotEntryTile.x]?.[lotEntryTile.z]
      ? lotEntryTile
      : findNearestWalkableTile(
          this.navGrid,
          lotEntryTile.x + 0.5 - state.gridWidth / 2,
          lotEntryTile.z + 0.5 - state.gridDepth / 2,
        );

    v.currentTile = safeEntry;

    // Find best reachable door to enter through
    const reachableFromEntry = computeReachableDistances(this.navGrid, safeEntry);
    let bestDoor = null;
    let bestDoorDist = Infinity;

    for (const door of this.navGrid.doors) {
      if (!inGridBounds(door.insideTile.x, door.insideTile.z, state.gridWidth, state.gridDepth)) continue;
      if (!this.navGrid.walkable[door.insideTile.x][door.insideTile.z]) continue;
      const inIdx = tileIndex(door.insideTile.x, door.insideTile.z, state.gridDepth);
      const d = reachableFromEntry.get(inIdx);
      if (d !== undefined && d < bestDoorDist) {
        bestDoorDist = d;
        bestDoor = door;
      }
    }

    if (bestDoor) {
      const pathTiles = findGridPath(this.navGrid, safeEntry, bestDoor.insideTile);
      if (pathTiles && pathTiles.length > 0) {
        v.pathTiles = pathTiles;
        v.targetTile = bestDoor.insideTile;
        v.path = pathTiles.map((t) =>
          tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
        );
        return;
      }
    }

    // Fallback when no door is reachable from lot edge: walk onto safeEntry (or door directly)
    const fallbackSpawn = pickSpawnLocation(this.navGrid, this.spawnCounter);
    if (fallbackSpawn.firstGoal) {
      const p = findGridPath(this.navGrid, safeEntry, fallbackSpawn.firstGoal);
      if (p && p.length > 0) {
        v.pathTiles = p;
        v.targetTile = fallbackSpawn.firstGoal;
        v.path = p.map((t) => tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth));
        return;
      }
    }

    v.pathTiles = [safeEntry];
    v.targetTile = safeEntry;
    v.path = [tileCenterToWorld(safeEntry.x, safeEntry.z, state.gridWidth, state.gridDepth)];
  }

  dismiss(instanceId: string): void {
    const visitor = this.active.find((v) => v.instanceId === instanceId);
    if (!visitor || visitor.phase === 'leaving' || visitor.phase === 'waiting_pickup') return;
    visitor.dismissedVoluntarily = true;
    this.beginLeaving(visitor, 'Headed home');
  }

  dismissAll(): void {
    let changed = false;
    for (const visitor of this.active) {
      if (visitor.phase !== 'leaving' && visitor.phase !== 'waiting_pickup') {
        visitor.dismissedVoluntarily = true;
        this.beginLeaving(visitor, 'Headed home', true);
        changed = true;
      }
    }
    if (changed) {
      this.emitChange();
    }
  }

  getActiveVisitors(): readonly ActiveVisitorSnapshot[] {
    return this.active.map((v) => this.toSnapshot(v));
  }

  getActiveVisitorById(instanceId: string): ActiveVisitorSnapshot | null {
    const v = this.active.find((entry) => entry.instanceId === instanceId);
    return v ? this.toSnapshot(v) : null;
  }

  getVisitorWorldPosition(instanceId: string): { x: number; y: number; z: number } | null {
    const v = this.active.find((entry) => entry.instanceId === instanceId);
    if (!v) return null;
    return {
      x: v.worldX,
      y: v.worldY,
      z: v.worldZ,
    };
  }

  private toSnapshot(v: ActiveVisitorRuntime): ActiveVisitorSnapshot {
    const state = this.store.getState();
    const gx = v.worldX + state.gridWidth / 2 - 0.5;
    const gz = v.worldZ + state.gridDepth / 2 - 0.5;
    return {
      instanceId: v.instanceId,
      visitorId: v.def.id,
      variantIndex: v.variantIndex,
      name: v.persona.name,
      archetypeName: v.def.name,
      pronouns: v.persona.pronouns,
      personality: v.persona.trait,
      color: v.def.color,
      mood: v.mood,
      moodScore: v.moodScore,
      interests: [...v.def.likedTags],
      matchedInterests: [...v.matchedInterests],
      dislikes: [...v.def.dislikedTags],
      matchedDislikes: [...v.matchedDislikes],
      thought: v.thought,
      activity: v.activity,
      lastLine: undefined,
      lastEmote: v.lastEmote,
      x: Number(gx.toFixed(2)),
      z: Number(gz.toFixed(2)),
    };
  }

  private getReservedTiles(excludeInstanceId: string): Set<number> {
    const reserved = new Set<number>();
    const depth = this.navGrid.depth;
    for (const other of this.active) {
      if (other.instanceId === excludeInstanceId) continue;
      if (other.phase === 'arriving_transport') continue;
      if (inGridBounds(other.currentTile.x, other.currentTile.z, this.navGrid.width, depth)) {
        reserved.add(tileIndex(other.currentTile.x, other.currentTile.z, depth));
      }
      if (
        other.targetTile &&
        inGridBounds(other.targetTile.x, other.targetTile.z, this.navGrid.width, depth)
      ) {
        reserved.add(tileIndex(other.targetTile.x, other.targetTile.z, depth));
      }
    }
    return reserved;
  }

  private getStationaryVisitorTiles(excludeInstanceId: string): Set<number> {
    const occupied = new Set<number>();
    const depth = this.navGrid.depth;
    for (const other of this.active) {
      if (other.instanceId === excludeInstanceId) continue;
      if (other.phase === 'using' || other.phase === 'idle') {
        // Visitors seated ON furniture don't block floor tiles!
        if (other.seatAnchor) continue;
        if (inGridBounds(other.currentTile.x, other.currentTile.z, this.navGrid.width, depth)) {
          occupied.add(tileIndex(other.currentTile.x, other.currentTile.z, depth));
        }
      }
    }
    return occupied;
  }

  private isSeatSlotTaken(itemUid: string, slotIndex: number, excludeInstanceId: string): boolean {
    for (const other of this.active) {
      if (other.instanceId === excludeInstanceId) continue;
      if (other.seatAnchor && other.seatAnchor.itemUid === itemUid && other.seatAnchor.slotIndex === slotIndex) {
        return true;
      }
    }
    return false;
  }

  /**
   * Computes world position & outward facing yaw for an available seat slot on a placed seating/bed item.
   */
  private resolveAvailableSeatAnchor(
    item: PlacedItem,
    def: FurnitureItemDef,
    returnX: number,
    returnZ: number,
    visitorInstanceId: string,
  ): SeatAnchor | null {
    const slots = getSeatSlotsForItem(def);
    if (!slots || slots.length === 0) return null;

    const state = this.store.getState();
    const eff = getEffectiveFootprint(def, item.rotation);
    const center = tileToWorldCenter(item.x, item.z, eff.w, eff.d, state.gridWidth, state.gridDepth);
    const rotY = -item.rotation * (Math.PI / 2);
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);

    // Pick the closest unoccupied seat slot to the visitor's approach point
    let bestAnchor: SeatAnchor | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < slots.length; i++) {
      if (this.isSeatSlotTaken(item.uid, i, visitorInstanceId)) continue;
      const slot = slots[i];
      const wx = center.wx + slot.x * cos + slot.z * sin;
      const wz = center.wz - slot.x * sin + slot.z * cos;
      const d = Math.hypot(wx - returnX, wz - returnZ);
      if (d < bestDist) {
        bestDist = d;
        bestAnchor = {
          wx,
          wy: item.y + slot.seatY,
          wz,
          facingYaw: rotY + (slot.localYaw ?? 0),
          returnX,
          returnZ,
          itemUid: item.uid,
          slotIndex: i,
        };
      }
    }

    return bestAnchor;
  }

  private computePathAvoidingVisitors(
    v: ActiveVisitorRuntime,
    goalTile: GridCoord,
    hardBlockOthers = false,
  ): GridCoord[] | null {
    const stationary = this.getStationaryVisitorTiles(v.instanceId);
    const reserved = this.getReservedTiles(v.instanceId);

    if (hardBlockOthers) {
      const hardPath = findGridPath(this.navGrid, v.currentTile, goalTile, {
        blockedTiles: reserved,
        penalizedTiles: reserved,
        penaltyCost: 8,
      });
      if (hardPath) return hardPath;
    }

    const cleanPath = findGridPath(this.navGrid, v.currentTile, goalTile, {
      blockedTiles: stationary,
      penalizedTiles: reserved,
      penaltyCost: 6,
    });
    if (cleanPath) return cleanPath;

    return findGridPath(this.navGrid, v.currentTile, goalTile, {
      penalizedTiles: reserved,
      penaltyCost: 8,
    });
  }

  /**
   * Hard safety clamp in `city` biome so NO visitor can ever walk past the rooftop
   * glass parapet into thin air (allows only the North elevator landing corridor while arriving/leaving).
   */
  private clampToCityTerrace(v: ActiveVisitorRuntime, state: HouseState): void {
    if (state.sceneryViewId !== 'city' || v.seatAnchor) return;

    const halfW = state.gridWidth / 2;
    const halfD = state.gridDepth / 2;
    const maxX = Math.max(0.5, halfW - 0.15);
    const maxZ = Math.max(0.5, halfD - 0.15);
    const minTerraceZ = -maxZ;

    const inElevatorTransit =
      v.phase === 'entering' ||
      v.phase === 'leaving' ||
      v.phase === 'waiting_pickup' ||
      v.phase === 'arriving_transport';

    if (inElevatorTransit && v.worldZ < minTerraceZ && Math.abs(v.worldX) <= 0.65) {
      v.worldX = Math.max(-0.58, Math.min(0.58, v.worldX));
      v.worldZ = Math.max(-(halfD + 0.95), v.worldZ);
    } else {
      v.worldX = Math.max(-maxX, Math.min(maxX, v.worldX));
      v.worldZ = Math.max(minTerraceZ, Math.min(maxZ, v.worldZ));
    }
    v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
  }

  private handleHouseChanged(): void {
    const state = this.store.getState();
    this.navGrid = buildNavGrid(state, this.store.data);
    const biomeChanged = state.sceneryViewId !== this.currentBiome;
    this.currentBiome = state.sceneryViewId;
    this.transport.syncEnvironment(state.sceneryViewId, state.gridWidth, state.gridDepth);

    const halfW = state.gridWidth / 2;
    const halfD = state.gridDepth / 2;
    const freshRoute = biomeChanged ? this.transport.computeRoute(0) : null;
    const toRemoveOnSwitch: ActiveVisitorRuntime[] = [];

    let changed = false;
    let relocateSlot = 0;

    for (const v of this.active) {
      // On biome switch (e.g. Beach -> City), cleanly resolve every in-transit or exterior visitor!
      if (biomeChanged && freshRoute) {
        if (v.phase === 'leaving' || v.phase === 'waiting_pickup') {
          // Already departed behind the biome transition clouds — cleanly despawn!
          toRemoveOnSwitch.push(v);
          changed = true;
          continue;
        }

        const outsideLot =
          Math.abs(v.worldX) > halfW - 0.35 || Math.abs(v.worldZ) > halfD - 0.35;
        const hasExteriorWaypoints =
          v.exteriorPath.length > 0 ||
          v.path.some(
            (pt) => Math.abs(pt.wx) > halfW - 0.1 || Math.abs(pt.wz) > halfD - 0.1,
          );

        if (v.phase === 'arriving_transport' || outsideLot || hasExteriorWaypoints) {
          // Relocate cleanly onto a valid walkable tile inside the new biome's lot entry!
          const entryWorld = tileCenterToWorld(
            freshRoute.lotEdgeTile.x,
            freshRoute.lotEdgeTile.z,
            state.gridWidth,
            state.gridDepth,
          );
          const jitterX = ((relocateSlot % 3) - 1) * 0.6;
          relocateSlot += 1;
          const safeTile = findNearestWalkableTile(
            this.navGrid,
            entryWorld.wx + jitterX,
            entryWorld.wz,
          );
          const safeWorld = tileCenterToWorld(
            safeTile.x,
            safeTile.z,
            state.gridWidth,
            state.gridDepth,
          );

          v.exteriorPath = [];
          v.path = [];
          v.pathTiles = [];
          v.pendingRoute = null;
          v.departureRoute = null;
          v.seatAnchor = null;
          v.seatBlend = 0;
          v.currentTile = safeTile;
          v.worldX = safeWorld.wx;
          v.worldY = 0;
          v.worldZ = safeWorld.wz;
          v.mesh.root.visible = true;
          v.mesh.root.position.set(v.worldX, 0, v.worldZ);
          if (v.phase === 'arriving_transport') {
            v.spawnPopTimer = 0.001;
          } else {
            v.mesh.setScalePop(1);
          }

          v.phase = 'entering';
          v.pose = 'walk';
          v.activity = 'Walking to the door';
          this.planDoorEntryPath(v, safeTile);
          this.clampToCityTerrace(v, state);
          changed = true;
          continue;
        }
      }

      if (v.phase === 'arriving_transport') {
        const nextRoute = this.transport.computeRoute(this.spawnCounter);
        v.pendingRoute = nextRoute;
        v.exteriorPath = [...nextRoute.approachWaypoints];
        this.planDoorEntryPath(v, nextRoute.lotEdgeTile);
        continue;
      }

      // If seated on an item that was deleted or moved, safely stand back up on nearest walkable tile!
      if (v.seatAnchor) {
        const seatItem = this.store.getItem(v.seatAnchor.itemUid);
        const seatDef = seatItem ? this.store.data.itemsById.get(seatItem.itemId) : undefined;
        let stillValid = false;
        if (seatItem && seatDef) {
          const eff = getEffectiveFootprint(seatDef, seatItem.rotation);
          const center = tileToWorldCenter(seatItem.x, seatItem.z, eff.w, eff.d, state.gridWidth, state.gridDepth);
          const slots = getSeatSlotsForItem(seatDef);
          const slot = slots?.[v.seatAnchor.slotIndex];
          if (slot) {
            const rotY = -seatItem.rotation * (Math.PI / 2);
            const expectedWx = center.wx + slot.x * Math.cos(rotY) + slot.z * Math.sin(rotY);
            const expectedWz = center.wz - slot.x * Math.sin(rotY) + slot.z * Math.cos(rotY);
            stillValid = Math.hypot(expectedWx - v.seatAnchor.wx, expectedWz - v.seatAnchor.wz) < 0.08;
          }
        }
        if (!stillValid) {
          const safeTile = findNearestWalkableTile(this.navGrid, v.seatAnchor.returnX, v.seatAnchor.returnZ);
          const safeWorld = tileCenterToWorld(safeTile.x, safeTile.z, state.gridWidth, state.gridDepth);
          v.seatAnchor = null;
          v.seatBlend = 0;
          v.worldX = safeWorld.wx;
          v.worldY = 0;
          v.worldZ = safeWorld.wz;
          v.currentTile = safeTile;
          v.mesh.root.position.set(v.worldX, 0, v.worldZ);
          v.targetItemUid = null;
          v.phase = 'idle';
          v.pose = 'idle';
          v.idleTimer = 0.25;
          v.activity = 'Looking around';
          changed = true;
        }
      }

      // Only nudge non-seated visitors that are inside the lot and stranded on a blocked tile
      const isOnExteriorTrail =
        (v.phase === 'entering' && v.exteriorPath.length > 0) ||
        (v.phase === 'leaving' && v.path.length === 0 && v.exteriorPath.length > 0) ||
        v.phase === 'waiting_pickup';

      if (
        !v.seatAnchor &&
        !isOnExteriorTrail &&
        (!inGridBounds(v.currentTile.x, v.currentTile.z, state.gridWidth, state.gridDepth) ||
          !this.navGrid.walkable[v.currentTile.x][v.currentTile.z])
      ) {
        const safeTile = findNearestWalkableTile(this.navGrid, v.worldX, v.worldZ);
        const safeWorld = tileCenterToWorld(safeTile.x, safeTile.z, state.gridWidth, state.gridDepth);
        v.currentTile = safeTile;
        v.worldX = safeWorld.wx;
        v.worldY = 0;
        v.worldZ = safeWorld.wz;
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
      }

      if (v.phase === 'leaving') {
        this.replanExitPath(v);
        continue;
      }

      if (v.targetItemUid && !this.store.getItem(v.targetItemUid)) {
        v.targetItemUid = null;
        if (v.phase === 'using') {
          v.phase = 'idle';
          v.pose = 'idle';
          v.idleTimer = 0.3;
          v.activity = 'Looking around';
          changed = true;
        }
      }

      if ((v.phase === 'walking' || v.phase === 'entering') && v.pathTiles.length > 0) {
        const goalTile = v.pathTiles[v.pathTiles.length - 1];
        const newPath = this.computePathAvoidingVisitors(v, goalTile);
        if (!newPath) {
          v.path = [];
          v.pathTiles = [];
          v.targetItemUid = null;
          v.targetTile = null;
          if (v.phase === 'walking') {
            v.phase = 'idle';
            v.pose = 'idle';
            v.idleTimer = 0.25;
            v.activity = 'Looking around';
            changed = true;
          }
        } else {
          v.pathTiles = newPath;
          v.path = newPath.map((t) =>
            tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
          );
        }
      }

      this.clampToCityTerrace(v, state);

      if (this.updateVisitorMood(v, 0, true)) {
        changed = true;
      }
    }

    if (toRemoveOnSwitch.length > 0) {
      const remIds = new Set(toRemoveOnSwitch.map((r) => r.instanceId));
      for (const rem of toRemoveOnSwitch) {
        this.visitorsRoot.remove(rem.mesh.root);
        rem.mesh.dispose();
      }
      this.active = this.active.filter((v) => !remIds.has(v.instanceId));
    }

    if (changed) {
      this.emitChange();
    }
  }

  private evaluateRoomAffinity(def: VisitorDef, state: HouseState): RoomAffinity {
    let likedScore = 0;
    let dislikedScore = 0;
    let hasSpecialtyMatch = false;
    const presentTags = new Set<string>();

    for (const item of state.items) {
      const itemDef = this.store.data.itemsById.get(item.itemId);
      if (!itemDef) continue;

      for (const tag of itemDef.tags) {
        presentTags.add(tag);
      }

      let itemLiked = 0;
      for (let i = 0; i < def.likedTags.length; i++) {
        const tag = def.likedTags[i];
        if (itemDef.tags.includes(tag)) {
          const weight = i === 0 ? 1.8 : i === 1 ? 1.4 : 0.9;
          itemLiked = itemLiked === 0 ? weight : itemLiked + weight * 0.35;
          if (i <= 1) hasSpecialtyMatch = true;
        }
      }
      likedScore += Math.min(2.4, itemLiked);

      let itemDisliked = false;
      for (const badTag of def.dislikedTags) {
        if (itemDef.tags.includes(badTag)) {
          itemDisliked = true;
          break;
        }
      }
      if (itemDisliked) {
        dislikedScore += 2.2;
      }
    }

    const matchedInterests = def.likedTags.filter((t) => presentTags.has(t));
    const missingInterests = def.likedTags.filter((t) => !presentTags.has(t));
    const presentDislikedTags = def.dislikedTags.filter((t) => presentTags.has(t));

    return {
      likedScore,
      dislikedScore,
      netScore: likedScore - dislikedScore,
      hasSpecialtyMatch,
      matchedInterests,
      missingInterests,
      presentDislikedTags,
    };
  }

  private computeMoodScore(
    mood: VisitorMood,
    effectiveScore: number,
    patienceRemaining: number,
    patienceTotal: number,
    dismissedVoluntarily: boolean,
    hasDislikes: boolean,
  ): number {
    switch (mood) {
      case 'leaving':
        return dismissedVoluntarily ? 22 : 5;
      case 'bored': {
        const ratio = patienceTotal > 0 ? clamp01(patienceRemaining / patienceTotal) : 0;
        const cap = hasDislikes ? 18 : 24;
        return Math.round(8 + ratio * cap);
      }
      case 'neutral':
        return Math.round(38 + clamp01((effectiveScore - 0.8) / 1.6) * 18);
      case 'happy':
        return Math.round(60 + clamp01((effectiveScore - 2.4) / 3.1) * 22);
      case 'delighted':
        return Math.round(86 + clamp01((effectiveScore - 5.5) / 4.2) * 14);
    }
  }

  private buildContextualThought(
    v: ActiveVisitorRuntime,
    affinity: RoomAffinity,
    activeItemDef?: FurnitureItemDef,
  ): string {
    if (v.phase === 'leaving' || v.phase === 'waiting_pickup' || v.mood === 'leaving') {
      if (v.dismissedVoluntarily) {
        return 'Had a lovely visit — waving goodbye for now!';
      }
      if (affinity.presentDislikedTags.length > 0) {
        const badTag = affinity.presentDislikedTags[0];
        if (badTag === 'party') return 'Too noisy for my taste — heading home!';
        if (badTag === 'sleep') return 'Way too sleepy in here — finding somewhere livelier!';
        const bad = TAG_FRIENDLY_LABELS[badTag] ?? badTag;
        return `Needs fewer ${bad} — not really my vibe here.`;
      }
      const wanted = affinity.missingInterests[0];
      if (wanted) {
        const label = TAG_FRIENDLY_LABELS[wanted] ?? wanted;
        return `Couldn't find any ${label} — heading home for now.`;
      }
      return 'Getting a little sleepy, heading home now.';
    }

    if ((v.phase === 'using' || v.phase === 'mounting_seat') && activeItemDef) {
      const tags = activeItemDef.tags;
      const name = activeItemDef.name;
      const dislikedHit = v.def.dislikedTags.find((t) => tags.includes(t));
      if (dislikedHit) {
        if (dislikedHit === 'party') return `Ugh, this ${name} is way too loud for me…`;
        if (dislikedHit === 'sleep') return `A ${name}? I came to party, not nap!`;
        return `Not really vibing with this ${name}…`;
      }
      if (tags.includes('cat') || tags.includes('pet')) {
        return `Best day ever — hanging out with the ${name}!`;
      }
      if (tags.includes('party') || tags.includes('music') || tags.includes('dance')) {
        return `Vibing to the rhythm near the ${name}!`;
      }
      if (tags.includes('coffee') || tags.includes('cafe') || tags.includes('serve')) {
        return `Savoring the warm aroma by the ${name}!`;
      }
      if (tags.includes('read')) {
        return `So cozy — I could browse the ${name} for hours.`;
      }
      if (tags.includes('plants')) {
        return `Admiring how lush the ${name} looks in here!`;
      }
      if (tags.includes('cook') || tags.includes('kitchen') || tags.includes('dining') || tags.includes('food')) {
        return `Checking out the ${name} — makes me want to cook!`;
      }
      if (tags.includes('art')) {
        return `Really love the palette and detail on this ${name}.`;
      }
      if (tags.includes('window')) {
        return 'Taking a calm moment to enjoy the window view.';
      }
      if (tags.includes('seating') || tags.includes('sleep') || tags.includes('plushie')) {
        return `Settling right onto this ${name} — super comfy!`;
      }
      return `Checking out the ${name} — nice touch!`;
    }

    if (v.mood === 'bored') {
      if (affinity.presentDislikedTags.length > 0) {
        const badTag = affinity.presentDislikedTags[0];
        if (badTag === 'party') return 'Too noisy for my taste… not really my vibe here.';
        if (badTag === 'sleep') return 'Too sleepy in here — needs way more energy!';
        const bad = TAG_FRIENDLY_LABELS[badTag] ?? badTag;
        return `Needs fewer ${bad} — not really my vibe here…`;
      }
      const wanted = affinity.missingInterests[0];
      if (wanted) {
        const label = TAG_FRIENDLY_LABELS[wanted] ?? wanted;
        return `Hmm, wish there were some ${label} around here.`;
      }
      return 'Wishing there was a bit more to explore in here.';
    }

    const favMatched = affinity.matchedInterests[0];
    const favLabel = favMatched ? (TAG_FRIENDLY_LABELS[favMatched] ?? favMatched) : 'cozy vibe';

    if (v.mood === 'delighted') {
      return `Obsessed with this space — loving the ${favLabel} here!`;
    }
    if (v.mood === 'happy') {
      return `Really enjoying the ${favLabel} and warm atmosphere!`;
    }
    if (v.phase === 'entering' || v.phase === 'arriving_transport') {
      return 'Just arriving — excited to see what this place is like!';
    }
    return 'Looking around and taking in the room details…';
  }

  private updateVisitorMood(
    v: ActiveVisitorRuntime,
    dt: number,
    suppressSpeak = false,
  ): boolean {
    if (v.phase === 'leaving' || v.phase === 'waiting_pickup' || v.phase === 'arriving_transport') {
      return false;
    }

    const state = this.store.getState();
    const affinity = this.evaluateRoomAffinity(v.def, state);

    if (dt > 0 && v.interactionBoost > 0) {
      v.interactionBoost = Math.max(0, v.interactionBoost - dt * 0.08);
    }

    const effectiveScore = affinity.netScore + v.interactionBoost;

    let targetMood: VisitorMood;
    if (affinity.dislikedScore >= 2.0 && affinity.netScore < 1.5) {
      targetMood = 'bored';
    } else if (effectiveScore >= 5.5 && affinity.hasSpecialtyMatch) {
      targetMood = 'delighted';
    } else if (effectiveScore >= 2.4) {
      targetMood = 'happy';
    } else if (effectiveScore >= 0.8) {
      targetMood = 'neutral';
    } else {
      targetMood = 'bored';
    }

    if (targetMood === 'bored' && !v.hasSpokenInitial && v.phase === 'entering') {
      targetMood = 'neutral';
    }

    let stateChanged = false;
    const prevMood = v.mood;
    const prevMatchedKey = v.matchedInterests.join(',');
    const nextMatchedKey = affinity.matchedInterests.join(',');
    const prevDislikedKey = v.matchedDislikes.join(',');
    const nextDislikedKey = affinity.presentDislikedTags.join(',');

    if (prevMatchedKey !== nextMatchedKey || prevDislikedKey !== nextDislikedKey) {
      v.matchedInterests = affinity.matchedInterests;
      v.matchedDislikes = affinity.presentDislikedTags;
      stateChanged = true;
    }

    if (targetMood !== prevMood) {
      v.mood = targetMood;
      stateChanged = true;
      if (!suppressSpeak && v.hasSpokenInitial && (targetMood === 'delighted' || targetMood === 'bored')) {
        this.speak(v, targetMood === 'bored' && affinity.presentDislikedTags.length > 0);
      }
    }

    if (v.mood === 'bored') {
      // Mismatched / disliked rooms visibly drain patience faster so visitors express dislike & depart
      const drainScale =
        affinity.dislikedScore > 0 ? 3.8 : affinity.likedScore === 0 ? 2.8 : 1.3;
      v.patienceRemaining = Math.max(0, v.patienceRemaining - dt * drainScale);
      if (v.patienceRemaining <= 0) {
        const leaveLabel =
          affinity.presentDislikedTags.length > 0
            ? 'Not their vibe — heading out'
            : 'Bored — heading home';
        this.beginLeaving(v, leaveLabel);
        return true;
      }
    } else {
      v.patienceRemaining = Math.min(
        v.def.patienceSeconds,
        v.patienceRemaining + dt * 1.5,
      );
    }

    const nextScore = this.computeMoodScore(
      v.mood,
      effectiveScore,
      v.patienceRemaining,
      v.def.patienceSeconds,
      v.dismissedVoluntarily,
      affinity.presentDislikedTags.length > 0,
    );
    if (Math.abs(nextScore - v.moodScore) >= 4 || targetMood !== prevMood) {
      v.moodScore = nextScore;
      stateChanged = true;
    }

    if (targetMood !== prevMood || prevMatchedKey !== nextMatchedKey || prevDislikedKey !== nextDislikedKey) {
      const activeItem = v.targetItemUid ? this.store.getItem(v.targetItemUid) : undefined;
      const activeDef = activeItem ? this.store.data.itemsById.get(activeItem.itemId) : undefined;
      v.thought = this.buildContextualThought(v, affinity, activeDef);
    }

    return stateChanged;
  }

  private beginLeaving(
    v: ActiveVisitorRuntime,
    activityLabel: string,
    quietEmit = false,
  ): void {
    if (v.phase === 'leaving' || v.phase === 'waiting_pickup') return;

    // If still riding in on arrival vehicle, remove immediately
    if (v.phase === 'arriving_transport') {
      v.phase = 'leaving';
      v.mood = 'leaving';
      v.leavingPopTimer = LEAVE_POP_DURATION;
      if (!quietEmit) this.emitChange();
      return;
    }

    // If currently sitting ON a couch/chair, snap smoothly down to return tile first
    if (v.seatAnchor) {
      v.worldX = v.seatAnchor.returnX;
      v.worldY = 0;
      v.worldZ = v.seatAnchor.returnZ;
      v.seatAnchor = null;
      v.seatBlend = 0;
      v.mesh.root.position.set(v.worldX, 0, v.worldZ);
    }

    const affinity = this.evaluateRoomAffinity(v.def, this.store.getState());
    v.phase = 'leaving';
    v.mood = 'leaving';
    v.moodScore = v.dismissedVoluntarily ? 22 : 5;
    v.pose = 'walk';
    v.activity = activityLabel;
    v.thought = this.buildContextualThought(v, affinity);
    v.targetItemUid = null;
    v.targetTile = null;
    v.stuckExitTimer = 0;
    v.leavingPopTimer = 0;
    v.blockedProgressTimer = 0;

    const showDislikeEmote = !v.dismissedVoluntarily && affinity.presentDislikedTags.length > 0;
    this.speak(v, showDislikeEmote);
    this.replanExitPath(v);

    if (!quietEmit) {
      this.emitChange();
    }
  }

  /**
   * Routes leaving visitors cleanly out through the nearest reachable placed door,
   * across the yard to the biome exit edge, and along the exterior exit route to their ride/trail!
   */
  private replanExitPath(v: ActiveVisitorRuntime): void {
    const state = this.store.getState();
    const depRoute = this.transport.computeRoute(this.spawnCounter++);
    v.departureRoute = depRoute;

    const safeLotExit = this.navGrid.walkable[depRoute.lotEdgeTile.x]?.[depRoute.lotEdgeTile.z]
      ? depRoute.lotEdgeTile
      : findNearestWalkableTile(
          this.navGrid,
          depRoute.lotEdgeTile.x + 0.5 - state.gridWidth / 2,
          depRoute.lotEdgeTile.z + 0.5 - state.gridDepth / 2,
        );

    // Path directly to safeLotExit (which naturally routes THROUGH any openable door if indoors!)
    const directToExit = this.computePathAvoidingVisitors(v, safeLotExit);
    if (directToExit && directToExit.length > 0) {
      v.pathTiles = directToExit;
      v.targetTile = safeLotExit;
      v.path = directToExit.map((t) =>
        tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
      );
      v.exteriorPath = [...depRoute.exitWaypoints];
      return;
    }

    // Fallback: route to nearest door/perimeter exit
    const exit = pickExitLocation(this.navGrid, v.currentTile);
    const gridPath = this.computePathAvoidingVisitors(v, exit.exitTile);
    if (gridPath) {
      v.pathTiles = gridPath;
      v.targetTile = exit.exitTile;
      v.path = gridPath.map((t) =>
        tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
      );
      v.exteriorPath = [exit.exitWorld, ...depRoute.exitWaypoints];
    } else {
      v.pathTiles = [];
      v.path = [exit.exitWorld];
      v.exteriorPath = [...depRoute.exitWaypoints];
    }
  }

  /**
   * Emits an emoji-only 3D emotion bubble with animated blabbering soundwave and plays
   * the cozy synthesized gibberish voice using the hand-written dialogue line cadence.
   */
  private speak(v: ActiveVisitorRuntime, forceDislike = false): void {
    const line = this.dialogueEngine.pickLine(v.def.id, v.mood, v.lastLineId);
    const emote = forceDislike
      ? DISLIKE_EMOTES[Math.floor(Math.random() * DISLIKE_EMOTES.length)]
      : this.dialogueEngine.getEmoteVisual(line.emote);
    const emoji = resolveEmoteEmoji(emote.id, emote.glyph, v.mood);
    const blabberDuration = estimateBlabberDuration(line.text, line.speedMultiplier);

    v.lastLineId = line.id;
    v.lastEmote = emoji;
    v.speechCooldown = 7.5 + Math.random() * 3.5;

    v.mesh.speechBubble.showEmote(emote, v.mood, 4.0, blabberDuration);
    this.audioModule?.playGibberishLine(
      line.text,
      v.def.voiceProfile,
      forceDislike ? Math.min(0.84, line.pitchOffset) : line.pitchOffset,
      line.speedMultiplier,
    );
  }

  private pickNextDestination(v: ActiveVisitorRuntime): void {
    const state = this.store.getState();
    const reachable = computeReachableDistances(this.navGrid, v.currentTile);
    const reservedTiles = this.getReservedTiles(v.instanceId);

    interface Candidate {
      item: PlacedItem;
      def: FurnitureItemDef;
      tile: GridCoord;
      faceWorld: WorldPoint;
      score: number;
    }

    const candidates: Candidate[] = [];

    for (const item of state.items) {
      const def = this.store.data.itemsById.get(item.itemId);
      if (!def) continue;
      if (
        def.subLayer === 'tile' ||
        (def.layer === 'wall' && def.wallKind === 'structure' && !def.tags.includes('window'))
      ) {
        continue;
      }

      // If it's a seating item, skip if ALL seat slots are already occupied
      const seatSlots = getSeatSlotsForItem(def);
      if (seatSlots) {
        let anyFree = false;
        for (let s = 0; s < seatSlots.length; s++) {
          if (!this.isSeatSlotTaken(item.uid, s, v.instanceId)) {
            anyFree = true;
            break;
          }
        }
        if (!anyFree) continue;
      }

      let tagMatch = 0;
      for (let i = 0; i < v.def.likedTags.length; i++) {
        if (def.tags.includes(v.def.likedTags[i])) {
          tagMatch += i <= 1 ? 3.2 : 1.8;
        }
      }

      // Occasionally inspect a disliked item to visibly react with 👎 / 😒!
      const isDislikedItem = v.def.dislikedTags.some((t) => def.tags.includes(t));

      const interactionSpec = this.classifyInteraction(v.def, def);
      if (tagMatch === 0 && !isDislikedItem && !interactionSpec.isGenerallyInteresting) continue;

      const approach = resolveItemApproach(
        this.navGrid,
        state,
        this.store.data,
        item,
        def,
        reachable,
        reservedTiles,
      );
      if (!approach) continue;

      const dist = reachable.get(tileIndex(approach.tile.x, approach.tile.z, state.gridDepth)) ?? 10;
      const repeatPenalty = item.uid === v.lastTargetItemUid ? -3.5 : 0;
      // Allow multiple visitors to share a multi-seat sofa cleanly!
      const isMultiSeat = seatSlots && seatSlots.length > 1;
      const occupiedPenalty =
        !isMultiSeat &&
        this.active.some(
          (other) => other.instanceId !== v.instanceId && other.targetItemUid === item.uid,
        )
          ? -2.8
          : 0;

      const score =
        tagMatch +
        (isDislikedItem && tagMatch === 0 ? 1.6 : 0) +
        interactionSpec.priorityBonus +
        repeatPenalty +
        occupiedPenalty -
        dist * 0.18 +
        Math.random() * 1.4;

      candidates.push({
        item,
        def,
        tile: approach.tile,
        faceWorld: approach.faceWorld,
        score,
      });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const topPool = candidates.slice(0, Math.min(3, candidates.length));
      const chosen = topPool[Math.floor(Math.random() * topPool.length)];
      const pathTiles = this.computePathAvoidingVisitors(v, chosen.tile);

      if (pathTiles) {
        v.phase = 'walking';
        v.pose = 'walk';
        v.targetItemUid = chosen.item.uid;
        v.lastTargetItemUid = chosen.item.uid;
        v.targetTile = chosen.tile;
        v.faceTarget = chosen.faceWorld;
        v.pathTiles = pathTiles;
        v.path = pathTiles.map((t) =>
          tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
        );
        v.blockedProgressTimer = 0;
        v.lastWaypointDist = Infinity;
        v.activity = `Heading to ${chosen.def.name}`;
        v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state));
        this.emitChange();
        return;
      }
    }

    const reachableTiles: GridCoord[] = [];
    for (const idx of reachable.keys()) {
      if (reservedTiles.has(idx)) continue;
      const tx = Math.floor(idx / state.gridDepth);
      const tz = idx % state.gridDepth;
      if (tx !== v.currentTile.x || tz !== v.currentTile.z) {
        reachableTiles.push({ x: tx, z: tz });
      }
    }

    if (reachableTiles.length > 0) {
      const dest = reachableTiles[Math.floor(Math.random() * reachableTiles.length)];
      const pathTiles = this.computePathAvoidingVisitors(v, dest);
      if (pathTiles && pathTiles.length > 0) {
        v.phase = 'walking';
        v.pose = 'walk';
        v.targetItemUid = null;
        v.targetTile = dest;
        v.faceTarget = null;
        v.pathTiles = pathTiles;
        v.path = pathTiles.map((t) =>
          tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
        );
        v.blockedProgressTimer = 0;
        v.lastWaypointDist = Infinity;
        v.activity = 'Wandering around';
        v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state));
        this.emitChange();
        return;
      }
    }

    v.phase = 'idle';
    v.pose = 'idle';
    v.targetTile = null;
    v.idleTimer = 1.8 + Math.random() * 1.4;
    v.activity = 'Looking around';
    v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state));
    this.emitChange();
  }

  private classifyInteraction(
    visitorDef: VisitorDef,
    itemDef: FurnitureItemDef,
  ): {
    pose: VisitorPose;
    activity: string;
    priorityBonus: number;
    isGenerallyInteresting: boolean;
  } {
    const tags = itemDef.tags;
    const prefs = visitorDef.preferredInteractions;

    if (tags.includes('cat') || tags.includes('pet')) {
      return {
        pose: 'pet',
        activity: `Petting ${itemDef.name}`,
        priorityBonus: prefs.includes('pet_cat') ? 2.5 : 1.0,
        isGenerallyInteresting: true,
      };
    }
    if (tags.includes('party') || tags.includes('music') || tags.includes('dance')) {
      return {
        pose: 'dance',
        activity: `Dancing near ${itemDef.name}`,
        priorityBonus: prefs.includes('dance') ? 2.4 : 0.6,
        isGenerallyInteresting: true,
      };
    }
    if (getSeatSlotsForItem(itemDef)) {
      const isBed = tags.includes('sleep');
      return {
        pose: 'sit',
        activity: isBed ? `Relaxing on ${itemDef.name}` : `Sitting on ${itemDef.name}`,
        priorityBonus: prefs.includes('sit') ? 1.8 : 0.85,
        isGenerallyInteresting: true,
      };
    }
    if (tags.includes('coffee') || tags.includes('cafe') || tags.includes('serve')) {
      return {
        pose: 'admire',
        activity: `Enjoying ${itemDef.name}`,
        priorityBonus: prefs.includes('order_coffee') || prefs.includes('sip') ? 2.2 : 0.8,
        isGenerallyInteresting: true,
      };
    }
    if (tags.includes('cook') || tags.includes('kitchen') || tags.includes('food') || tags.includes('diner')) {
      return {
        pose: 'admire',
        activity: `Checking out ${itemDef.name}`,
        priorityBonus: visitorDef.id === 'foodie' ? 2.4 : 0.6,
        isGenerallyInteresting: true,
      };
    }
    if (tags.includes('art')) {
      return {
        pose: 'admire',
        activity: `Admiring ${itemDef.name}`,
        priorityBonus: visitorDef.id === 'artist' ? 2.4 : 0.5,
        isGenerallyInteresting: true,
      };
    }
    if (tags.includes('read')) {
      return {
        pose: 'admire',
        activity: `Browsing ${itemDef.name}`,
        priorityBonus: prefs.includes('browse_shelf') ? 2.2 : 0.6,
        isGenerallyInteresting: true,
      };
    }
    if (tags.includes('plants')) {
      return {
        pose: 'admire',
        activity: `Admiring ${itemDef.name}`,
        priorityBonus: prefs.includes('admire_plant') ? 2.1 : 0.5,
        isGenerallyInteresting: true,
      };
    }
    if (tags.includes('window')) {
      return {
        pose: 'admire',
        activity: 'Looking out the window',
        priorityBonus: prefs.includes('look_out_window') ? 1.8 : 0.4,
        isGenerallyInteresting: true,
      };
    }
    return {
      pose: 'admire',
      activity: `Checking out ${itemDef.name}`,
      priorityBonus: 0.2,
      isGenerallyInteresting: false,
    };
  }

  private arriveAtTarget(v: ActiveVisitorRuntime): void {
    const state = this.store.getState();
    const item = v.targetItemUid ? this.store.getItem(v.targetItemUid) : undefined;
    const def = item ? this.store.data.itemsById.get(item.itemId) : undefined;

    v.velX = 0;
    v.velZ = 0;
    v.smoothVelX = 0;
    v.smoothVelZ = 0;

    if (item && def) {
      const isDisliked = v.def.dislikedTags.some((t) => def.tags.includes(t));
      const spec = this.classifyInteraction(v.def, def);

      // If visitor dislikes this item, react with 👎 / 😒 instead of happily sitting/dancing on it!
      if (isDisliked) {
        v.phase = 'using';
        v.pose = 'idle';
        v.activity = `Dislikes ${def.name}`;
        v.useTimer = 2.4;
        v.patienceRemaining = Math.max(0, v.patienceRemaining - 6);
        this.updateVisitorMood(v, 0, true);
        v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state), def);
        this.speak(v, true);
        this.emitChange();
        return;
      }

      // True elevated seating ON couches, chairs, bar stools, beanbags & beds!
      if (spec.pose === 'sit') {
        const seatAnchor = this.resolveAvailableSeatAnchor(
          item,
          def,
          v.worldX,
          v.worldZ,
          v.instanceId,
        );
        if (seatAnchor) {
          v.seatAnchor = seatAnchor;
          v.seatBlend = 0;
          v.phase = 'mounting_seat';
          v.pose = 'sit';
          v.activity = spec.activity;
          v.useTimer = 4.6 + Math.random() * 3.0;
          v.targetYaw = seatAnchor.facingYaw;

          const isLiked = v.def.likedTags.some((t) => def.tags.includes(t));
          if (isLiked) {
            v.interactionBoost = Math.min(3.0, v.interactionBoost + 1.15);
          }

          this.updateVisitorMood(v, 0, true);
          v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state), def);
          if (v.speechCooldown <= 0) {
            this.speak(v);
          }
          this.emitChange();
          return;
        }
      }

      v.phase = 'using';
      v.pose = spec.pose === 'sit' ? 'admire' : spec.pose;
      v.activity = spec.activity;
      v.useTimer = 3.8 + Math.random() * 2.8;

      const isLiked = v.def.likedTags.some((t) => def.tags.includes(t));
      if (isLiked) {
        v.interactionBoost = Math.min(3.0, v.interactionBoost + 1.15);
      }

      if (
        (def.tags.includes('cat') || def.tags.includes('pet') || def.interaction?.type === 'bounce') &&
        def.interaction
      ) {
        const now = performance.now() / 1000;
        const lastUsed = this.itemTriggerCooldowns.get(item.uid) ?? 0;
        if (now - lastUsed >= 7.5) {
          this.itemTriggerCooldowns.set(item.uid, now);
          this.store.triggerInteraction(item.uid);
        }
      }

      this.updateVisitorMood(v, 0, true);
      v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state), def);
      if (v.speechCooldown <= 0) {
        this.speak(v);
      }
      this.emitChange();
      return;
    }

    v.phase = 'idle';
    v.pose = 'idle';
    v.targetTile = null;
    v.idleTimer = 1.2 + Math.random() * 1.4;
    v.activity = 'Looking around';
    v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state));
    this.emitChange();
  }

  /**
   * Automatically opens placed doors when any visitor approaches within 1.3 world units
   * (playing a subtle latch foley once on open) and closes them 1.0s after visitors clear.
   */
  private updateDoorProximity(dt: number, state: HouseState): void {
    const nearNow = new Set<string>();

    for (const door of this.navGrid.doors) {
      const wt = wallEdgeToWorldTransform(
        door.item.x,
        door.item.z,
        door.item.rotation,
        state.gridWidth,
        state.gridDepth,
        0,
      );

      for (const v of this.active) {
        if (v.phase === 'arriving_transport' || v.leavingPopTimer > 0) continue;
        if (Math.hypot(v.worldX - wt.wx, v.worldZ - wt.wz) <= DOOR_TRIGGER_RADIUS) {
          nearNow.add(door.item.uid);
          if (!this.doorHoldTimers.has(door.item.uid)) {
            this.setDoorVisitorOpenSafe(door.item.uid, true);
            this.audioModule?.playInteract(door.item.itemId, ['door'], true);
          }
          this.doorHoldTimers.set(door.item.uid, DOOR_HOLD_SECONDS);
          break;
        }
      }
    }

    for (const [uid, remaining] of Array.from(this.doorHoldTimers.entries())) {
      if (nearNow.has(uid)) continue;
      const next = remaining - dt;
      if (next <= 0) {
        this.doorHoldTimers.delete(uid);
        this.setDoorVisitorOpenSafe(uid, false);
      } else {
        this.doorHoldTimers.set(uid, next);
      }
    }
  }

  /**
   * Spawns autonomous visitors organically when the house is Open (~65% likes match, ~35% varied/dislikes).
   */
  private updateAutonomousSpawner(dt: number, state: HouseState): void {
    if (!this.isHouseOpen()) return;
    if (this.visitorDefs.length === 0) return;

    const autoCount = this.active.filter(
      (v) => v.isAutonomous && v.phase !== 'leaving' && v.phase !== 'waiting_pickup',
    ).length;

    if (autoCount >= MAX_AUTONOMOUS_VISITORS || this.active.length >= 8) {
      return;
    }

    this.autonomousSpawnTimer -= dt;
    if (this.autonomousSpawnTimer > 0) return;

    const activeIds = new Set(this.active.map((v) => v.def.id));
    const likedDefs: VisitorDef[] = [];
    const dislikedOrVariedDefs: VisitorDef[] = [];

    for (const def of this.visitorDefs) {
      const aff = this.evaluateRoomAffinity(def, state);
      if (aff.likedScore > 0 && aff.dislikedScore === 0) {
        likedDefs.push(def);
      }
      if (aff.dislikedScore > 0 || aff.likedScore < 1.2) {
        dislikedOrVariedDefs.push(def);
      }
    }

    const preferMatch = Math.random() < 0.65;
    let pool = preferMatch
      ? likedDefs.length > 0
        ? likedDefs
        : this.visitorDefs
      : dislikedOrVariedDefs.length > 0
        ? dislikedOrVariedDefs
        : this.visitorDefs;

    // Prefer archetypes not already visiting so the room looks lively and diverse
    const freshPool = pool.filter((d) => !activeIds.has(d.id));
    if (freshPool.length > 0) {
      pool = freshPool;
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen) {
      this.spawnVisitorInternal(chosen.id, true);
    }

    // Next organic arrival in 8–14 seconds
    this.autonomousSpawnTimer = 8 + Math.random() * 6;
  }

  private computeAvoidanceVector(
    v: ActiveVisitorRuntime,
    desiredDirX: number,
    desiredDirZ: number,
  ): { steerX: number; steerZ: number; speedFactor: number } {
    let steerX = 0;
    let steerZ = 0;
    let speedFactor = 1.0;

    const rightX = -desiredDirZ;
    const rightZ = desiredDirX;

    const inNarrowSpot = isTightCorridor(this.navGrid, v.worldX, v.worldZ, desiredDirX, desiredDirZ);

    for (const other of this.active) {
      if (other.instanceId === v.instanceId) continue;
      if (other.leavingPopTimer > 0 || other.phase === 'arriving_transport') continue;
      if (other.seatAnchor) continue; // Seated visitors sit ON furniture above walking path

      const rx = v.worldX - other.worldX;
      const rz = v.worldZ - other.worldZ;
      const dist = Math.hypot(rx, rz);

      if (dist >= AVOIDANCE_RADIUS) continue;

      const nx = dist > 0.001 ? rx / dist : v.instanceId < other.instanceId ? 1 : -1;
      const nz = dist > 0.001 ? rz / dist : 0;

      const aheadDot = -(nx * desiredDirX + nz * desiredDirZ);

      const otherSpeed = Math.hypot(other.smoothVelX, other.smoothVelZ);
      if (inNarrowSpot && otherSpeed > 0.25 && aheadDot > 0.55) {
        const otherDirX = other.smoothVelX / otherSpeed;
        const otherDirZ = other.smoothVelZ / otherSpeed;
        const opposing = desiredDirX * otherDirX + desiredDirZ * otherDirZ < -0.5;
        if (opposing) {
          const shouldYield =
            v.phase !== 'leaving' &&
            (other.phase === 'leaving' || v.instanceId < other.instanceId);
          if (shouldYield && v.yieldTimer <= 0) {
            v.yieldTimer = 0.65;
          }
        }
      }

      if (aheadDot > 0.05) {
        const proximity = (AVOIDANCE_RADIUS - dist) / AVOIDANCE_RADIUS;
        const passStrength = proximity * 1.2;
        steerX += rightX * passStrength;
        steerZ += rightZ * passStrength;
        if (dist < PERSONAL_SPACE * 1.05 && aheadDot > 0.72) {
          speedFactor = Math.min(speedFactor, 0.58);
        }
      }

      if (dist < PERSONAL_SPACE) {
        const overlap = (PERSONAL_SPACE - dist) / PERSONAL_SPACE;
        const push = 1.45 * overlap;
        steerX += nx * push;
        steerZ += nz * push;
      }
    }

    const steerMag = Math.hypot(steerX, steerZ);
    if (steerMag > MAX_SEPARATION_SPEED) {
      const s = MAX_SEPARATION_SPEED / steerMag;
      steerX *= s;
      steerZ *= s;
    }

    return { steerX, steerZ, speedFactor };
  }

  private nudgeAsideForYield(v: ActiveVisitorRuntime, dt: number): void {
    const state = this.store.getState();
    const tx = v.currentTile.x;
    const tz = v.currentTile.z;
    const dirs: GridCoord[] = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ];

    let bestTile: GridCoord | null = null;
    let bestScore = -Infinity;
    for (const d of dirs) {
      const nx = tx + d.x;
      const nz = tz + d.z;
      if (!canStepBetween(this.navGrid, tx, tz, nx, nz)) continue;
      const w = tileCenterToWorld(nx, nz, state.gridWidth, state.gridDepth);
      let minDist = Infinity;
      for (const other of this.active) {
        if (other.instanceId === v.instanceId || other.seatAnchor) continue;
        const od = Math.hypot(w.wx - other.worldX, w.wz - other.worldZ);
        if (od < minDist) minDist = od;
      }
      if (minDist > bestScore) {
        bestScore = minDist;
        bestTile = { x: nx, z: nz };
      }
    }

    if (bestTile) {
      const targetW = tileCenterToWorld(bestTile.x, bestTile.z, state.gridWidth, state.gridDepth);
      const dx = targetW.wx - v.worldX;
      const dz = targetW.wz - v.worldZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = v.def.walkSpeed * 0.7 * dt;
        const nextWx = v.worldX + (dx / dist) * Math.min(step, dist);
        const nextWz = v.worldZ + (dz / dist) * Math.min(step, dist);
        const safe = resolveSafeMovement(
          this.navGrid,
          v.worldX,
          v.worldZ,
          nextWx,
          nextWz,
          v.phase === 'entering' || v.phase === 'leaving',
        );
        v.worldX = safe.wx;
        v.worldZ = safe.wz;
        v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
        v.mesh.updateAnimation(dt, 'walk', v.def.walkSpeed * 0.7);
        return;
      }
    }

    v.mesh.updateAnimation(dt, 'idle', v.def.walkSpeed);
  }

  private enforcePersonalSpace(dt: number): void {
    const count = this.active.length;
    if (count < 2) return;

    const maxPushStep = MAX_SEPARATION_SPEED * Math.max(dt, 1 / 60);

    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < count; i++) {
        const a = this.active[i];
        if (a.leavingPopTimer > 0 || a.phase === 'arriving_transport' || a.seatAnchor) continue;

        for (let j = i + 1; j < count; j++) {
          const b = this.active[j];
          if (b.leavingPopTimer > 0 || b.phase === 'arriving_transport' || b.seatAnchor) continue;

          const dx = b.worldX - a.worldX;
          const dz = b.worldZ - a.worldZ;
          const dist = Math.hypot(dx, dz);
          if (dist >= PERSONAL_SPACE) continue;

          const nx = dist > 0.001 ? dx / dist : i % 2 === 0 ? 1 : -1;
          const nz = dist > 0.001 ? dz / dist : 0;
          const overlap = Math.min(PERSONAL_SPACE - dist, maxPushStep * 1.8);

          const aStatic = a.phase === 'using';
          const bStatic = b.phase === 'using';
          const weightA = aStatic && !bStatic ? 0.12 : !aStatic && bStatic ? 0.88 : 0.5;
          const weightB = 1 - weightA;

          const allowOutA = a.phase === 'entering' || a.phase === 'leaving' || a.phase === 'waiting_pickup';
          const allowOutB = b.phase === 'entering' || b.phase === 'leaving' || b.phase === 'waiting_pickup';

          const safeA = resolveSafeMovement(
            this.navGrid,
            a.worldX,
            a.worldZ,
            a.worldX - nx * overlap * weightA,
            a.worldZ - nz * overlap * weightA,
            allowOutA,
          );
          const safeB = resolveSafeMovement(
            this.navGrid,
            b.worldX,
            b.worldZ,
            b.worldX + nx * overlap * weightB,
            b.worldZ + nz * overlap * weightB,
            allowOutB,
          );

          a.worldX = safeA.wx;
          a.worldZ = safeA.wz;
          b.worldX = safeB.wx;
          b.worldZ = safeB.wz;
          a.mesh.root.position.set(a.worldX, a.worldY, a.worldZ);
          b.mesh.root.position.set(b.worldX, b.worldY, b.worldZ);
        }
      }
    }
  }

  private stepExteriorWaypoint(
    v: ActiveVisitorRuntime,
    wp: WorldPoint,
    dt: number,
    velSmoothAlpha: number,
  ): boolean {
    const dx = wp.wx - v.worldX;
    const dz = wp.wz - v.worldZ;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.18) {
      return true;
    }

    const speed = v.def.walkSpeed;
    const step = Math.min(speed * dt, dist);
    const movedX = (dx / dist) * step;
    const movedZ = (dz / dist) * step;
    v.worldX += movedX;
    v.worldZ += movedZ;
    v.velX = dt > 0 ? movedX / dt : 0;
    v.velZ = dt > 0 ? movedZ / dt : 0;
    v.smoothVelX += (v.velX - v.smoothVelX) * velSmoothAlpha;
    v.smoothVelZ += (v.velZ - v.smoothVelZ) * velSmoothAlpha;

    const smoothSpeed = Math.hypot(v.smoothVelX, v.smoothVelZ);
    if (smoothSpeed > 0.12) {
      v.targetYaw = Math.atan2(v.smoothVelX, v.smoothVelZ);
    }
    v.rotY = dampAngle(v.rotY, v.targetYaw, 9, dt);
    v.mesh.root.rotation.y = v.rotY;
    v.mesh.root.position.set(v.worldX, 0, v.worldZ);
    v.mesh.updateAnimation(dt, 'walk', speed);
    return false;
  }

  update(dt: number): void {
    if (dt <= 0) return;

    const state = this.store.getState();

    // Update biome vehicles & persistent elevator kiosk every frame
    this.transport.update(dt);

    // Organic autonomous guest spawning when house is Open
    this.updateAutonomousSpawner(dt, state);

    if (this.active.length === 0) {
      // Ensure any held doors close cleanly even if last visitor just left
      if (this.doorHoldTimers.size > 0) {
        this.updateDoorProximity(dt, state);
      }
      return;
    }

    const toRemove: ActiveVisitorRuntime[] = [];
    let anyChanged = false;
    const velSmoothAlpha = 1 - Math.exp(-10 * dt);

    for (const v of this.active) {
      v.speechCooldown = Math.max(0, v.speechCooldown - dt);
      v.replanCooldown = Math.max(0, v.replanCooldown - dt);

      // Waiting inside incoming car/boat/elevator until transport reaches curb/pier/terrace
      if (v.phase === 'arriving_transport') {
        continue;
      }

      // Clean opaque scale-in pop on spawn
      if (v.spawnPopTimer > 0) {
        v.spawnPopTimer += dt;
        const t = clamp01(v.spawnPopTimer / SPAWN_POP_DURATION);
        const eased = t < 1 ? 0.05 + 0.95 * (1 - Math.pow(1 - t, 3)) : 1;
        v.mesh.setScalePop(eased);
        if (t >= 1) {
          v.spawnPopTimer = 0;
          v.mesh.setScalePop(1);
        }
      }

      // Speak initial arrival reaction once inside/near the house
      if (
        !v.hasSpokenInitial &&
        v.speechCooldown <= 0 &&
        v.exteriorPath.length === 0 &&
        v.phase !== 'leaving' &&
        v.phase !== 'waiting_pickup'
      ) {
        v.hasSpokenInitial = true;
        this.updateVisitorMood(v, 0, true);
        const aff = this.evaluateRoomAffinity(v.def, state);
        this.speak(v, aff.presentDislikedTags.length > 0 && aff.netScore < 1.5);
        anyChanged = true;
      }

      if (v.phase !== 'leaving' && v.phase !== 'waiting_pickup') {
        if (this.updateVisitorMood(v, dt)) {
          anyChanged = true;
        }
      }

      // Clean opaque scale-out pop on exit
      if (v.leavingPopTimer > 0) {
        v.leavingPopTimer += dt;
        const t = clamp01(v.leavingPopTimer / LEAVE_POP_DURATION);
        const scale = Math.max(0.01, 1 - t * t);
        v.mesh.setScalePop(scale);
        v.mesh.updateAnimation(dt, 'idle', v.def.walkSpeed);
        if (t >= 1) {
          toRemove.push(v);
        }
        continue;
      }

      // Waiting at curb/pier/elevator for pickup vehicle to arrive & open
      if (v.phase === 'waiting_pickup') {
        v.velX = 0;
        v.velZ = 0;
        v.smoothVelX = 0;
        v.smoothVelZ = 0;
        v.stuckExitTimer += dt;
        v.mesh.updateAnimation(dt, 'idle', v.def.walkSpeed);
        if (v.stuckExitTimer > 6.5) {
          v.leavingPopTimer = 0.001;
        }
        continue;
      }

      // Smoothly hopping ONTO couch/chair/stool/bed cushion
      if (v.phase === 'mounting_seat' && v.seatAnchor) {
        v.seatBlend = clamp01(v.seatBlend + dt / SEAT_MOUNT_DURATION);
        const t = v.seatBlend;
        const smoothT = t * t * (3 - 2 * t);
        const arcY = Math.sin(t * Math.PI) * 0.1;

        v.worldX = v.seatAnchor.returnX + (v.seatAnchor.wx - v.seatAnchor.returnX) * smoothT;
        v.worldZ = v.seatAnchor.returnZ + (v.seatAnchor.wz - v.seatAnchor.returnZ) * smoothT;
        v.worldY = v.seatAnchor.wy * smoothT + arcY;

        v.rotY = dampAngle(v.rotY, v.seatAnchor.facingYaw, 11, dt);
        v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
        v.mesh.root.rotation.y = v.rotY;
        v.mesh.updateAnimation(dt, 'sit', v.def.walkSpeed, smoothT);

        if (v.seatBlend >= 1) {
          v.phase = 'using';
          v.worldX = v.seatAnchor.wx;
          v.worldY = v.seatAnchor.wy;
          v.worldZ = v.seatAnchor.wz;
          v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
        }
        continue;
      }

      // Smoothly stepping OFF couch/chair/stool/bed cushion back onto floor tile
      if (v.phase === 'dismounting_seat' && v.seatAnchor) {
        v.seatBlend = clamp01(v.seatBlend - dt / SEAT_DISMOUNT_DURATION);
        const t = v.seatBlend;
        const smoothT = t * t * (3 - 2 * t);
        const arcY = Math.sin(t * Math.PI) * 0.08;

        v.worldX = v.seatAnchor.returnX + (v.seatAnchor.wx - v.seatAnchor.returnX) * smoothT;
        v.worldZ = v.seatAnchor.returnZ + (v.seatAnchor.wz - v.seatAnchor.returnZ) * smoothT;
        v.worldY = v.seatAnchor.wy * smoothT + arcY;

        v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
        v.mesh.updateAnimation(dt, 'sit', v.def.walkSpeed, smoothT);

        if (v.seatBlend <= 0) {
          v.worldX = v.seatAnchor.returnX;
          v.worldY = 0;
          v.worldZ = v.seatAnchor.returnZ;
          v.seatAnchor = null;
          v.mesh.root.position.set(v.worldX, 0, v.worldZ);
          v.phase = 'idle';
          v.pose = 'idle';
          v.targetItemUid = null;
          v.targetTile = null;
          v.idleTimer = 0.45 + Math.random() * 0.8;
          v.activity = 'Looking around';
          v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state));
          anyChanged = true;
        }
        continue;
      }

      if (v.phase === 'entering' || v.phase === 'walking' || v.phase === 'leaving') {
        if (v.phase === 'leaving') {
          v.stuckExitTimer += dt;
          if (v.stuckExitTimer > 18 && v.leavingPopTimer === 0) {
            v.leavingPopTimer = 0.001;
            continue;
          }
        }

        // Entering along exterior walkway / pier / elevator terrace / woodland trail before entering lot
        if (v.phase === 'entering' && v.exteriorPath.length > 0) {
          const reached = this.stepExteriorWaypoint(v, v.exteriorPath[0], dt, velSmoothAlpha);
          if (reached) {
            v.exteriorPath.shift();
          }
          continue;
        }

        if (v.yieldTimer > 0) {
          v.yieldTimer = Math.max(0, v.yieldTimer - dt);
          v.velX = 0;
          v.velZ = 0;
          v.smoothVelX *= 1 - velSmoothAlpha;
          v.smoothVelZ *= 1 - velSmoothAlpha;
          this.nudgeAsideForYield(v, dt);
          continue;
        }

        const nextWp = v.path[0];
        if (nextWp) {
          const dx = nextWp.wx - v.worldX;
          const dz = nextWp.wz - v.worldZ;
          const dist = Math.hypot(dx, dz);

          const arrivalRadius = v.path.length > 1 ? 0.24 : 0.16;
          if (dist <= arrivalRadius) {
            v.path.shift();
            if (v.pathTiles.length > 0) {
              v.currentTile = v.pathTiles.shift()!;
            }
            v.blockedProgressTimer = 0;
            v.lastWaypointDist = Infinity;
            v.mesh.updateAnimation(dt, 'walk', v.def.walkSpeed);
            continue;
          }

          const desiredDirX = dx / dist;
          const desiredDirZ = dz / dist;

          const avoid = this.computeAvoidanceVector(v, desiredDirX, desiredDirZ);

          let moveDirX = desiredDirX + avoid.steerX;
          let moveDirZ = desiredDirZ + avoid.steerZ;
          const moveMag = Math.hypot(moveDirX, moveDirZ);
          if (moveMag > 0.001) {
            moveDirX /= moveMag;
            moveDirZ /= moveMag;
          }

          const speed = v.def.walkSpeed * avoid.speedFactor;
          const step = Math.min(speed * dt, Math.max(dist, 0.08));
          const candidateWx = v.worldX + moveDirX * step;
          const candidateWz = v.worldZ + moveDirZ * step;

          const allowOutside = v.phase === 'entering' || v.phase === 'leaving';
          const safePos = resolveSafeMovement(
            this.navGrid,
            v.worldX,
            v.worldZ,
            candidateWx,
            candidateWz,
            allowOutside,
          );

          const movedX = safePos.wx - v.worldX;
          const movedZ = safePos.wz - v.worldZ;
          v.worldX = safePos.wx;
          v.worldZ = safePos.wz;
          v.velX = dt > 0 ? movedX / dt : 0;
          v.velZ = dt > 0 ? movedZ / dt : 0;
          v.smoothVelX += (v.velX - v.smoothVelX) * velSmoothAlpha;
          v.smoothVelZ += (v.velZ - v.smoothVelZ) * velSmoothAlpha;

          const smoothSpeed = Math.hypot(v.smoothVelX, v.smoothVelZ);
          if (smoothSpeed > 0.12) {
            v.targetYaw = Math.atan2(v.smoothVelX, v.smoothVelZ);
          }
          v.rotY = dampAngle(v.rotY, v.targetYaw, 9, dt);
          v.mesh.root.rotation.y = v.rotY;

          v.mesh.root.position.set(v.worldX, 0, v.worldZ);
          v.mesh.updateAnimation(dt, smoothSpeed > 0.08 ? 'walk' : 'idle', speed);

          const newDist = Math.hypot(nextWp.wx - v.worldX, nextWp.wz - v.worldZ);
          if (newDist >= v.lastWaypointDist - 0.004) {
            v.blockedProgressTimer += dt;
            if (v.blockedProgressTimer > 1.55 && v.replanCooldown <= 0) {
              v.blockedProgressTimer = 0;
              v.replanCooldown = 0.45;
              if (v.phase === 'leaving') {
                this.replanExitPath(v);
              } else if (v.targetTile) {
                const replanned = this.computePathAvoidingVisitors(v, v.targetTile, true);
                if (replanned && replanned.length > 0) {
                  v.pathTiles = replanned;
                  v.path = replanned.map((t) =>
                    tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
                  );
                } else {
                  this.pickNextDestination(v);
                }
              } else {
                this.pickNextDestination(v);
              }
            }
          } else {
            v.blockedProgressTimer = 0;
          }
          v.lastWaypointDist = newDist;
        } else if (v.phase === 'leaving' && v.exteriorPath.length > 0) {
          // Walk cleanly down exterior walkway / pier / elevator pad / trail
          const reached = this.stepExteriorWaypoint(v, v.exteriorPath[0], dt, velSmoothAlpha);
          if (reached) {
            v.exteriorPath.shift();
          }
        } else {
          v.velX = 0;
          v.velZ = 0;
          v.smoothVelX = 0;
          v.smoothVelZ = 0;

          if (v.phase === 'leaving') {
            const dep = v.departureRoute;
            if (dep && (dep.kind === 'car' || dep.kind === 'boat' || dep.kind === 'elevator')) {
              v.phase = 'waiting_pickup';
              v.stuckExitTimer = 0;
              this.transport.dispatchDeparture(dep, () => {
                if (!this.active.includes(v)) return;
                v.leavingPopTimer = 0.001;
              });
            } else {
              v.leavingPopTimer = 0.001;
            }
          } else if (v.phase === 'entering') {
            v.phase = 'idle';
            v.pose = 'idle';
            v.idleTimer = 0.35;
            v.activity = 'Looking around';
            this.pickNextDestination(v);
          } else {
            this.arriveAtTarget(v);
          }
        }
      } else if (v.phase === 'using') {
        v.velX = 0;
        v.velZ = 0;
        v.smoothVelX = 0;
        v.smoothVelZ = 0;

        if (v.seatAnchor) {
          v.rotY = dampAngle(v.rotY, v.seatAnchor.facingYaw, 9, dt);
          v.mesh.root.rotation.y = v.rotY;
          v.mesh.root.position.set(v.seatAnchor.wx, v.seatAnchor.wy, v.seatAnchor.wz);
          v.mesh.updateAnimation(dt, 'sit', v.def.walkSpeed, 1);
        } else {
          if (v.faceTarget) {
            const dx = v.faceTarget.wx - v.worldX;
            const dz = v.faceTarget.wz - v.worldZ;
            if (Math.hypot(dx, dz) > 0.04) {
              v.targetYaw = Math.atan2(dx, dz);
              v.rotY = dampAngle(v.rotY, v.targetYaw, 8, dt);
              v.mesh.root.rotation.y = v.rotY;
            }
          }
          v.mesh.updateAnimation(dt, v.pose, v.def.walkSpeed, 0);
        }

        v.useTimer -= dt;
        if (v.useTimer <= 0) {
          if (v.seatAnchor) {
            v.phase = 'dismounting_seat';
            v.seatBlend = 1;
          } else {
            v.phase = 'idle';
            v.pose = 'idle';
            v.targetItemUid = null;
            v.targetTile = null;
            v.idleTimer = 0.55 + Math.random() * 1.1;
            v.activity = 'Looking around';
            v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state));
            anyChanged = true;
          }
        }
      } else if (v.phase === 'idle') {
        v.velX = 0;
        v.velZ = 0;
        v.smoothVelX = 0;
        v.smoothVelZ = 0;
        v.mesh.updateAnimation(dt, 'idle', v.def.walkSpeed);
        v.idleTimer -= dt;
        if (v.idleTimer <= 0) {
          if (v.speechCooldown <= 0 && v.hasSpokenInitial) {
            const aff = this.evaluateRoomAffinity(v.def, state);
            this.speak(v, v.mood === 'bored' && aff.presentDislikedTags.length > 0);
            anyChanged = true;
          }
          this.pickNextDestination(v);
        }
      }

      if (!v.seatAnchor) {
        const fx = Math.floor(v.worldX + state.gridWidth / 2);
        const fz = Math.floor(v.worldZ + state.gridDepth / 2);
        if (inGridBounds(fx, fz, state.gridWidth, state.gridDepth)) {
          v.currentTile = { x: fx, z: fz };
        }
      }
    }

    // Proximity automatic door opening & closing
    this.updateDoorProximity(dt, state);

    // Damped wall-safe personal-space separation pass (skips seated guests)
    this.enforcePersonalSpace(dt);

    for (const v of this.active) {
      this.clampToCityTerrace(v, state);
      if (v.seatAnchor) continue;
      const fx = Math.floor(v.worldX + state.gridWidth / 2);
      const fz = Math.floor(v.worldZ + state.gridDepth / 2);
      if (inGridBounds(fx, fz, state.gridWidth, state.gridDepth)) {
        v.currentTile = { x: fx, z: fz };
      }
    }

    if (toRemove.length > 0) {
      const removeIds = new Set(toRemove.map((r) => r.instanceId));
      for (const rem of toRemove) {
        this.visitorsRoot.remove(rem.mesh.root);
        rem.mesh.dispose();
      }
      this.active = this.active.filter((v) => !removeIds.has(v.instanceId));
      anyChanged = true;
    }

    if (anyChanged) {
      this.emitChange();
    }
  }

  dispose(): void {
    this.unsubscribeHouse();
    this.unsubscribeOpen?.();
    this.unsubscribeOpen = null;

    for (const uid of this.doorHoldTimers.keys()) {
      this.setDoorVisitorOpenSafe(uid, false);
    }
    this.doorHoldTimers.clear();

    for (const v of this.active) {
      this.visitorsRoot.remove(v.mesh.root);
      v.mesh.dispose();
    }
    this.active = [];
    this.sceneManager.scene.remove(this.visitorsRoot);
    this.transport.dispose();
    this.changeListeners.clear();
  }
}
