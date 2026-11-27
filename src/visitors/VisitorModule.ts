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
import type { SceneManager } from '../engine/SceneManager';
import type { HouseStore } from '../state/houseStore';
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
  thought?: string;
  activity?: string;
  lastLine?: string;
  lastEmote?: string;
  x: number;
  z: number;
}

type VisitorPhase = 'entering' | 'walking' | 'using' | 'idle' | 'leaving';

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
  mood: VisitorMood;
  moodScore: number;
  matchedInterests: string[];
  thought: string;
  phase: VisitorPhase;
  pose: VisitorPose;
  activity: string;
  worldX: number;
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
  targetItemUid: string | null;
  targetTile: GridCoord | null;
  faceTarget: WorldPoint | null;
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
  sleep: 'a cozy bed',
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

/**
 * Manages invited visitors: 30 stylish gender-diverse figurines (10 personalities × 3 variants),
 * smooth damped collision-free pathfinding, furniture interactions, mood meters & contextual
 * thoughts for the Visitor Status Panel, emoji-only 3D emotion bubbles, and gibberish voice playback.
 */
export class VisitorModule {
  readonly store: HouseStore;
  readonly sceneManager: SceneManager;
  readonly visitorDefs: VisitorDef[];
  readonly dialogue: DialogueData;

  private readonly dialogueEngine: DialogueEngine;
  private readonly visitorsRoot = new THREE.Group();
  private audioModule: AudioModule | null;

  private navGrid: NavGrid;
  private active: ActiveVisitorRuntime[] = [];
  private changeListeners = new Set<() => void>();
  private itemTriggerCooldowns = new Map<string, number>();
  private variantCounters = new Map<string, number>();
  private unsubscribeHouse: () => void;
  private spawnCounter = 0;

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

    this.navGrid = buildNavGrid(store.getState(), store.data);
    this.unsubscribeHouse = store.on('houseChanged', () => this.handleHouseChanged());
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

  invite(visitorId: string): ActiveVisitorSnapshot | null {
    const def = this.store.data.visitorsById.get(visitorId) as VisitorDefWithPersonas | undefined;
    if (!def) return null;

    const state = this.store.getState();
    this.navGrid = buildNavGrid(state, this.store.data);

    const occupiedWorld = this.active.map((v) => ({ wx: v.worldX, wz: v.worldZ }));
    const spawn = pickSpawnLocation(this.navGrid, this.spawnCounter++, occupiedWorld);
    const variantIndex = this.nextVariantFor(visitorId);
    const persona = resolvePersona(def, variantIndex);
    const mesh = new VisitorMesh(def, variantIndex);

    const startX = spawn.spawnWorld.wx;
    const startZ = spawn.spawnWorld.wz;

    mesh.root.position.set(startX, 0, startZ);
    // Clean opaque scale-in pop (zero transparency inside-out artifacts!)
    mesh.setScalePop(0.05);
    this.visitorsRoot.add(mesh.root);

    const affinity = this.evaluateRoomAffinity(def, state);
    const initialMood: VisitorMood =
      affinity.netScore >= 2.4 && affinity.dislikedScore < 1.5 ? 'happy' : 'neutral';
    const initialScore = this.computeMoodScore(initialMood, affinity.netScore, def.patienceSeconds, def.patienceSeconds, false);

    const runtime: ActiveVisitorRuntime = {
      instanceId: nextVisitorInstanceId(),
      def,
      variantIndex,
      persona,
      mesh,
      mood: initialMood,
      moodScore: initialScore,
      matchedInterests: affinity.matchedInterests,
      thought: `Stepping inside to check out the space!`,
      phase: 'entering',
      pose: 'walk',
      activity: 'Arriving',
      worldX: startX,
      worldZ: startZ,
      velX: 0,
      velZ: 0,
      smoothVelX: 0,
      smoothVelZ: 0,
      rotY: 0,
      targetYaw: 0,
      currentTile: { ...spawn.startTile },
      path: [],
      pathTiles: [],
      targetItemUid: null,
      targetTile: spawn.firstGoal ?? null,
      faceTarget: null,
      useTimer: 0,
      idleTimer: 0.35,
      speechCooldown: 0.65,
      hasSpokenInitial: false,
      interactionBoost: 0,
      patienceRemaining: def.patienceSeconds,
      spawnPopTimer: 0.001,
      leavingPopTimer: 0,
      stuckExitTimer: 0,
      blockedProgressTimer: 0,
      replanCooldown: 0,
      yieldTimer: 0,
      lastWaypointDist: Infinity,
      dismissedVoluntarily: false,
    };

    if (spawn.firstGoal) {
      const entryPath = this.computePathAvoidingVisitors(runtime, spawn.firstGoal);
      if (entryPath && entryPath.length > 0) {
        runtime.pathTiles = entryPath;
        runtime.path = entryPath.map((t) =>
          tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
        );
      } else {
        const firstWorld = tileCenterToWorld(
          spawn.firstGoal.x,
          spawn.firstGoal.z,
          state.gridWidth,
          state.gridDepth,
        );
        runtime.path = [firstWorld];
        runtime.pathTiles = [spawn.firstGoal];
      }
      const nextPt = runtime.path[0];
      if (nextPt) {
        runtime.rotY = Math.atan2(nextPt.wx - startX, nextPt.wz - startZ);
        runtime.targetYaw = runtime.rotY;
        mesh.root.rotation.y = runtime.rotY;
      }
    }

    runtime.thought = this.buildContextualThought(runtime, affinity);

    this.active.push(runtime);
    this.emitChange();
    return this.toSnapshot(runtime);
  }

  dismiss(instanceId: string): void {
    const visitor = this.active.find((v) => v.instanceId === instanceId);
    if (!visitor || visitor.phase === 'leaving') return;
    visitor.dismissedVoluntarily = true;
    this.beginLeaving(visitor, 'Headed home');
  }

  dismissAll(): void {
    let changed = false;
    for (const visitor of this.active) {
      if (visitor.phase !== 'leaving') {
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
      thought: v.thought,
      activity: v.activity,
      // Never expose Greek/invented text — 3D uses emoji bubbles and panel uses `thought`!
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
        if (inGridBounds(other.currentTile.x, other.currentTile.z, this.navGrid.width, depth)) {
          occupied.add(tileIndex(other.currentTile.x, other.currentTile.z, depth));
        }
      }
    }
    return occupied;
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

  private handleHouseChanged(): void {
    const state = this.store.getState();
    this.navGrid = buildNavGrid(state, this.store.data);

    let changed = false;
    for (const v of this.active) {
      if (
        !inGridBounds(v.currentTile.x, v.currentTile.z, state.gridWidth, state.gridDepth) ||
        !this.navGrid.walkable[v.currentTile.x][v.currentTile.z]
      ) {
        const safeTile = findNearestWalkableTile(this.navGrid, v.worldX, v.worldZ);
        const safeWorld = tileCenterToWorld(safeTile.x, safeTile.z, state.gridWidth, state.gridDepth);
        v.currentTile = safeTile;
        v.worldX = safeWorld.wx;
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
          v.phase = 'idle';
          v.pose = 'idle';
          v.idleTimer = 0.25;
          v.activity = 'Looking around';
          changed = true;
        } else {
          v.pathTiles = newPath;
          v.path = newPath.map((t) =>
            tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
          );
        }
      }

      if (this.updateVisitorMood(v, 0, true)) {
        changed = true;
      }
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
  ): number {
    switch (mood) {
      case 'leaving':
        return dismissedVoluntarily ? 22 : 6;
      case 'bored': {
        const ratio = patienceTotal > 0 ? clamp01(patienceRemaining / patienceTotal) : 0;
        return Math.round(10 + ratio * 24);
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
    if (v.phase === 'leaving' || v.mood === 'leaving') {
      if (v.dismissedVoluntarily) {
        return 'Had a lovely visit — waving goodbye for now!';
      }
      if (affinity.presentDislikedTags.length > 0) {
        const bad = TAG_FRIENDLY_LABELS[affinity.presentDislikedTags[0]] ?? affinity.presentDislikedTags[0];
        return `Too much ${bad} for me right now — heading home.`;
      }
      const wanted = affinity.missingInterests[0];
      if (wanted) {
        const label = TAG_FRIENDLY_LABELS[wanted] ?? wanted;
        return `Couldn't find any ${label} — heading home for now.`;
      }
      return 'Getting a little sleepy, might head home soon.';
    }

    // Active interaction thoughts when using furniture
    if (v.phase === 'using' && activeItemDef) {
      const tags = activeItemDef.tags;
      const name = activeItemDef.name;
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
        return `Settling right in — this ${name} is super comfy!`;
      }
      return `Checking out the ${name} — nice touch!`;
    }

    if (v.mood === 'bored') {
      if (affinity.presentDislikedTags.length > 0) {
        const bad = TAG_FRIENDLY_LABELS[affinity.presentDislikedTags[0]] ?? affinity.presentDislikedTags[0];
        return `Hmm, a bit too much ${bad} for my taste…`;
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
    if (v.phase === 'entering') {
      return 'Just arrived — excited to see what this place is like!';
    }
    return 'Looking around and taking in the room details…';
  }

  private updateVisitorMood(
    v: ActiveVisitorRuntime,
    dt: number,
    suppressSpeak = false,
  ): boolean {
    if (v.phase === 'leaving') return false;

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
    if (prevMatchedKey !== nextMatchedKey) {
      v.matchedInterests = affinity.matchedInterests;
      stateChanged = true;
    }

    if (targetMood !== prevMood) {
      v.mood = targetMood;
      stateChanged = true;
      if (!suppressSpeak && v.hasSpokenInitial && (targetMood === 'delighted' || targetMood === 'bored')) {
        this.speak(v);
      }
    }

    if (v.mood === 'bored') {
      const drainScale =
        affinity.dislikedScore > 0 ? 3.2 : affinity.likedScore === 0 ? 2.8 : 1.3;
      v.patienceRemaining = Math.max(0, v.patienceRemaining - dt * drainScale);
      if (v.patienceRemaining <= 0) {
        this.beginLeaving(v, 'Bored — heading home');
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
    );
    if (Math.abs(nextScore - v.moodScore) >= 4 || targetMood !== prevMood) {
      v.moodScore = nextScore;
      stateChanged = true;
    }

    if (targetMood !== prevMood || prevMatchedKey !== nextMatchedKey) {
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
    if (v.phase === 'leaving') return;
    const affinity = this.evaluateRoomAffinity(v.def, this.store.getState());
    v.phase = 'leaving';
    v.mood = 'leaving';
    v.moodScore = v.dismissedVoluntarily ? 22 : 6;
    v.pose = 'walk';
    v.activity = activityLabel;
    v.thought = this.buildContextualThought(v, affinity);
    v.targetItemUid = null;
    v.targetTile = null;
    v.stuckExitTimer = 0;
    v.leavingPopTimer = 0;
    v.blockedProgressTimer = 0;

    this.speak(v);
    this.replanExitPath(v);

    if (!quietEmit) {
      this.emitChange();
    }
  }

  private replanExitPath(v: ActiveVisitorRuntime): void {
    const state = this.store.getState();
    const exit = pickExitLocation(this.navGrid, v.currentTile);
    const gridPath = this.computePathAvoidingVisitors(v, exit.exitTile);
    if (gridPath) {
      v.pathTiles = gridPath;
      v.targetTile = exit.exitTile;
      v.path = gridPath.map((t) =>
        tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
      );
      if (
        Math.hypot(
          exit.exitWorld.wx - (v.path[v.path.length - 1]?.wx ?? v.worldX),
          exit.exitWorld.wz - (v.path[v.path.length - 1]?.wz ?? v.worldZ),
        ) > 0.1
      ) {
        v.path.push(exit.exitWorld);
      }
    } else {
      v.pathTiles = [];
      v.path = [exit.exitWorld];
    }
  }

  /**
   * Emits an emoji-only 3D emotion bubble with animated blabbering soundwave and plays
   * the cozy synthesized gibberish voice using the hand-written dialogue line cadence.
   */
  private speak(v: ActiveVisitorRuntime): void {
    const line = this.dialogueEngine.pickLine(v.def.id, v.mood, v.lastLineId);
    const emote = this.dialogueEngine.getEmoteVisual(line.emote);
    const emoji = resolveEmoteEmoji(emote.id, emote.glyph, v.mood);
    const blabberDuration = estimateBlabberDuration(line.text, line.speedMultiplier);

    v.lastLineId = line.id;
    v.lastEmote = emoji;
    v.speechCooldown = 7.5 + Math.random() * 3.5;

    v.mesh.speechBubble.showEmote(emote, v.mood, 4.0, blabberDuration);
    this.audioModule?.playGibberishLine(
      line.text,
      v.def.voiceProfile,
      line.pitchOffset,
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

      let tagMatch = 0;
      for (let i = 0; i < v.def.likedTags.length; i++) {
        if (def.tags.includes(v.def.likedTags[i])) {
          tagMatch += i <= 1 ? 3.2 : 1.8;
        }
      }

      const interactionSpec = this.classifyInteraction(v.def, def);
      if (tagMatch === 0 && !interactionSpec.isGenerallyInteresting) continue;

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
      const occupiedPenalty = this.active.some(
        (other) => other.instanceId !== v.instanceId && other.targetItemUid === item.uid,
      )
        ? -2.8
        : 0;

      const score =
        tagMatch +
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
    if (tags.includes('seating') && !tags.includes('dining')) {
      return {
        pose: 'sit',
        activity: `Relaxing on ${itemDef.name}`,
        priorityBonus: prefs.includes('sit') ? 1.6 : 0.7,
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
    if (tags.includes('seating')) {
      return {
        pose: 'sit',
        activity: `Sitting at ${itemDef.name}`,
        priorityBonus: 0.8,
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
      const spec = this.classifyInteraction(v.def, def);
      v.phase = 'using';
      v.pose = spec.pose;
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
   * Computes smoothly capped right-hand passing steering, soft personal-space repulsion,
   * and polite doorway yielding between `v` and all other active visitors.
   */
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
      if (other.leavingPopTimer > 0) continue;

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

    // Cap lateral separation magnitude to keep steering buttery-smooth without vibration
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
        if (other.instanceId === v.instanceId) continue;
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
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
        v.mesh.updateAnimation(dt, 'walk', v.def.walkSpeed * 0.7);
        return;
      }
    }

    v.mesh.updateAnimation(dt, 'idle', v.def.walkSpeed);
  }

  /**
   * Smoothly damped post-step personal-space relaxation (wall/furniture safe).
   * Uses damped relaxation per frame so separation glides smoothly without snapping/jitter.
   */
  private enforcePersonalSpace(dt: number): void {
    const count = this.active.length;
    if (count < 2) return;

    const maxPushStep = MAX_SEPARATION_SPEED * Math.max(dt, 1 / 60);

    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < count; i++) {
        const a = this.active[i];
        if (a.leavingPopTimer > 0) continue;

        for (let j = i + 1; j < count; j++) {
          const b = this.active[j];
          if (b.leavingPopTimer > 0) continue;

          const dx = b.worldX - a.worldX;
          const dz = b.worldZ - a.worldZ;
          const dist = Math.hypot(dx, dz);
          if (dist >= PERSONAL_SPACE) continue;

          const nx = dist > 0.001 ? dx / dist : (i % 2 === 0 ? 1 : -1);
          const nz = dist > 0.001 ? dz / dist : 0;
          const overlap = Math.min(PERSONAL_SPACE - dist, maxPushStep * 1.8);

          const aStatic = a.phase === 'using';
          const bStatic = b.phase === 'using';
          const weightA = aStatic && !bStatic ? 0.12 : !aStatic && bStatic ? 0.88 : 0.5;
          const weightB = 1 - weightA;

          const allowOutA = a.phase === 'entering' || a.phase === 'leaving';
          const allowOutB = b.phase === 'entering' || b.phase === 'leaving';

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
          a.mesh.root.position.set(a.worldX, 0, a.worldZ);
          b.mesh.root.position.set(b.worldX, 0, b.worldZ);
        }
      }
    }
  }

  update(dt: number): void {
    if (this.active.length === 0 || dt <= 0) return;

    const state = this.store.getState();
    const toRemove: ActiveVisitorRuntime[] = [];
    let anyChanged = false;
    const velSmoothAlpha = 1 - Math.exp(-10 * dt);

    for (const v of this.active) {
      v.speechCooldown = Math.max(0, v.speechCooldown - dt);
      v.replanCooldown = Math.max(0, v.replanCooldown - dt);

      // Clean opaque scale-in pop on spawn
      if (v.spawnPopTimer > 0) {
        v.spawnPopTimer += dt;
        const t = clamp01(v.spawnPopTimer / SPAWN_POP_DURATION);
        // Subtle ease-out overshoot pop
        const eased = t < 1 ? 0.05 + 0.95 * (1 - Math.pow(1 - t, 3)) : 1;
        v.mesh.setScalePop(eased);
        if (t >= 1) {
          v.spawnPopTimer = 0;
          v.mesh.setScalePop(1);
        }
      }

      if (!v.hasSpokenInitial && v.speechCooldown <= 0 && v.phase !== 'leaving') {
        v.hasSpokenInitial = true;
        this.updateVisitorMood(v, 0, true);
        this.speak(v);
        anyChanged = true;
      }

      if (v.phase !== 'leaving') {
        if (this.updateVisitorMood(v, dt)) {
          anyChanged = true;
        }
      }

      if (v.phase === 'entering' || v.phase === 'walking' || v.phase === 'leaving') {
        if (v.phase === 'leaving') {
          v.stuckExitTimer += dt;
          if (v.stuckExitTimer > 12 && v.leavingPopTimer === 0) {
            v.leavingPopTimer = 0.001;
          }
        }

        // Clean opaque scale-out pop on exit (zero transparent inside-out glitches!)
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

          const arrivalRadius = v.path.length > 1 ? 0.24 : 0.14;
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

          // Only update targetYaw when meaningfully moving (> 0.12 u/s) to prevent micro-nudge spin jitter!
          const smoothSpeed = Math.hypot(v.smoothVelX, v.smoothVelZ);
          if (smoothSpeed > 0.12) {
            v.targetYaw = Math.atan2(v.smoothVelX, v.smoothVelZ);
          }
          v.rotY = dampAngle(v.rotY, v.targetYaw, 9, dt);
          v.mesh.root.rotation.y = v.rotY;

          v.mesh.root.position.set(v.worldX, 0, v.worldZ);
          v.mesh.updateAnimation(dt, smoothSpeed > 0.08 ? 'walk' : 'idle', speed);

          // Detect stalled progress around a crowd with a 0.45s replan cooldown
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
        } else {
          v.velX = 0;
          v.velZ = 0;
          v.smoothVelX = 0;
          v.smoothVelZ = 0;
          if (v.phase === 'leaving') {
            v.leavingPopTimer = 0.001;
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
        if (v.faceTarget) {
          const dx = v.faceTarget.wx - v.worldX;
          const dz = v.faceTarget.wz - v.worldZ;
          if (Math.hypot(dx, dz) > 0.04) {
            v.targetYaw = Math.atan2(dx, dz);
            v.rotY = dampAngle(v.rotY, v.targetYaw, 8, dt);
            v.mesh.root.rotation.y = v.rotY;
          }
        }
        v.mesh.updateAnimation(dt, v.pose, v.def.walkSpeed);
        v.useTimer -= dt;
        if (v.useTimer <= 0) {
          v.phase = 'idle';
          v.pose = 'idle';
          v.targetItemUid = null;
          v.targetTile = null;
          v.idleTimer = 0.55 + Math.random() * 1.1;
          v.activity = 'Looking around';
          v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state));
          anyChanged = true;
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
            this.speak(v);
            anyChanged = true;
          }
          this.pickNextDestination(v);
        }
      }

      const fx = Math.floor(v.worldX + state.gridWidth / 2);
      const fz = Math.floor(v.worldZ + state.gridDepth / 2);
      if (inGridBounds(fx, fz, state.gridWidth, state.gridDepth)) {
        v.currentTile = { x: fx, z: fz };
      }
    }

    // Damped wall-safe personal-space separation pass
    this.enforcePersonalSpace(dt);

    for (const v of this.active) {
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
    for (const v of this.active) {
      this.visitorsRoot.remove(v.mesh.root);
      v.mesh.dispose();
    }
    this.active = [];
    this.sceneManager.scene.remove(this.visitorsRoot);
    this.changeListeners.clear();
  }
}
