import * as THREE from 'three';
import type { AudioModule } from '../audio/AudioModule';
import type {
  DialogueData,
  FurnitureItemDef,
  HiredStaff,
  HouseState,
  PlacedItem,
  StaffKind,
  StaffRole,
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
  edgeKeyBetween,
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
import { SpeechBubble, resolveEmoteEmoji } from './SpeechBubble';
import {
  SPECIAL_CHARACTER_IDS,
  createGreenPortalMesh,
  createSpecialCharacterRig,
  type SpecialCharacterRig,
  type SpecialPose,
} from './SpecialCharacterMeshes';
import { StaffMesh, type StaffPose } from './StaffMesh';
import { VisitorMesh, type VisitorPose, type VisitorVariantIndex } from './VisitorMesh';

export interface CaptionPayload {
  speaker: string;
  text: string;
  accent?: string;
}

export interface VisitorPersonaInfo {
  name: string;
  pronouns: string;
  trait: string;
}

interface VisitorDefWithPersonas extends VisitorDef {
  special?: boolean;
  archetypeIcon?: string;
  accentColor?: string;
  personas?: VisitorPersonaInfo[];
}

export interface ActiveVisitorSnapshot {
  instanceId: string;
  visitorId: string;
  isSpecial?: boolean;
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

export type StaffStatus = 'working' | 'walking' | 'break' | 'recharging' | 'idle';

export interface ActiveStaffSnapshot {
  id: string;
  name: string;
  role: StaffRole;
  kind: StaffKind;
  status: StaffStatus;
  stationName?: string;
  activity: string;
  x: number;
  z: number;
}

type StaffPhase =
  | 'walking_to_station'
  | 'working'
  | 'recharging'
  | 'walking_to_break'
  | 'mounting_seat'
  | 'on_break'
  | 'dismounting_seat'
  | 'walking_to_sink'
  | 'washing_hands'
  | 'idle';

interface HiredStaffWithHome extends HiredStaff {
  homeX?: number;
  homeZ?: number;
}

interface ActiveStaffRuntime {
  staff: HiredStaffWithHome;
  mesh: StaffMesh;
  status: StaffStatus;
  phase: StaffPhase;
  pose: StaffPose;
  activity: string;
  stationUid: string | null;
  stationName?: string;
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
  targetTile: GridCoord | null;
  faceTarget: WorldPoint | null;
  seatAnchor: SeatAnchor | null;
  seatBlend: number;
  breakItemUid: string | null;
  breakIsToilet: boolean;
  shiftRemaining: number;
  rechargeCountdown: number;
  phaseTimer: number;
  breakRemaining: number;
  emoteCooldown: number;
  machinePulseCooldown: number;
  spawnPopTimer: number;
  blockedProgressTimer: number;
  lastWaypointDist: number;
}

type BathroomStage = 'none' | 'going_toilet' | 'on_toilet' | 'going_sink' | 'washing_hands';
type BathroomTier = 'quick' | 'reading' | 'spicy';

type SpecialBehaviorState =
  | 'none'
  | 'gojo_line1'
  | 'gojo_line2'
  | 'gojo_line3'
  | 'gojo_descend'
  | 'baki_dash'
  | 'baki_kick'
  | 'bard_approach'
  | 'bard_stare'
  | 'wick_seek'
  | 'wick_pet'
  | 'wick_done'
  | 'homer_eat'
  | 'homer_sleep'
  | 'rick_portal_in'
  | 'rick_portal_out';

interface VisitorVisualHandle {
  readonly root: THREE.Group;
  readonly speechBubble: SpeechBubble;
  readonly isSpecial: boolean;
  readonly specialRig: SpecialCharacterRig | null;
  setScalePop(scale: number): void;
  setMood(mood: VisitorMood): void;
  updateAnimation(
    dt: number,
    pose: VisitorPose | SpecialPose,
    walkSpeed: number,
    seatBlend?: number,
    seatY?: number,
  ): void;
  dispose(): void;
}

interface ActivePortalEffect {
  portal: ReturnType<typeof createGreenPortalMesh>;
  age: number;
  duration: number;
  elapsed: number;
}

interface ActiveStinkPuff {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  age: number;
  duration: number;
  vy: number;
  baseX: number;
  baseZ: number;
  seed: number;
}

function createVisitorVisualHandle(
  def: VisitorDefWithPersonas,
  variantIndex: VisitorVariantIndex,
): VisitorVisualHandle {
  if (SPECIAL_CHARACTER_IDS.has(def.id)) {
    const rig = createSpecialCharacterRig(def.id);
    if (rig) {
      const bubble = new SpeechBubble();
      bubble.setBaseHeight(rig.bubbleHeight);
      rig.root.add(bubble.sprite);
      let elapsed = 0;
      let lastPose: SpecialPose = 'idle';

      return {
        root: rig.root,
        speechBubble: bubble,
        isSpecial: true,
        specialRig: rig,
        setScalePop(scale: number) {
          const s = Math.max(0.001, scale);
          rig.root.scale.set(s, s, s);
        },
        setMood(mood: VisitorMood) {
          rig.setMood(mood);
        },
        updateAnimation(
          dt: number,
          pose: VisitorPose | SpecialPose,
          walkSpeed: number,
          _seatBlend = 0,
          seatY = 0,
        ) {
          elapsed += dt;
          bubble.update(dt);
          const mappedPose: SpecialPose = pose === 'work' ? 'admire' : (pose as SpecialPose);
          if (mappedPose !== lastPose) {
            lastPose = mappedPose;
            rig.setPose(mappedPose);
          }
          rig.update(dt, elapsed, walkSpeed, bubble.isBlabbering(), seatY);
        },
        dispose() {
          bubble.dispose();
          rig.dispose();
        },
      };
    }
  }

  const regular = new VisitorMesh(def, variantIndex);
  return {
    root: regular.root,
    speechBubble: regular.speechBubble,
    isSpecial: false,
    specialRig: null,
    setScalePop(scale: number) {
      regular.setScalePop(scale);
    },
    setMood(_mood: VisitorMood) {},
    updateAnimation(
      dt: number,
      pose: VisitorPose | SpecialPose,
      walkSpeed: number,
      seatBlend = 0,
    ) {
      let regularPose: VisitorPose;
      switch (pose) {
        case 'idle':
        case 'walk':
        case 'sit':
        case 'dance':
        case 'pet':
        case 'admire':
        case 'stumble':
        case 'work':
          regularPose = pose;
          break;
        case 'ragdoll':
          regularPose = 'stumble';
          break;
        case 'thinker':
        case 'sleep':
          regularPose = 'sit';
          break;
        case 'eat':
          regularPose = 'work';
          break;
        default:
          regularPose = 'admire';
          break;
      }
      regular.updateAnimation(dt, regularPose, walkSpeed, seatBlend);
    },
    dispose() {
      regular.dispose();
    },
  };
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
  mesh: VisitorVisualHandle;
  isAutonomous: boolean;
  isSpecial: boolean;
  mood: VisitorMood;
  moodScore: number;
  matchedInterests: string[];
  matchedDislikes: string[];
  thought: string;
  phase: VisitorPhase;
  pose: VisitorPose | SpecialPose;
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
  stumbleTimer: number;
  stumbleCooldown: number;
  stumbleVx: number;
  stumbleVz: number;
  lastWaypointDist: number;
  dismissedVoluntarily: boolean;
  bathroomCooldown: number;
  bathroomStage: BathroomStage;
  bathroomTier: BathroomTier;
  spicyPuffTimer: number;
  spicyEmoteTimer: number;
  reliefMoodBonus: number;
  annoyedMoodPenalty: number;
  socialCooldown: number;
  socialPartnerId: string | null;
  socialTimer: number;
  socialReplyDelay: number;
  socialReplyPending: boolean;
  socialReplyEmoteId: string;
  socialMoodBonus: number;
  socialSavedPhase: VisitorPhase | null;
  specialState: SpecialBehaviorState;
  specialTimer: number;
  specialActionTimer: number;
  specialTargetId: string | null;
  specialCounter: number;
  bardStareElapsed: number;
  bardAnnoyedVictim: boolean;
  gojoHasMonologued: boolean;
  squeakPoseTimer: number;
  ragdollTimer: number;
  ragdollVx: number;
  ragdollVz: number;
  ragdollSpin: number;
  lastLineId?: string;
  lastEmote?: string;
  lastTargetItemUid?: string;
}

const PERSONAL_SPACE = 0.42;
const AVOIDANCE_RADIUS = 0.62;
const STAFF_PERSONAL_SPACE = 0.44;
const STAFF_AVOIDANCE_RADIUS = 0.66;
const STAFF_HOME_MAX_DIST = 2.6;
const MAX_SEPARATION_SPEED = 0.75;
const STUMBLE_DURATION = 0.48;
const STUMBLE_COOLDOWN = 3.5;
const STUMBLE_COLLISION_DIST = 0.4;
const SOCIAL_RADIUS = 2.1;
const SOCIAL_COOLDOWN_MIN = 14.0;
const SPAWN_POP_DURATION = 0.28;
const LEAVE_POP_DURATION = 0.34;
const SEAT_MOUNT_DURATION = 0.32;
const SEAT_DISMOUNT_DURATION = 0.28;
const DOOR_TRIGGER_RADIUS = 1.3;
const DOOR_HOLD_SECONDS = 1.0;
const MAX_AUTONOMOUS_VISITORS = 4;

const STAFF_STATION_ITEMS: Record<StaffRole, readonly string[]> = {
  barista: ['espresso_machine', 'cafe_counter', 'pourover_stand', 'coffee_grinder', 'blender_smoothie'],
  dj: ['dj_booth', 'record_player', 'diner_jukebox', 'karaoke_mic'],
  chef: ['stove_oven', 'kitchen_counter', 'kitchen_island', 'pastry_case'],
  bartender: ['bar_counter', 'shaker_set', 'cafe_counter'],
};

const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  barista: 'Barista',
  dj: 'DJ',
  chef: 'Chef',
  bartender: 'Bartender',
};

const STAFF_WORK_VERBS: Record<StaffRole, string> = {
  barista: 'Brewing at',
  dj: 'Spinning tracks at',
  chef: 'Cooking at',
  bartender: 'Mixing drinks at',
};

const STAFF_WORK_EMOTES: Record<StaffRole, Array<{ id: string; glyph: string; label: string; color: string }>> = {
  barista: [
    { id: 'coffee', glyph: '☕', label: 'Brewing', color: '#E8C5A5' },
    { id: 'sparkles', glyph: '✨', label: 'Fresh espresso', color: '#F6D365' },
  ],
  dj: [
    { id: 'headphones', glyph: '🎧', label: 'Mixing', color: '#CFC2F2' },
    { id: 'note', glyph: '🎵', label: 'Grooving', color: '#B8D4F5' },
  ],
  chef: [
    { id: 'food', glyph: '🍳', label: 'Cooking', color: '#F5CF7B' },
    { id: 'sparkles', glyph: '✨', label: 'Plating', color: '#F6D365' },
  ],
  bartender: [
    { id: 'cocktail', glyph: '🍹', label: 'Shaking', color: '#F7C9A6' },
    { id: 'sparkles', glyph: '✨', label: 'Serving', color: '#B8E8D8' },
  ],
};

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
  toilet_cozy: [{ x: 0, z: 0.06, seatY: 0.42 }],
};

const BATHROOM_EMOTE_TOILET = { id: 'toilet', glyph: '🧻', label: 'Quick pit stop!', color: '#DCE8EE' };
const BATHROOM_EMOTE_QUICK = { id: 'sweat', glyph: '💧', label: 'Quick pit stop!', color: '#C4E8F5' };
const BATHROOM_EMOTE_RELIEVED = { id: 'relieved', glyph: '😌', label: 'Quick pit stop!', color: '#BDE6C8' };
const BATHROOM_EMOTE_PANIC = { id: 'sweatPanic', glyph: '😰', label: 'EMERGENCY!!', color: '#B6D8F2' };
const BATHROOM_SPICY_AGONY_EMOTES = [
  { id: 'grimace', glyph: '😖', label: 'Oh no…', color: '#F0BC9C' },
  { id: 'skull', glyph: '💀', label: 'Spicy regret', color: '#D8D4D0' },
  { id: 'fire', glyph: '🔥', label: 'TOO SPICY', color: '#F7B482' },
  { id: 'wind', glyph: '💨', label: 'Phew!', color: '#CFE6F2' },
];
const BATHROOM_SPICY_AFTERMATH = [
  'NEVER eating that spicy pastry again… 💀',
  'Do NOT go in there for 5 minutes.',
];
const BATHROOM_EMOTE_BUBBLE = { id: 'bubble', glyph: '🫧', label: 'Washing hands', color: '#C4E8F5' };
const BATHROOM_EMOTE_RELIEF = { id: 'sparkles', glyph: '✨', label: 'Ahhh, much better!', color: '#F6D365' };

const SPECIAL_EMOTES = {
  sword: { id: 'sword', glyph: '⚔️', label: 'SKÅL!', color: '#E4B2A8' },
  beer: { id: 'beer', glyph: '🍺', label: 'Mead!', color: '#F5D488' },
  fire: { id: 'fire', glyph: '🔥', label: 'Valhalla!', color: '#F7B482' },
  chicken: { id: 'chicken', glyph: '🐔', label: 'SQUEEEAK!', color: '#FAE084' },
  megaphone: { id: 'megaphone', glyph: '📢', label: 'BAAAAWK!', color: '#F4B6A4' },
  fingers: { id: 'fingers', glyph: '🤞', label: 'Honored One', color: '#A8D0FA' },
  boxing: { id: 'boxing', glyph: '🥊', label: 'Sparring!', color: '#F2A496' },
  boom: { id: 'boom', glyph: '💥', label: 'POW!', color: '#F7BE88' },
  dizzyStar: { id: 'dizzyStar', glyph: '💫', label: 'Whoa!!', color: '#F6E088' },
  raisedBrow: { id: 'raisedBrow', glyph: '🤨', label: 'Critiquing…', color: '#DEC8E6' },
  quill: { id: 'quill', glyph: '🪶', label: 'Sonnet', color: '#D6B8D4' },
  thinking: { id: 'thinking', glyph: '🤔', label: 'Pondering…', color: '#E6D6B8' },
  heart: { id: 'heart', glyph: '💖', label: 'Good kitty', color: '#F5B5C8' },
  paw: { id: 'paw', glyph: '🐾', label: 'Good kitty', color: '#F0B6C2' },
  spider: { id: 'spider', glyph: '🕷️', label: 'Amaze!', color: '#C8BEB4' },
  music: { id: 'music', glyph: '🎶', label: 'Chords!', color: '#B8D4F5' },
  donut: { id: 'donut', glyph: '🍩', label: 'Mmm…', color: '#F6C2D6' },
  coffee: { id: 'coffee', glyph: '☕', label: 'Mmm…', color: '#E8C5A5' },
  zzz: { id: 'zzz', glyph: '💤', label: 'Snoring…', color: '#C8BFE6' },
  sleepy: { id: 'sleepy', glyph: '😴', label: 'Zzz…', color: '#C6BEE6' },
  portal: { id: 'portal', glyph: '🌀', label: 'Wubba lubba!', color: '#9EE8AE' },
};

const GOJO_SPEAKER = '五条 悟';
const GOJO_MONOLOGUE: ReadonlyArray<{
  start: number;
  end: number;
  duration: number;
  text: string;
  emote: typeof SPECIAL_EMOTES.fingers;
}> = [
  {
    start: 0.0,
    end: 4.6,
    duration: 4.6,
    text: '「誰も憎んじゃいない」',
    emote: SPECIAL_EMOTES.fingers,
  },
  {
    start: 4.6,
    end: 24.8,
    duration: 20.2,
    text: '「今はただただ、この世界が心地いい」',
    emote: BATHROOM_EMOTE_RELIEF,
  },
  {
    start: 24.8,
    end: 30.2,
    duration: 5.4,
    text: '「天上天下、唯我独尊」',
    emote: SPECIAL_EMOTES.fingers,
  },
];

const SHAKESPEARE_ANNOYED_QUOTES = [
  'Why is this guy in a ruff staring at me?!',
  'Please stop reciting sonnets at me…',
];

const SHAKESPEARE_CRITIQUES = [
  'Hmm… derivative posture. Needs more tragedy.',
  'Thou art… painfully pedestrian.',
  'A tragic lack of iambic pentameter in thy stance.',
];

const PHILOSOPHER_THOUGHTS = [
  'If a cozy chair sits empty in a café, does it still comfort?',
  'I know that I know nothing… except this cushion is sublime.',
  'What is a cozy room, if not walls embracing peace?',
];

const ROCKY_QUOTES = [
  'Amaze! Amaze! Amaze!',
  'Jazz hands! Good house, question?',
  'Fist my bump! Cozy room, question?',
];

const HOMER_FOOD_IDS = new Set([
  'pastry_case',
  'stove_oven',
  'espresso_machine',
  'cafe_counter',
  'dining_table',
  'fruit_bowl',
  'cake_stand',
  'fridge_retro',
  'fridge_modern',
  'fridge_pastel',
  'coffee_grinder',
  'pourover_stand',
  'blender_smoothie',
]);

const WICK_PET_IDS = new Set([
  'cat_calico',
  'cat_sleepy',
  'cat_kitten',
  'cat_loaf',
  'pet_bed_round',
  'cat_tree',
]);

const RICK_GADGET_IDS = new Set([
  'bar_counter',
  'shaker_set',
  'dj_booth',
  'record_player',
  'diner_jukebox',
  'espresso_machine',
  'arcade_cabinet',
  'tv_stand',
  'tv_wall',
  'computer_desk',
]);

const INITIAL_SPECIAL_SPAWN_INTERVAL = 120;
const SPECIAL_SPAWN_DECAY = 1.45;
const MAX_SPECIAL_SPAWN_INTERVAL = 900;
const IS_DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
const BOT_EMOTE_RECHARGE = { id: 'battery', glyph: '🔋', label: 'Recharging', color: '#B5E8B8' };
const BOT_EMOTE_ROBOT = { id: 'robot', glyph: '🤖', label: 'Cozy Bot', color: '#C2DFEB' };
const SOCIAL_REPLY_EMOTES = [
  { id: 'smile', glyph: '😊', label: 'Happy chat', color: '#9AD4A8' },
  { id: 'heart', glyph: '💖', label: 'Warm chat', color: '#F5B5C8' },
  { id: 'sparkles', glyph: '✨', label: 'Great vibe', color: '#F6D365' },
  { id: 'laugh', glyph: '😄', label: 'Laughing', color: '#FCE39E' },
];

const DISLIKE_EMOTES: Array<{ id: string; glyph: string; label: string; color: string }> = [
  { id: 'thumbsDown', glyph: '👎', label: 'Dislike', color: '#F4C3C2' },
  { id: 'unimpressed', glyph: '😒', label: 'Unimpressed', color: '#E5D4E8' },
  { id: 'grimace', glyph: '😖', label: 'Not my vibe', color: '#F5CDB6' },
];

const BUMP_EMOTES: Array<{ id: string; glyph: string; label: string; color: string }> = [
  { id: 'dizzy', glyph: '😵‍💫', label: 'Bonk!', color: '#F6C6DE' },
  { id: 'surprised', glyph: '😮', label: 'Oops!', color: '#FCE0A8' },
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
  bathroom: 'a cozy bathroom',
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
  private readonly staffRoot = new THREE.Group();
  private readonly effectsRoot = new THREE.Group();
  private readonly transport: ArrivalTransportManager;
  private audioModule: AudioModule | null;

  private navGrid: NavGrid;
  private currentBiome: string;
  private active: ActiveVisitorRuntime[] = [];
  private staffRuntimes: ActiveStaffRuntime[] = [];
  private activePortals: ActivePortalEffect[] = [];
  private stinkPuffs: ActiveStinkPuff[] = [];
  private changeListeners = new Set<() => void>();
  private staffChangeListeners = new Set<() => void>();
  private captionListeners = new Set<(payload: CaptionPayload | null) => void>();
  private activeCaptionOwnerId: string | null = null;
  private gojoCameraFollowOwnerId: string | null = null;
  private gojoVoiceAudio: HTMLAudioElement | null = null;
  private randomSpecialCooldownUntil = 0;
  private randomSpecialCooldownNotifiedZero = true;
  private itemTriggerCooldowns = new Map<string, number>();
  private doorHoldTimers = new Map<string, number>();
  private variantCounters = new Map<string, number>();
  private unsubscribeHouse: () => void;
  private unsubscribeOpen: (() => void) | null = null;
  private unsubscribeDoorPolicy: (() => void) | null = null;
  private unsubscribeStaff: (() => void) | null = null;
  private spawnCounter = 0;
  private staffVariantSeed = 0;
  private autonomousSpawnTimer = 2.5;
  private specialSpawnInterval = INITIAL_SPECIAL_SPAWN_INTERVAL;
  private specialSpawnTimer = INITIAL_SPECIAL_SPAWN_INTERVAL + (Math.random() * 30 - 15);

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
    this.staffRoot.name = 'StaffRoot';
    this.sceneManager.scene.add(this.staffRoot);
    this.effectsRoot.name = 'VisitorEffectsRoot';
    this.sceneManager.scene.add(this.effectsRoot);

    const initialState = store.getState();
    this.currentBiome = initialState.sceneryViewId;
    this.navGrid = buildNavGrid(initialState, store.data);
    this.transport = new ArrivalTransportManager(this.sceneManager.scene);
    this.transport.syncEnvironment(
      initialState.sceneryViewId,
      initialState.gridWidth,
      initialState.gridDepth,
    );

    this.unsubscribeHouse = store.on('houseChanged', ({ reason }) => this.handleHouseChanged(reason));

    // Subscribe to 3-state Door Policy ('open' | 'full' | 'closed'), Open/Closed fallback & Staff events
    const extStore = store as unknown as {
      on?: (
        ev: string,
        fn: (payload: {
          open?: boolean;
          policy?: 'open' | 'full' | 'closed';
          staff?: HiredStaff[];
        }) => void,
      ) => () => void;
    };
    if (typeof extStore.on === 'function') {
      this.unsubscribeDoorPolicy = extStore.on('doorPolicyChanged', ({ policy }) => {
        if (policy) {
          this.handleDoorPolicyChanged(policy);
        }
      });
      this.unsubscribeOpen = extStore.on('houseOpenChanged', () => {
        // Resolve the authoritative 3-state policy so 'full' never accidentally dismisses guests!
        this.handleDoorPolicyChanged(this.getDoorPolicy());
      });
      this.unsubscribeStaff = extStore.on('staffChanged', () => {
        this.syncStaffWithStore();
      });
    }

    this.syncStaffWithStore();
  }

  private getStoreStaff(): HiredStaff[] {
    const s = this.store as unknown as { getStaff?: () => HiredStaff[] };
    if (typeof s.getStaff === 'function') {
      return s.getStaff();
    }
    return this.store.getState().staff ?? [];
  }

  private playBotChirpSafe(): void {
    const a = this.audioModule as unknown as { playBotChirp?: () => void } | null;
    a?.playBotChirp?.();
  }

  private playSpecialSfxSafe(
    method: 'playChickenSqueak' | 'playPortalWarp' | 'playComicKick' | 'playGojoAscend' | 'playRockyChords',
  ): void {
    const a = this.audioModule as unknown as Record<string, (() => void) | undefined> | null;
    a?.[method]?.();
  }

  onCaption(cb: (payload: CaptionPayload | null) => void): () => void {
    this.captionListeners.add(cb);
    return () => this.captionListeners.delete(cb);
  }

  private emitCaption(payload: CaptionPayload | null, ownerId?: string): void {
    this.activeCaptionOwnerId = payload ? (ownerId ?? null) : null;
    for (const listener of this.captionListeners) {
      listener(payload);
    }
  }

  getRandomSpecialCooldownRemaining(): number {
    if (IS_DEV) return 0;
    return Math.max(0, Math.ceil((this.randomSpecialCooldownUntil - Date.now()) / 1000));
  }

  inviteRandomSpecialCharacter(): boolean {
    if (!IS_DEV && this.getRandomSpecialCooldownRemaining() > 0) {
      return false;
    }
    const specials = this.visitorDefs.filter((d) => SPECIAL_CHARACTER_IDS.has(d.id));
    if (specials.length === 0) return false;
    const activeIds = new Set(this.active.map((v) => v.def.id));
    const fresh = specials.filter((d) => !activeIds.has(d.id));
    if (fresh.length === 0) {
      this.store.notify('All legendary guests are already here!', 'info');
      return false;
    }
    const chosen = fresh[Math.floor(Math.random() * fresh.length)];
    if (!chosen) return false;
    const spawned = this.invite(chosen.id);
    if (!spawned) return false;
    if (!IS_DEV) {
      this.randomSpecialCooldownUntil = Date.now() + 25_000;
      this.randomSpecialCooldownNotifiedZero = false;
    }
    this.emitChange();
    return true;
  }

  private focusCameraOnGojo(v: ActiveVisitorRuntime): void {
    const sm = this.sceneManager as unknown as {
      focusOnWorldPoint?: (x: number, z: number, minZoom?: number) => void;
      setCameraFollowProvider?: (
        provider: (() => { x: number; z: number } | null) | null,
        onCleared?: () => void,
      ) => void;
    };
    this.gojoCameraFollowOwnerId = v.instanceId;
    sm.focusOnWorldPoint?.(v.worldX, v.worldZ, 1.75);
    sm.setCameraFollowProvider?.(
      () =>
        this.active.includes(v) &&
        (v.specialState === 'gojo_line1' ||
          v.specialState === 'gojo_line2' ||
          v.specialState === 'gojo_line3')
          ? { x: v.worldX, z: v.worldZ }
          : null,
      () => {
        if (this.gojoCameraFollowOwnerId === v.instanceId) {
          this.gojoCameraFollowOwnerId = null;
        }
      },
    );
  }

  private releaseGojoCameraFollow(ownerId?: string): void {
    if (this.gojoCameraFollowOwnerId === null) return;
    if (ownerId && this.gojoCameraFollowOwnerId !== ownerId) return;
    this.gojoCameraFollowOwnerId = null;
    const sm = this.sceneManager as unknown as {
      setCameraFollowProvider?: (provider: null) => void;
    };
    sm.setCameraFollowProvider?.(null);
  }

  private playGojoVoiceOrSynth(): void {
    this.stopGojoVoiceAudio();
    const audioMod = this.audioModule as unknown as {
      getVolume?: () => number;
      isMuted?: () => boolean;
    } | null;
    const muted = Boolean(audioMod?.isMuted?.());
    const vol = Math.max(0, Math.min(1, audioMod?.getVolume?.() ?? 0.85));

    if (typeof Audio !== 'undefined' && !muted && vol > 0.001) {
      try {
        const el = new Audio('./music/gojo_honored.mp3');
        el.volume = vol;
        el.muted = muted;
        this.gojoVoiceAudio = el;
        el.addEventListener(
          'error',
          () => {
            if (this.gojoVoiceAudio === el) {
              this.gojoVoiceAudio = null;
              this.playSpecialSfxSafe('playGojoAscend');
            }
          },
          { once: true },
        );
        const p = el.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            if (this.gojoVoiceAudio === el) {
              this.gojoVoiceAudio = null;
              this.playSpecialSfxSafe('playGojoAscend');
            }
          });
        }
        return;
      } catch {
        this.gojoVoiceAudio = null;
      }
    }

    this.playSpecialSfxSafe('playGojoAscend');
  }

  private stopGojoVoiceAudio(): void {
    if (!this.gojoVoiceAudio) return;
    try {
      this.gojoVoiceAudio.pause();
      this.gojoVoiceAudio.currentTime = 0;
    } catch {
      // ignore audio teardown errors
    }
    this.gojoVoiceAudio = null;
  }

  skipActiveMonologue(): void {
    this.stopGojoVoiceAudio();
    let changed = false;

    for (const v of this.active) {
      if (
        v.specialState === 'gojo_line1' ||
        v.specialState === 'gojo_line2' ||
        v.specialState === 'gojo_line3' ||
        v.specialState === 'gojo_descend'
      ) {
        v.specialState = 'none';
        v.specialActionTimer = 0;
        v.gojoHasMonologued = true;
        v.pose = 'idle';
        v.phase = 'idle';
        v.idleTimer = 0.5;
        v.activity = 'Looking around effortlessly';
        v.mesh.specialRig?.setAuraActive?.(false);
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
        changed = true;
      }
    }

    if (this.activeCaptionOwnerId !== null) {
      this.emitCaption(null);
      changed = true;
    }
    this.releaseGojoCameraFollow();

    if (changed) {
      this.emitChange();
    }
  }

  private getDoorPolicy(): 'open' | 'full' | 'closed' {
    const s = this.store as unknown as {
      getDoorPolicy?: () => 'open' | 'full' | 'closed';
      isHouseOpen?: () => boolean;
    };
    if (typeof s.getDoorPolicy === 'function') {
      return s.getDoorPolicy();
    }
    return typeof s.isHouseOpen === 'function' ? (s.isHouseOpen() ? 'open' : 'closed') : 'open';
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

  onStaffChange(listener: () => void): () => void {
    this.staffChangeListeners.add(listener);
    return () => this.staffChangeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  private emitStaffChange(): void {
    for (const listener of this.staffChangeListeners) {
      listener();
    }
    this.emitChange();
  }

  getActiveStaff(): ActiveStaffSnapshot[] {
    const state = this.store.getState();
    return this.staffRuntimes.map((s) => {
      const gx = s.worldX + state.gridWidth / 2 - 0.5;
      const gz = s.worldZ + state.gridDepth / 2 - 0.5;
      return {
        id: s.staff.id,
        name: s.staff.name,
        role: s.staff.role,
        kind: s.staff.kind,
        status: s.status,
        stationName: s.stationName,
        activity: s.activity,
        x: Number(gx.toFixed(2)),
        z: Number(gz.toFixed(2)),
      };
    });
  }

  getStaffWorldPosition(staffId: string): { x: number; y: number; z: number } | null {
    const s = this.staffRuntimes.find((entry) => entry.staff.id === staffId);
    if (!s) return null;
    return { x: s.worldX, y: s.worldY, z: s.worldZ };
  }

  private nextVariantFor(visitorId: string): VisitorVariantIndex {
    const count = this.variantCounters.get(visitorId) ?? 0;
    this.variantCounters.set(visitorId, count + 1);
    return (count % 3) as VisitorVariantIndex;
  }

  private handleDoorPolicyChanged(policy: 'open' | 'full' | 'closed'): void {
    if (policy === 'open') {
      this.autonomousSpawnTimer = Math.min(this.autonomousSpawnTimer, 2.2);
      return;
    }

    // 'full' (At Capacity): halt all new autonomous arrivals while letting everyone currently inside stay!
    if (policy === 'full') {
      return;
    }

    // 'closed': halt arrivals AND gently nudge existing autonomous visitors home
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

  inviteVisitor(visitorId: string): boolean {
    return Boolean(this.invite(visitorId));
  }

  private spawnVisitorInternal(
    visitorId: string,
    isAutonomous: boolean,
  ): ActiveVisitorSnapshot | null {
    const def = this.store.data.visitorsById.get(visitorId) as VisitorDefWithPersonas | undefined;
    if (!def) return null;

    // Strictly ONE active instance per character visitorId!
    const existing = this.active.find((v) => v.def.id === visitorId);
    if (existing) {
      if (!isAutonomous) {
        this.store.notify(`${existing.persona.name} is already visiting!`, 'info');
      }
      return null;
    }

    const state = this.store.getState();
    this.navGrid = buildNavGrid(state, this.store.data);
    this.transport.syncEnvironment(state.sceneryViewId, state.gridWidth, state.gridDepth);

    const slotIdx = this.spawnCounter++;
    const route = this.transport.computeRoute(slotIdx);
    const variantIndex = this.nextVariantFor(visitorId);
    const persona = resolvePersona(def, variantIndex);
    const mesh = createVisitorVisualHandle(def, variantIndex);
    const isSpecial = Boolean(def.special || SPECIAL_CHARACTER_IDS.has(def.id));
    const isRickPortalArrival = def.id === 'rick';

    const usesDeferredVehicle =
      !isRickPortalArrival &&
      (route.kind === 'car' || route.kind === 'boat' || route.kind === 'elevator');

    let startX = route.stopPoint.wx;
    let startZ = route.stopPoint.wz;
    let startTile: GridCoord = { ...route.lotEdgeTile };

    if (isRickPortalArrival) {
      // Rick ALWAYS arrives via swirling green 3D Portal directly onto an open interior floor tile!
      startTile = this.pickOpenInteriorTile(state);
      const portalWorld = tileCenterToWorld(startTile.x, startTile.z, state.gridWidth, state.gridDepth);
      startX = portalWorld.wx;
      startZ = portalWorld.wz;
    }

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

    const initSpecialTimer =
      def.id === 'squeaky_chicken'
        ? 1.6 + Math.random() * 1.0
        : def.id === 'gojo'
          ? 7.0 + Math.random() * 4.0
          : def.id === 'baki'
            ? 4.2 + Math.random() * 2.4
            : def.id === 'shakespeare'
              ? 3.2 + Math.random() * 1.8
              : def.id === 'rick'
                ? 24 + Math.random() * 10
                : 0;

    const runtime: ActiveVisitorRuntime = {
      instanceId: nextVisitorInstanceId(),
      def,
      variantIndex,
      persona,
      mesh,
      isAutonomous,
      isSpecial,
      mood: initialMood,
      moodScore: initialScore,
      matchedInterests: affinity.matchedInterests,
      matchedDislikes: affinity.presentDislikedTags,
      thought: isRickPortalArrival
        ? '*burp* Nice little dimension you got here.'
        : usesDeferredVehicle
          ? `${route.arrivalLabel} to visit!`
          : 'Walking up the path to check this place out!',
      phase: isRickPortalArrival
        ? 'idle'
        : usesDeferredVehicle
          ? 'arriving_transport'
          : 'entering',
      pose: isRickPortalArrival ? 'idle' : 'walk',
      activity: isRickPortalArrival ? 'Stepping out of green portal' : route.arrivalLabel,
      worldX: startX,
      worldY: 0,
      worldZ: startZ,
      velX: 0,
      velZ: 0,
      smoothVelX: 0,
      smoothVelZ: 0,
      rotY: 0,
      targetYaw: 0,
      currentTile: startTile,
      path: [],
      pathTiles: [],
      exteriorPath: isRickPortalArrival ? [] : [...route.approachWaypoints],
      targetItemUid: null,
      targetTile: null,
      faceTarget: null,
      seatAnchor: null,
      seatBlend: 0,
      pendingRoute: isRickPortalArrival ? null : route,
      departureRoute: null,
      useTimer: 0,
      idleTimer: isRickPortalArrival ? 1.5 : 0.35,
      speechCooldown: usesDeferredVehicle ? 2.4 : 1.5,
      hasSpokenInitial: isRickPortalArrival,
      interactionBoost: 0,
      patienceRemaining: def.patienceSeconds,
      spawnPopTimer: usesDeferredVehicle ? 0 : 0.001,
      leavingPopTimer: 0,
      stuckExitTimer: 0,
      blockedProgressTimer: 0,
      replanCooldown: 0,
      yieldTimer: 0,
      stumbleTimer: 0,
      stumbleCooldown: 0,
      stumbleVx: 0,
      stumbleVz: 0,
      lastWaypointDist: Infinity,
      dismissedVoluntarily: false,
      bathroomCooldown: isSpecial ? 999 : 14 + Math.random() * 14,
      bathroomStage: 'none',
      bathroomTier: 'quick',
      spicyPuffTimer: 0,
      spicyEmoteTimer: 0,
      reliefMoodBonus: 0,
      annoyedMoodPenalty: 0,
      socialCooldown: isSpecial ? 28 + Math.random() * 12 : 5 + Math.random() * 6,
      socialPartnerId: null,
      socialTimer: 0,
      socialReplyDelay: 0,
      socialReplyPending: false,
      socialReplyEmoteId: 'smile',
      socialMoodBonus: 0,
      socialSavedPhase: null,
      specialState: isRickPortalArrival
        ? 'rick_portal_in'
        : def.id === 'john_wick'
          ? 'wick_seek'
          : def.id === 'homer'
            ? 'homer_eat'
            : 'none',
      specialTimer: initSpecialTimer,
      specialActionTimer: isRickPortalArrival ? 1.6 : 0,
      specialTargetId: null,
      specialCounter: def.id === 'rocky' ? 5 + Math.floor(Math.random() * 2) : 0,
      bardStareElapsed: 0,
      bardAnnoyedVictim: false,
      gojoHasMonologued: false,
      squeakPoseTimer: 0,
      ragdollTimer: 0,
      ragdollVx: 0,
      ragdollVz: 0,
      ragdollSpin: 0,
    };

    // Tag root and every descendant so Live Mode canvas raycasting cleanly identifies this visitor
    runtime.mesh.root.traverse((obj) => {
      obj.userData.visitorInstanceId = runtime.instanceId;
    });
    runtime.mesh.setMood(initialMood);

    if (isRickPortalArrival) {
      this.spawnGreenPortal(startX, startZ - 0.38, 0, 1.7);
      this.playSpecialSfxSafe('playPortalWarp');
      runtime.lastEmote = SPECIAL_EMOTES.portal.glyph;
      runtime.mesh.speechBubble.showEmote(SPECIAL_EMOTES.portal, 'happy', 3.4, 1.1);
      this.active.push(runtime);
      this.emitChange();
      return this.toSnapshot(runtime);
    }

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
      isSpecial: v.isSpecial,
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
    // Include active non-seated staff/bots so guests don't reserve a Bot's occupied tile!
    for (const s of this.staffRuntimes) {
      if (s.staff.id === excludeInstanceId || s.seatAnchor) continue;
      if (inGridBounds(s.currentTile.x, s.currentTile.z, this.navGrid.width, depth)) {
        reserved.add(tileIndex(s.currentTile.x, s.currentTile.z, depth));
      }
      if (s.targetTile && inGridBounds(s.targetTile.x, s.targetTile.z, this.navGrid.width, depth)) {
        reserved.add(tileIndex(s.targetTile.x, s.targetTile.z, depth));
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
    // Stationary/working Staff & Cozy Bots act as solid floor tile obstacles for pathfinding!
    for (const s of this.staffRuntimes) {
      if (s.staff.id === excludeInstanceId || s.seatAnchor) continue;
      if (this.isStaffAnchored(s)) {
        if (inGridBounds(s.currentTile.x, s.currentTile.z, this.navGrid.width, depth)) {
          occupied.add(tileIndex(s.currentTile.x, s.currentTile.z, depth));
        }
      }
    }
    return occupied;
  }

  private isStaffAnchored(s: ActiveStaffRuntime): boolean {
    return (
      s.phase === 'working' ||
      s.phase === 'recharging' ||
      s.phase === 'idle' ||
      s.phase === 'washing_hands' ||
      s.phase === 'on_break'
    );
  }

  private isSeatSlotTaken(itemUid: string, slotIndex: number, excludeInstanceId: string): boolean {
    for (const other of this.active) {
      if (other.instanceId === excludeInstanceId) continue;
      if (other.seatAnchor && other.seatAnchor.itemUid === itemUid && other.seatAnchor.slotIndex === slotIndex) {
        return true;
      }
    }
    for (const st of this.staffRuntimes) {
      if (st.staff.id === excludeInstanceId) continue;
      if (st.seatAnchor && st.seatAnchor.itemUid === itemUid && st.seatAnchor.slotIndex === slotIndex) {
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

  private handleHouseChanged(reason?: string): void {
    // P1 #8: Never rebuild nav grid or reset/replan leaving visitors on Running 24h timeOfDay ticks!
    if (reason === 'timeOfDay') {
      return;
    }

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
        // P1 #8: Never reset exterior exit path or Rick's departure portal on unrelated interior furniture edits!
        if (v.specialState === 'rick_portal_out' || (v.path.length === 0 && v.exteriorPath.length > 0)) {
          continue;
        }
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

    this.syncStaffWithStore(true);

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
    if (v.def.id === 'john_wick' && (v.specialState === 'wick_pet' || v.specialState === 'wick_done')) {
      v.mood = 'delighted';
      v.moodScore = 100;
      return false;
    }

    const state = this.store.getState();
    const affinity = this.evaluateRoomAffinity(v.def, state);

    if (dt > 0 && v.interactionBoost > 0) {
      v.interactionBoost = Math.max(0, v.interactionBoost - dt * 0.08);
    }
    if (dt > 0 && v.reliefMoodBonus > 0) {
      v.reliefMoodBonus = Math.max(0, v.reliefMoodBonus - dt * 0.14);
    }
    if (dt > 0 && v.socialMoodBonus > 0) {
      v.socialMoodBonus = Math.max(0, v.socialMoodBonus - dt * 0.12);
    }
    if (dt > 0 && v.annoyedMoodPenalty > 0) {
      v.annoyedMoodPenalty = Math.max(0, v.annoyedMoodPenalty - dt * 0.25);
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
      v.mesh.setMood(targetMood);
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

    const baseScore = this.computeMoodScore(
      v.mood,
      effectiveScore,
      v.patienceRemaining,
      v.def.patienceSeconds,
      v.dismissedVoluntarily,
      affinity.presentDislikedTags.length > 0,
    );
    const nextScore = Math.max(
      0,
      Math.min(100, Math.round(baseScore + v.reliefMoodBonus + v.socialMoodBonus - v.annoyedMoodPenalty)),
    );
    if (Math.abs(nextScore - v.moodScore) >= 3 || targetMood !== prevMood) {
      v.moodScore = nextScore;
      stateChanged = true;
    }

    if (
      !v.socialPartnerId &&
      v.bathroomStage === 'none' &&
      !v.isSpecial &&
      (targetMood !== prevMood || prevMatchedKey !== nextMatchedKey || prevDislikedKey !== nextDislikedKey)
    ) {
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
    v.bathroomStage = 'none';
    this.endSocializingFor(v);

    // Cleanly clear Gojo caption / aura / voice / dramatic camera follow if leaving mid-ascension
    if (this.activeCaptionOwnerId === v.instanceId) {
      this.emitCaption(null);
      this.stopGojoVoiceAudio();
    }
    this.releaseGojoCameraFollow(v.instanceId);
    v.mesh.specialRig?.setAuraActive?.(false);

    // Rick Sanchez ALWAYS departs through a swirling neon-green 3D portal right beside him!
    if (v.def.id === 'rick') {
      v.specialState = 'rick_portal_out';
      v.specialActionTimer = 1.45;
      v.path = [];
      v.pathTiles = [];
      v.exteriorPath = [];
      v.pose = 'idle';
      v.activity = 'Opening green exit portal';
      v.thought = '*burp* Peace out, dimension C-137!';
      v.lastEmote = SPECIAL_EMOTES.portal.glyph;
      v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.portal, 'happy', 2.4, 0.8);
      const px = v.worldX + Math.sin(v.rotY) * 0.42;
      const pz = v.worldZ + Math.cos(v.rotY) * 0.42;
      this.spawnGreenPortal(px, pz, v.rotY + Math.PI, 1.55);
      this.playSpecialSfxSafe('playPortalWarp');
      if (!quietEmit) {
        this.emitChange();
      }
      return;
    }

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

    // Special Character signature destination logic (John Wick, Homer, Philosopher, Rocky, Rick, Viking)
    if (v.isSpecial && this.pickSpecialDestination(v, state, reachable, reservedTiles)) {
      return;
    }

    // Funny bathroom break: when toilet_cozy is placed & free and cooldown elapsed, take a quick pit stop!
    if (v.bathroomCooldown <= 0 && v.bathroomStage === 'none') {
      const toiletPick = this.findAvailableToilet(state, reachable, reservedTiles, v.instanceId);
      if (toiletPick && Math.random() < 0.55) {
        if (this.startBathroomVisit(v, toiletPick.item, toiletPick.tile, toiletPick.faceWorld, state)) {
          return;
        }
      }
    }

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

      // Reserve toilet_cozy for dedicated funny bathroom pit stops rather than generic lounging
      if (item.itemId === 'toilet_cozy') {
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

    if (candidates.length === 0 && v.bathroomStage === 'none' && v.bathroomCooldown <= 16) {
      const fallbackToilet = this.findAvailableToilet(state, reachable, reservedTiles, v.instanceId);
      if (
        fallbackToilet &&
        this.startBathroomVisit(v, fallbackToilet.item, fallbackToilet.tile, fallbackToilet.faceWorld, state)
      ) {
        return;
      }
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
      // Dedicated funny 3-tier bathroom visit flow (Quick Pit Stop / Reading Break / Spicy Emergency!)
      if (item.itemId === 'toilet_cozy' || v.bathroomStage === 'going_toilet') {
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
          v.bathroomStage = 'on_toilet';
          v.targetYaw = seatAnchor.facingYaw;

          if (v.bathroomTier === 'spicy') {
            v.activity = 'SPICY EMERGENCY!!';
            v.thought = 'EMERGENCY!! OUTTA MY WAY!';
            v.useTimer = 5.2 + Math.random() * 1.2;
            v.spicyPuffTimer = 0.35;
            v.spicyEmoteTimer = 0.5;
            const agony = BATHROOM_SPICY_AGONY_EMOTES[0];
            v.lastEmote = agony.glyph;
            v.mesh.speechBubble.showEmote(agony, 'bored', 3.4, 0.9);
            this.spawnStinkPuff(seatAnchor.wx, seatAnchor.wz);
          } else if (v.bathroomTier === 'reading') {
            v.activity = 'Reading break in restroom';
            v.thought = 'Gonna be a minute…';
            v.useTimer = 5.4 + Math.random() * 1.6;
            v.lastEmote = BATHROOM_EMOTE_TOILET.glyph;
            v.mesh.speechBubble.showEmote(BATHROOM_EMOTE_TOILET, v.mood, 3.8, 0.9);
          } else {
            v.activity = 'Quick pit stop';
            v.thought = 'Quick pit stop!';
            v.useTimer = 3.5 + Math.random() * 1.0;
            const quickEmote = Math.random() < 0.5 ? BATHROOM_EMOTE_QUICK : BATHROOM_EMOTE_RELIEVED;
            v.lastEmote = quickEmote.glyph;
            v.mesh.speechBubble.showEmote(quickEmote, v.mood, 3.4, 0.85);
          }
          this.emitChange();
          return;
        }
        v.bathroomStage = 'none';
      }

      if (item.itemId === 'bathroom_sink' && v.bathroomStage === 'going_sink') {
        v.phase = 'using';
        v.pose = 'work';
        v.bathroomStage = 'washing_hands';
        v.activity = 'Washing hands';
        v.thought = 'Washing up nice and clean!';
        v.useTimer = 2.2 + Math.random() * 0.6;
        v.lastEmote = BATHROOM_EMOTE_BUBBLE.glyph;
        v.mesh.speechBubble.showEmote(BATHROOM_EMOTE_BUBBLE, v.mood, 2.8, 0.8);
        this.audioModule?.playInteract('bathroom_sink', ['bathroom'], true);
        this.emitChange();
        return;
      }

      // Special Character custom arrival handlers (Philosopher, John Wick, Homer, Viking, Rocky, Rick)
      if (v.isSpecial && this.handleSpecialArrival(v, item, def, state)) {
        return;
      }

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

    if (v.def.id === 'rocky') {
      v.specialCounter = Math.max(0, v.specialCounter - 1);
      v.phase = 'using';
      v.pose = 'admire';
      v.useTimer = 1.3 + Math.random() * 0.4;
      const quote = ROCKY_QUOTES[Math.floor(Math.random() * ROCKY_QUOTES.length)];
      const e = Math.random() < 0.5 ? SPECIAL_EMOTES.spider : SPECIAL_EMOTES.music;
      v.activity = 'Scurrying & jazz hands!';
      v.thought = quote;
      v.lastEmote = e.glyph;
      v.mesh.speechBubble.showEmote(e, 'delighted', 2.4, 0.9);
      this.playSpecialSfxSafe('playRockyChords');
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

      let triggered = false;
      for (const v of this.active) {
        if (v.phase === 'arriving_transport' || v.leavingPopTimer > 0) continue;
        if (Math.hypot(v.worldX - wt.wx, v.worldZ - wt.wz) <= DOOR_TRIGGER_RADIUS) {
          nearNow.add(door.item.uid);
          if (!this.doorHoldTimers.has(door.item.uid)) {
            this.setDoorVisitorOpenSafe(door.item.uid, true);
            this.audioModule?.playInteract(door.item.itemId, ['door'], true);
          }
          this.doorHoldTimers.set(door.item.uid, DOOR_HOLD_SECONDS);
          triggered = true;
          break;
        }
      }
      if (!triggered) {
        for (const s of this.staffRuntimes) {
          if (Math.hypot(s.worldX - wt.wx, s.worldZ - wt.wz) <= DOOR_TRIGGER_RADIUS) {
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
   * Spawns autonomous regular visitors organically when Open, PLUS runs the decaying
   * autonomous Legendary Special Character spawner (~2 min initial interval × 1.45 decay).
   */
  private updateAutonomousSpawner(dt: number, state: HouseState): void {
    // Only spawn autonomous regular & special visitors when door policy is strictly 'open'
    if (this.getDoorPolicy() !== 'open') return;
    if (this.visitorDefs.length === 0) return;

    // 1. Decaying Autonomous Legendary Special Character Spawner (120s -> 174s -> 252s ...)
    const specialDefs = this.visitorDefs.filter((d) => SPECIAL_CHARACTER_IDS.has(d.id));
    if (specialDefs.length > 0) {
      this.specialSpawnTimer -= dt;
      if (this.specialSpawnTimer <= 0) {
        const activeIds = new Set(this.active.map((v) => v.def.id));
        const activeSpecials = this.active.filter(
          (v) => v.isSpecial && v.phase !== 'leaving' && v.phase !== 'waiting_pickup',
        ).length;
        if (activeSpecials < 2 && this.active.length < 10) {
          const freshSpecials = specialDefs.filter((d) => !activeIds.has(d.id));
          if (freshSpecials.length > 0) {
            const chosenSpecial = freshSpecials[Math.floor(Math.random() * freshSpecials.length)];
            if (chosenSpecial) {
              this.spawnVisitorInternal(chosenSpecial.id, true);
            }
          }
        }
        this.specialSpawnInterval = Math.min(
          MAX_SPECIAL_SPAWN_INTERVAL,
          this.specialSpawnInterval * SPECIAL_SPAWN_DECAY,
        );
        this.specialSpawnTimer = this.specialSpawnInterval + (Math.random() * 30 - 15);
      }
    }

    // 2. Regular Cozy Visitor Autonomous Spawner (strictly excludes special: true & already-visiting archetypes!)
    const regularDefs = this.visitorDefs.filter(
      (d) => !(d as VisitorDefWithPersonas).special && !SPECIAL_CHARACTER_IDS.has(d.id),
    );
    if (regularDefs.length === 0) return;

    const autoCount = this.active.filter(
      (v) => v.isAutonomous && !v.isSpecial && v.phase !== 'leaving' && v.phase !== 'waiting_pickup',
    ).length;

    if (autoCount >= MAX_AUTONOMOUS_VISITORS || this.active.length >= 8) {
      return;
    }

    this.autonomousSpawnTimer -= dt;
    if (this.autonomousSpawnTimer > 0) return;

    const activeIds = new Set(this.active.map((v) => v.def.id));
    const availableRegular = regularDefs.filter((d) => !activeIds.has(d.id));
    if (availableRegular.length === 0) {
      this.autonomousSpawnTimer = 8 + Math.random() * 6;
      return;
    }

    const likedDefs: VisitorDef[] = [];
    const dislikedOrVariedDefs: VisitorDef[] = [];

    for (const def of availableRegular) {
      const aff = this.evaluateRoomAffinity(def, state);
      if (aff.likedScore > 0 && aff.dislikedScore === 0) {
        likedDefs.push(def);
      }
      if (aff.dislikedScore > 0 || aff.likedScore < 1.2) {
        dislikedOrVariedDefs.push(def);
      }
    }

    const preferMatch = Math.random() < 0.65;
    const pool = preferMatch
      ? likedDefs.length > 0
        ? likedDefs
        : availableRegular
      : dislikedOrVariedDefs.length > 0
        ? dislikedOrVariedDefs
        : availableRegular;

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
    simSpeed = 1,
  ): { steerX: number; steerZ: number; speedFactor: number } {
    let steerX = 0;
    let steerZ = 0;
    let speedFactor = 1.0;

    // At 5x max speed, keep avoidance slightly looser so sprinting guests can playfully bump!
    const highSpeedFactor = simSpeed >= 5 ? 0.52 : 1.0;
    const inNarrowSpot = isTightCorridor(this.navGrid, v.worldX, v.worldZ, desiredDirX, desiredDirZ);

    for (const other of this.active) {
      if (other.instanceId === v.instanceId) continue;
      if (other.leavingPopTimer > 0 || other.phase === 'arriving_transport') continue;
      if (other.seatAnchor) continue;

      const rx = v.worldX - other.worldX;
      const rz = v.worldZ - other.worldZ;
      const dist = Math.hypot(rx, rz);

      if (dist >= AVOIDANCE_RADIUS) continue;

      const nx = dist > 0.001 ? rx / dist : v.instanceId < other.instanceId ? 1 : -1;
      const nz = dist > 0.001 ? rz / dist : 0;

      // Positive aheadDot means `other` lies in front of `v`
      const aheadDot = -(nx * desiredDirX + nz * desiredDirZ);

      // Right-hand-rule lateral tangent relative to separation line:
      // two oncoming visitors automatically curve to opposite shoulders instead of stalling nose-to-nose!
      const tangX = nz;
      const tangZ = -nx;

      if (aheadDot > -0.15) {
        const proximity = (AVOIDANCE_RADIUS - dist) / AVOIDANCE_RADIUS;
        const headOnBoost = aheadDot > 0.55 ? 1.35 : 1.0;
        const tangStrength = proximity * 1.65 * headOnBoost * highSpeedFactor;
        steerX += tangX * tangStrength;
        steerZ += tangZ * tangStrength;
      }

      // Gentle radial push only inside tight PERSONAL_SPACE (never pushing straight backward into deadlock)
      if (dist < PERSONAL_SPACE) {
        const overlap = (PERSONAL_SPACE - dist) / PERSONAL_SPACE;
        let pushX = nx * 1.15 * overlap * highSpeedFactor;
        let pushZ = nz * 1.15 * overlap * highSpeedFactor;
        const backDot = pushX * desiredDirX + pushZ * desiredDirZ;
        if (backDot < 0) {
          // Redirect backward component smoothly into lateral passing tangent!
          pushX -= desiredDirX * backDot * 0.72;
          pushZ -= desiredDirZ * backDot * 0.72;
        }
        steerX += pushX;
        steerZ += pushZ;
      }

      // Only yield briefly if genuinely jammed head-on in a tight 1-tile doorway
      const otherSpeed = Math.hypot(other.smoothVelX, other.smoothVelZ);
      if (
        simSpeed < 5 &&
        inNarrowSpot &&
        v.blockedProgressTimer > 0.45 &&
        dist < PERSONAL_SPACE + 0.06 &&
        otherSpeed > 0.25 &&
        aheadDot > 0.65
      ) {
        const otherDirX = other.smoothVelX / otherSpeed;
        const otherDirZ = other.smoothVelZ / otherSpeed;
        const opposing = desiredDirX * otherDirX + desiredDirZ * otherDirZ < -0.5;
        if (opposing) {
          const shouldYield =
            v.phase !== 'leaving' &&
            (other.phase === 'leaving' || v.instanceId < other.instanceId);
          if (shouldYield && v.yieldTimer <= 0) {
            v.yieldTimer = 0.35;
          }
        }
      }
    }

    // Solid-blocker steering around ALL active Cozy Bots & Human Staff (100% lateral sidestep on visitor!)
    for (const s of this.staffRuntimes) {
      if (s.seatAnchor) continue;
      const rx = v.worldX - s.worldX;
      const rz = v.worldZ - s.worldZ;
      const dist = Math.hypot(rx, rz);
      if (dist >= STAFF_AVOIDANCE_RADIUS) continue;

      const nx = dist > 0.001 ? rx / dist : 1;
      const nz = dist > 0.001 ? rz / dist : 0;
      const aheadDot = -(nx * desiredDirX + nz * desiredDirZ);

      // Steer smoothly around the side of the Bot with clear right-hand preference
      const tangX = nz;
      const tangZ = -nx;
      const proximity = (STAFF_AVOIDANCE_RADIUS - dist) / STAFF_AVOIDANCE_RADIUS;

      if (aheadDot > -0.2) {
        const headOnBoost = aheadDot > 0.5 ? 1.65 : 1.15;
        const tangStrength = proximity * 2.2 * headOnBoost;
        steerX += tangX * tangStrength;
        steerZ += tangZ * tangStrength;
      }

      if (dist < STAFF_PERSONAL_SPACE + 0.08) {
        const overlap = (STAFF_PERSONAL_SPACE + 0.08 - dist) / (STAFF_PERSONAL_SPACE + 0.08);
        let pushX = nx * 1.65 * overlap;
        let pushZ = nz * 1.65 * overlap;
        const backDot = pushX * desiredDirX + pushZ * desiredDirZ;
        if (backDot < 0) {
          pushX -= desiredDirX * backDot * 0.78;
          pushZ -= desiredDirZ * backDot * 0.78;
        }
        steerX += pushX;
        steerZ += pushZ;
      }
    }

    const steerMag = Math.hypot(steerX, steerZ);
    const maxSteer = this.staffRuntimes.length > 0 ? Math.max(MAX_SEPARATION_SPEED, 1.35) : MAX_SEPARATION_SPEED;
    if (steerMag > maxSteer) {
      const s = maxSteer / steerMag;
      steerX *= s;
      steerZ *= s;
    }

    return { steerX, steerZ, speedFactor };
  }

  /**
   * Playful 5x max-speed bump / knock-back easter egg:
   * when running at >= 5x and two walking guests actually collide (< 0.40 u) closing fast,
   * both do a brief 0.48s cartoon wobble + safe wall-clamped knock-back with a 😵‍💫/😮 emote!
   */
  private detectHighSpeedBumps(simSpeed: number): boolean {
    if (simSpeed < 5 || this.active.length < 2) return false;
    let bumped = false;

    const isWalkingPhase = (p: VisitorPhase) =>
      p === 'walking' || p === 'entering' || p === 'leaving';

    for (let i = 0; i < this.active.length; i++) {
      const a = this.active[i];
      if (!isWalkingPhase(a.phase) || a.seatAnchor || a.leavingPopTimer > 0) continue;
      if (a.stumbleTimer > 0 || a.stumbleCooldown > 0) continue;

      for (let j = i + 1; j < this.active.length; j++) {
        const b = this.active[j];
        if (!isWalkingPhase(b.phase) || b.seatAnchor || b.leavingPopTimer > 0) continue;
        if (b.stumbleTimer > 0 || b.stumbleCooldown > 0) continue;

        const dx = b.worldX - a.worldX;
        const dz = b.worldZ - a.worldZ;
        const dist = Math.hypot(dx, dz);
        if (dist >= STUMBLE_COLLISION_DIST) continue;

        const nx = dist > 0.001 ? dx / dist : i % 2 === 0 ? 1 : -1;
        const nz = dist > 0.001 ? dz / dist : 0;
        const closingSpeed = (a.velX - b.velX) * nx + (a.velZ - b.velZ) * nz;
        if (closingSpeed < 1.15) continue;

        // Impulse spreads the pair ~0.35 units apart smoothly over the first ~0.24s of the 0.48s stumble
        const knockSpeed = 1.48;
        a.stumbleTimer = STUMBLE_DURATION;
        a.stumbleCooldown = STUMBLE_COOLDOWN;
        a.stumbleVx = -nx * knockSpeed;
        a.stumbleVz = -nz * knockSpeed;
        a.pose = 'stumble';
        a.blockedProgressTimer = 0;

        b.stumbleTimer = STUMBLE_DURATION;
        b.stumbleCooldown = STUMBLE_COOLDOWN;
        b.stumbleVx = nx * knockSpeed;
        b.stumbleVz = nz * knockSpeed;
        b.pose = 'stumble';
        b.blockedProgressTimer = 0;

        const emoteA = BUMP_EMOTES[0];
        const emoteB = BUMP_EMOTES[1];
        a.lastEmote = emoteA.glyph;
        b.lastEmote = emoteB.glyph;
        a.mesh.speechBubble.showEmote(emoteA, a.mood, 2.2, 0.7);
        b.mesh.speechBubble.showEmote(emoteB, b.mood, 2.2, 0.7);
        bumped = true;
        break;
      }
    }

    return bumped;
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
    const staffCount = this.staffRuntimes.length;
    if (count + staffCount < 2) return;

    const maxPushStep = MAX_SEPARATION_SPEED * Math.max(dt, 1 / 60);

    for (let iter = 0; iter < 2; iter++) {
      // 1. Visitor <-> Visitor separation
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

      // 2. Visitor <-> Staff/Bot solid-blocker separation
      // Anchored working Bots take 0% push — 100% of separation impulse goes to the visitor!
      for (let i = 0; i < count; i++) {
        const v = this.active[i];
        if (v.leavingPopTimer > 0 || v.phase === 'arriving_transport' || v.seatAnchor) continue;
        const allowOutV = v.phase === 'entering' || v.phase === 'leaving' || v.phase === 'waiting_pickup';

        for (let k = 0; k < staffCount; k++) {
          const s = this.staffRuntimes[k];
          if (s.seatAnchor) continue;

          const dx = v.worldX - s.worldX;
          const dz = v.worldZ - s.worldZ;
          const dist = Math.hypot(dx, dz);
          if (dist >= STAFF_PERSONAL_SPACE) continue;

          const nx = dist > 0.001 ? dx / dist : 1;
          const nz = dist > 0.001 ? dz / dist : 0;
          const anchored = this.isStaffAnchored(s);
          // Full solid-blocker push against anchored bots so visitors never clip through!
          const overlap = anchored
            ? STAFF_PERSONAL_SPACE - dist
            : Math.min(STAFF_PERSONAL_SPACE - dist, maxPushStep * 2.2);

          const weightV = anchored ? 1.0 : 0.5;
          const weightS = 1 - weightV;

          if (weightV > 0) {
            const safeV = resolveSafeMovement(
              this.navGrid,
              v.worldX,
              v.worldZ,
              v.worldX + nx * overlap * weightV,
              v.worldZ + nz * overlap * weightV,
              allowOutV,
            );
            v.worldX = safeV.wx;
            v.worldZ = safeV.wz;
            v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
          }

          if (weightS > 0) {
            const safeS = resolveSafeMovement(
              this.navGrid,
              s.worldX,
              s.worldZ,
              s.worldX - nx * overlap * weightS,
              s.worldZ - nz * overlap * weightS,
              false,
            );
            s.worldX = safeS.wx;
            s.worldZ = safeS.wz;
            s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
          }
        }
      }

      // 3. Staff <-> Staff separation (anchored bots stay firmly planted on their station!)
      for (let i = 0; i < staffCount; i++) {
        const a = this.staffRuntimes[i];
        if (a.seatAnchor) continue;
        for (let j = i + 1; j < staffCount; j++) {
          const b = this.staffRuntimes[j];
          if (b.seatAnchor) continue;

          const dx = b.worldX - a.worldX;
          const dz = b.worldZ - a.worldZ;
          const dist = Math.hypot(dx, dz);
          if (dist >= STAFF_PERSONAL_SPACE) continue;

          const nx = dist > 0.001 ? dx / dist : i % 2 === 0 ? 1 : -1;
          const nz = dist > 0.001 ? dz / dist : 0;
          const aAnchored = this.isStaffAnchored(a);
          const bAnchored = this.isStaffAnchored(b);
          if (aAnchored && bAnchored) continue;

          const weightA = aAnchored ? 0.0 : bAnchored ? 1.0 : 0.5;
          const weightB = 1 - weightA;
          const overlap = Math.min(STAFF_PERSONAL_SPACE - dist, maxPushStep * 2.2);

          if (weightA > 0) {
            const safeA = resolveSafeMovement(
              this.navGrid,
              a.worldX,
              a.worldZ,
              a.worldX - nx * overlap * weightA,
              a.worldZ - nz * overlap * weightA,
              false,
            );
            a.worldX = safeA.wx;
            a.worldZ = safeA.wz;
            a.mesh.root.position.set(a.worldX, a.worldY, a.worldZ);
          }
          if (weightB > 0) {
            const safeB = resolveSafeMovement(
              this.navGrid,
              b.worldX,
              b.worldZ,
              b.worldX + nx * overlap * weightB,
              b.worldZ + nz * overlap * weightB,
              false,
            );
            b.worldX = safeB.wx;
            b.worldZ = safeB.wz;
            b.mesh.root.position.set(b.worldX, b.worldY, b.worldZ);
          }
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

    // Update biome vehicles, persistent elevator kiosk, Rick's portals, & Spicy cartoon stink puffs
    this.transport.update(dt);
    this.updateVisualEffects(dt);

    // Wall-clock 25s Random Special Character cooldown completion edge (never stalls at 0x or flickers!)
    let cooldownFinished = false;
    if (!this.randomSpecialCooldownNotifiedZero && this.getRandomSpecialCooldownRemaining() === 0) {
      this.randomSpecialCooldownNotifiedZero = true;
      cooldownFinished = true;
    }

    // Organic autonomous guest & decaying special character spawning when house is Open
    this.updateAutonomousSpawner(dt, state);

    const staffChanged = this.updateStaff(dt, state);

    if (this.active.length === 0) {
      if (this.staffRuntimes.length >= 2) {
        this.enforcePersonalSpace(dt);
      }
      // Ensure doors open/close for staff or close cleanly if last guest left
      if (this.staffRuntimes.length > 0 || this.doorHoldTimers.size > 0) {
        this.updateDoorProximity(dt, state);
      }
      if (staffChanged) {
        this.emitStaffChange();
      } else if (cooldownFinished) {
        this.emitChange();
      }
      return;
    }

    const toRemove: ActiveVisitorRuntime[] = [];
    let anyChanged = staffChanged || cooldownFinished;
    const velSmoothAlpha = 1 - Math.exp(-10 * dt);
    const simSpeed = this.store.getSimSpeed();

    for (const v of this.active) {
      v.speechCooldown = Math.max(0, v.speechCooldown - dt);
      v.replanCooldown = Math.max(0, v.replanCooldown - dt);
      v.stumbleCooldown = Math.max(0, v.stumbleCooldown - dt);
      v.bathroomCooldown = Math.max(0, v.bathroomCooldown - dt);
      v.socialCooldown = Math.max(0, v.socialCooldown - dt);

      // Waiting inside incoming car/boat/elevator until transport reaches curb/pier/terrace
      if (v.phase === 'arriving_transport') {
        continue;
      }

      // Hilarious spinning ragdoll flight (when kicked by Baki Hanma!) — wall-clamped bounces + dizzy recovery
      if (v.ragdollTimer > 0) {
        const ragdollDone = this.updateVisitorRagdoll(v, dt, state);
        if (ragdollDone) anyChanged = true;
        continue;
      }

      // Legendary Special Character signature behaviors (Squeaky Chicken, Gojo, Baki, Shakespeare, Rick portals!)
      if (v.isSpecial) {
        const specialOutcome = this.updateSpecialCharacterBehavior(v, dt, state, toRemove);
        if (specialOutcome.changed) anyChanged = true;
        if (specialOutcome.handled) continue;
      }

      // Active visitor-to-visitor socializing (delayed reply + standing face-to-face pause!)
      if (v.socialPartnerId) {
        const partner = this.active.find((o) => o.instanceId === v.socialPartnerId);
        if (
          !partner ||
          partner.phase === 'leaving' ||
          partner.leavingPopTimer > 0 ||
          Math.hypot(partner.worldX - v.worldX, partner.worldZ - v.worldZ) > SOCIAL_RADIUS + 0.65
        ) {
          this.endSocializingFor(v);
          anyChanged = true;
        } else {
          v.socialTimer -= dt;
          if (v.socialReplyPending) {
            v.socialReplyDelay -= dt;
            if (v.socialReplyDelay <= 0) {
              v.socialReplyPending = false;
              const replyEmote =
                SOCIAL_REPLY_EMOTES.find((e) => e.id === v.socialReplyEmoteId) ??
                SOCIAL_REPLY_EMOTES[0];
              const line = this.dialogueEngine.pickLine(v.def.id, v.mood, v.lastLineId);
              const blabber = estimateBlabberDuration(line.text, line.speedMultiplier);
              v.lastLineId = line.id;
              v.lastEmote = resolveEmoteEmoji(replyEmote.id, replyEmote.glyph, v.mood);
              v.mesh.speechBubble.showEmote(replyEmote, v.mood, 3.4, blabber);
              this.audioModule?.playGibberishLine(
                line.text,
                v.def.voiceProfile,
                Math.min(1.18, line.pitchOffset + 0.04),
                line.speedMultiplier,
              );
              anyChanged = true;
            }
          }

          if (v.socialTimer <= 0) {
            this.endSocializingFor(v);
            anyChanged = true;
          } else if (!v.seatAnchor) {
            // Standing chat: gently turn to face partner & animate lively conversation
            v.velX = 0;
            v.velZ = 0;
            v.smoothVelX = 0;
            v.smoothVelZ = 0;
            const dxP = partner.worldX - v.worldX;
            const dzP = partner.worldZ - v.worldZ;
            if (Math.hypot(dxP, dzP) > 0.05) {
              v.targetYaw = Math.atan2(dxP, dzP);
              v.rotY = dampAngle(v.rotY, v.targetYaw, 8, dt);
              v.mesh.root.rotation.y = v.rotY;
            }
            v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
            v.mesh.updateAnimation(dt, 'admire', v.def.walkSpeed);
            this.updateVisitorMood(v, dt);
            continue;
          }
        }
      }

      // Active 5x cartoon stumble/knock-back recovery (safe wall & City-parapet clamped!)
      if (v.stumbleTimer > 0) {
        v.stumbleTimer = Math.max(0, v.stumbleTimer - dt);
        const progress = 1 - v.stumbleTimer / STUMBLE_DURATION;
        // Decelerate knock-back impulse smoothly over the first half of the stumble
        const decay = progress < 0.5 ? 1 - progress * 2 : 0;
        if (decay > 0) {
          const nextWx = v.worldX + v.stumbleVx * decay * dt;
          const nextWz = v.worldZ + v.stumbleVz * decay * dt;
          const allowOut = v.phase === 'entering' || v.phase === 'leaving';
          const safe = resolveSafeMovement(this.navGrid, v.worldX, v.worldZ, nextWx, nextWz, allowOut);
          v.worldX = safe.wx;
          v.worldZ = safe.wz;
          this.clampToCityTerrace(v, state);
        }
        v.velX = 0;
        v.velZ = 0;
        v.smoothVelX = 0;
        v.smoothVelZ = 0;
        v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
        v.mesh.updateAnimation(dt, 'stumble', v.def.walkSpeed);
        if (v.stumbleTimer <= 0) {
          v.pose = 'walk';
          v.stumbleVx = 0;
          v.stumbleVz = 0;
        }
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
          const fx = Math.floor(v.worldX + state.gridWidth / 2);
          const fz = Math.floor(v.worldZ + state.gridDepth / 2);
          if (inGridBounds(fx, fz, state.gridWidth, state.gridDepth)) {
            v.currentTile = { x: fx, z: fz };
          }

          if (v.bathroomStage === 'on_toilet') {
            // Optional stop by bathroom_sink to wash hands with 🫧, otherwise celebrate relief immediately!
            const reachable = computeReachableDistances(this.navGrid, v.currentTile);
            const reserved = this.getReservedTiles(v.instanceId);
            const sinkPick = this.findReachableBathroomSink(state, reachable, reserved);
            if (sinkPick) {
              const pathTiles = this.computePathAvoidingVisitors(v, sinkPick.tile);
              if (pathTiles && pathTiles.length > 0) {
                v.phase = 'walking';
                v.pose = 'walk';
                v.bathroomStage = 'going_sink';
                v.targetItemUid = sinkPick.item.uid;
                v.targetTile = sinkPick.tile;
                v.faceTarget = sinkPick.faceWorld;
                v.pathTiles = pathTiles;
                v.path = pathTiles.map((t) =>
                  tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
                );
                v.blockedProgressTimer = 0;
                v.lastWaypointDist = Infinity;
                v.activity = 'Going to wash hands';
                v.thought = 'Time to wash my hands!';
                anyChanged = true;
                continue;
              }
            }
            this.completeBathroomRelief(v, state);
            anyChanged = true;
            continue;
          }

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

          const avoid = this.computeAvoidanceVector(v, desiredDirX, desiredDirZ, simSpeed);

          let moveDirX = desiredDirX + avoid.steerX;
          let moveDirZ = desiredDirZ + avoid.steerZ;
          const moveMag = Math.hypot(moveDirX, moveDirZ);
          if (moveMag > 0.001) {
            moveDirX /= moveMag;
            moveDirZ /= moveMag;
          }

          const specialSpeedMult =
            v.def.id === 'rocky'
              ? 1.8
              : v.bathroomStage === 'going_toilet' && v.bathroomTier === 'spicy'
                ? 1.55
                : 1.0;
          const speed = v.def.walkSpeed * specialSpeedMult * avoid.speedFactor;
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
          const walkPose: VisitorPose | SpecialPose =
            v.squeakPoseTimer > 0 ? 'squeak' : smoothSpeed > 0.08 ? 'walk' : 'idle';
          v.mesh.updateAnimation(dt, walkPose, speed);

          // Fast anti-stall recovery: smoothly sidestep or replan if blocked > 0.75s
          const newDist = Math.hypot(nextWp.wx - v.worldX, nextWp.wz - v.worldZ);
          if (newDist >= v.lastWaypointDist - 0.004) {
            v.blockedProgressTimer += dt;
            if (v.blockedProgressTimer > 0.75 && v.replanCooldown <= 0) {
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
          let tremorX = 0;
          if (v.bathroomStage === 'on_toilet' && v.bathroomTier === 'spicy') {
            tremorX = Math.sin(performance.now() * 0.048) * 0.032;
            v.spicyPuffTimer -= dt;
            if (v.spicyPuffTimer <= 0) {
              v.spicyPuffTimer = 1.15 + Math.random() * 0.5;
              this.spawnStinkPuff(v.seatAnchor.wx, v.seatAnchor.wz);
            }
            v.spicyEmoteTimer -= dt;
            if (v.spicyEmoteTimer <= 0) {
              v.spicyEmoteTimer = 1.35 + Math.random() * 0.4;
              const agony =
                BATHROOM_SPICY_AGONY_EMOTES[
                  Math.floor(Math.random() * BATHROOM_SPICY_AGONY_EMOTES.length)
                ];
              v.lastEmote = agony.glyph;
              v.mesh.speechBubble.showEmote(agony, 'bored', 2.4, 0.7);
              anyChanged = true;
            }
          }
          v.mesh.root.position.set(v.seatAnchor.wx + tremorX, v.seatAnchor.wy, v.seatAnchor.wz);
          const seatedPose: VisitorPose | SpecialPose =
            v.pose === 'thinker' || v.pose === 'sleep' ? v.pose : 'sit';
          v.mesh.updateAnimation(dt, seatedPose, v.def.walkSpeed, 1, v.seatAnchor.wy);
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
          const activePose: VisitorPose | SpecialPose =
            v.squeakPoseTimer > 0 ? 'squeak' : v.pose;
          v.mesh.updateAnimation(dt, activePose, v.def.walkSpeed, 0, 0);
        }

        v.useTimer -= dt;
        if (v.useTimer <= 0) {
          if (v.bathroomStage === 'on_toilet') {
            // Play gentle toilet flush water foley before standing up!
            this.audioModule?.playInteract('toilet_cozy', ['bathroom'], true);
          }

          // John Wick becomes ecstatic after petting the kitty and calmly walks straight out the front door!
          if (v.def.id === 'john_wick' && v.specialState === 'wick_pet') {
            v.specialState = 'wick_done';
            v.mood = 'delighted';
            v.moodScore = 100;
            v.thought = "Good kitty. Very good kitty. Yeah, I'm happy.";
            v.dismissedVoluntarily = true;
            this.beginLeaving(v, 'Mission accomplished — heading out');
            anyChanged = true;
            continue;
          }

          // Rocky zips happily out the front door after exploring 5–6 points!
          if (v.def.id === 'rocky' && v.specialCounter <= 0) {
            v.dismissedVoluntarily = true;
            v.thought = 'Amaze! Amaze! Heading back to Hail Mary!';
            this.beginLeaving(v, 'Amaze! Zipping home!');
            anyChanged = true;
            continue;
          }

          // Homer finishes voracious snacking -> immediately waddles to bed/couch for a big nap!
          if (v.def.id === 'homer' && v.specialState === 'homer_eat') {
            v.specialState = 'homer_sleep';
            v.phase = 'idle';
            v.pose = 'idle';
            v.targetItemUid = null;
            v.targetTile = null;
            v.idleTimer = 0.2;
            v.activity = 'Looking for a nap spot';
            v.thought = 'Oof… time for a quick couch snooze…';
            anyChanged = true;
            continue;
          }

          if (v.bathroomStage === 'washing_hands') {
            this.completeBathroomRelief(v, state);
            anyChanged = true;
          } else if (v.seatAnchor) {
            if (v.def.id === 'homer' && v.specialState === 'homer_sleep') {
              v.specialState = 'homer_eat';
            }
            v.phase = 'dismounting_seat';
            v.seatBlend = 1;
          } else {
            v.phase = 'idle';
            v.pose = 'idle';
            v.targetItemUid = null;
            v.targetTile = null;
            v.idleTimer = v.def.id === 'rocky' ? 0.15 : 0.55 + Math.random() * 1.1;
            v.activity = 'Looking around';
            if (!v.isSpecial) {
              v.thought = this.buildContextualThought(v, this.evaluateRoomAffinity(v.def, state));
            }
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

    // Organic visitor-to-visitor socializing when nearby with clear line of sight
    if (this.tryStartSocializing()) {
      anyChanged = true;
    }

    // Playful 5x max-speed head-on bump / knock-back check BEFORE hard separation
    if (this.detectHighSpeedBumps(simSpeed)) {
      anyChanged = true;
    }

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
        if (this.activeCaptionOwnerId === rem.instanceId) {
          this.emitCaption(null);
          this.stopGojoVoiceAudio();
        }
        this.releaseGojoCameraFollow(rem.instanceId);
        this.visitorsRoot.remove(rem.mesh.root);
        rem.mesh.dispose();
      }
      this.active = this.active.filter((v) => !removeIds.has(v.instanceId));
      anyChanged = true;
    }

    if (staffChanged) {
      for (const listener of this.staffChangeListeners) {
        listener();
      }
    }
    if (anyChanged) {
      this.emitChange();
    }
  }

  // =========================================================================
  // Funny Bathroom Visits Helpers
  // =========================================================================

  private findAvailableToilet(
    state: HouseState,
    reachable: Map<number, number>,
    reservedTiles: Set<number>,
    excludeId: string,
  ): { item: PlacedItem; tile: GridCoord; faceWorld: WorldPoint } | null {
    for (const item of state.items) {
      if (item.itemId !== 'toilet_cozy') continue;
      if (this.isSeatSlotTaken(item.uid, 0, excludeId)) continue;
      const def = this.store.data.itemsById.get(item.itemId);
      if (!def) continue;
      const approach = resolveItemApproach(
        this.navGrid,
        state,
        this.store.data,
        item,
        def,
        reachable,
        reservedTiles,
      );
      if (approach) {
        return { item, tile: approach.tile, faceWorld: approach.faceWorld };
      }
    }
    return null;
  }

  private findReachableBathroomSink(
    state: HouseState,
    reachable: Map<number, number>,
    reservedTiles: Set<number>,
  ): { item: PlacedItem; tile: GridCoord; faceWorld: WorldPoint } | null {
    for (const item of state.items) {
      if (item.itemId !== 'bathroom_sink') continue;
      const def = this.store.data.itemsById.get(item.itemId);
      if (!def) continue;
      const approach = resolveItemApproach(
        this.navGrid,
        state,
        this.store.data,
        item,
        def,
        reachable,
        reservedTiles,
      );
      if (approach) {
        return { item, tile: approach.tile, faceWorld: approach.faceWorld };
      }
    }
    return null;
  }

  private startBathroomVisit(
    v: ActiveVisitorRuntime,
    toiletItem: PlacedItem,
    approachTile: GridCoord,
    faceWorld: WorldPoint,
    state: HouseState,
    forcedTier?: BathroomTier,
  ): boolean {
    const pathTiles = this.computePathAvoidingVisitors(v, approachTile);
    if (!pathTiles || pathTiles.length === 0) return false;

    // 3 comedic bathroom tiers: ~45% Quick Pit Stop, ~33% Reading Break, ~22% Spicy Emergency!
    const roll = Math.random();
    const tier: BathroomTier =
      forcedTier ?? (roll < 0.45 ? 'quick' : roll < 0.78 ? 'reading' : 'spicy');

    v.phase = 'walking';
    v.pose = 'walk';
    v.bathroomStage = 'going_toilet';
    v.bathroomTier = tier;
    v.targetItemUid = toiletItem.uid;
    v.lastTargetItemUid = toiletItem.uid;
    v.targetTile = approachTile;
    v.faceTarget = faceWorld;
    v.pathTiles = pathTiles;
    v.path = pathTiles.map((t) => tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth));
    v.blockedProgressTimer = 0;
    v.lastWaypointDist = Infinity;

    if (tier === 'spicy') {
      v.activity = 'RUSHING to the bathroom!!';
      v.thought = 'EMERGENCY!! OUTTA MY WAY!';
      v.lastEmote = BATHROOM_EMOTE_PANIC.glyph;
      v.mesh.speechBubble.showEmote(BATHROOM_EMOTE_PANIC, 'bored', 3.4, 0.9);
    } else if (tier === 'reading') {
      v.activity = 'Heading to the bathroom';
      v.thought = 'Gonna be a minute…';
      v.lastEmote = BATHROOM_EMOTE_TOILET.glyph;
      v.mesh.speechBubble.showEmote(BATHROOM_EMOTE_TOILET, v.mood, 3.2, 0.9);
    } else {
      v.activity = 'Heading to the bathroom';
      v.thought = 'Quick pit stop!';
      const quickEmote = Math.random() < 0.5 ? BATHROOM_EMOTE_QUICK : BATHROOM_EMOTE_RELIEVED;
      v.lastEmote = quickEmote.glyph;
      v.mesh.speechBubble.showEmote(quickEmote, v.mood, 3.2, 0.9);
    }

    this.emitChange();
    return true;
  }

  private completeBathroomRelief(v: ActiveVisitorRuntime, state: HouseState): void {
    const wasSpicy = v.bathroomTier === 'spicy';
    v.bathroomStage = 'none';
    v.bathroomTier = 'quick';
    v.bathroomCooldown = 48 + Math.random() * 24;
    v.reliefMoodBonus = Math.min(18, v.reliefMoodBonus + 12);
    v.interactionBoost = Math.min(3.5, v.interactionBoost + 1.2);
    v.patienceRemaining = Math.min(v.def.patienceSeconds, v.patienceRemaining + 12);
    v.phase = 'idle';
    v.pose = 'idle';
    v.targetItemUid = null;
    v.targetTile = null;
    v.idleTimer = 1.1 + Math.random() * 0.8;
    v.activity = wasSpicy ? 'Survived spicy emergency' : 'Feeling refreshed';
    const reliefQuote = wasSpicy
      ? BATHROOM_SPICY_AFTERMATH[Math.floor(Math.random() * BATHROOM_SPICY_AFTERMATH.length)]
      : 'Ahhh, much better!';
    v.thought = reliefQuote;
    const endEmote = wasSpicy ? BATHROOM_SPICY_AGONY_EMOTES[1] : BATHROOM_EMOTE_RELIEF;
    v.lastEmote = endEmote.glyph;
    v.mesh.speechBubble.showEmote(endEmote, 'happy', 3.6, 1.0);
    this.updateVisitorMood(v, 0, true);
    // Preserve the signature relieved/aftermath thought after mood recalculation
    v.thought = reliefQuote;
    void state;
  }

  // =========================================================================
  // Visitor-to-Visitor Socializing
  // =========================================================================

  private hasClearLineOfSight(wx1: number, wz1: number, wx2: number, wz2: number): boolean {
    const state = this.store.getState();
    const steps = 10;
    let prevX = Math.floor(wx1 + state.gridWidth / 2);
    let prevZ = Math.floor(wz1 + state.gridDepth / 2);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.floor(wx1 + (wx2 - wx1) * t + state.gridWidth / 2);
      const cz = Math.floor(wz1 + (wz2 - wz1) * t + state.gridDepth / 2);
      if (cx === prevX && cz === prevZ) continue;

      const dx = cx - prevX;
      const dz = cz - prevZ;
      if (Math.abs(dx) + Math.abs(dz) === 1) {
        const edge = edgeKeyBetween(prevX, prevZ, cx, cz);
        if (edge && this.navGrid.blockedEdges.has(edge)) return false;
      } else {
        // Diagonal tile crossing: block if both L-corners have walls
        const e1a = edgeKeyBetween(prevX, prevZ, cx, prevZ);
        const e1b = edgeKeyBetween(cx, prevZ, cx, cz);
        const e2a = edgeKeyBetween(prevX, prevZ, prevX, cz);
        const e2b = edgeKeyBetween(prevX, cz, cx, cz);
        const path1Blocked = Boolean(
          (e1a && this.navGrid.blockedEdges.has(e1a)) || (e1b && this.navGrid.blockedEdges.has(e1b)),
        );
        const path2Blocked = Boolean(
          (e2a && this.navGrid.blockedEdges.has(e2a)) || (e2b && this.navGrid.blockedEdges.has(e2b)),
        );
        if (path1Blocked && path2Blocked) return false;
      }

      prevX = cx;
      prevZ = cz;
    }
    return true;
  }

  private pickSocialOpeningEmote(
    a: ActiveVisitorRuntime,
    b: ActiveVisitorRuntime,
  ): { id: string; glyph: string; label: string; color: string } {
    const sharedTag = a.def.likedTags.find((t) => b.def.likedTags.includes(t));
    if (sharedTag === 'coffee' || sharedTag === 'cafe') {
      return { id: 'coffee', glyph: '☕', label: 'Coffee chat', color: '#E8C5A5' };
    }
    if (sharedTag === 'music' || sharedTag === 'party' || sharedTag === 'dance') {
      return { id: 'note', glyph: '🎵', label: 'Music chat', color: '#B8D4F5' };
    }
    if (sharedTag === 'cat' || sharedTag === 'pet') {
      return { id: 'paw', glyph: '🐾', label: 'Cat chat', color: '#F0B6C2' };
    }
    if (sharedTag === 'plants') {
      return { id: 'leaf', glyph: '🌿', label: 'Plant chat', color: '#A9D6B5' };
    }
    if (sharedTag === 'read') {
      return { id: 'book', glyph: '📚', label: 'Book chat', color: '#C5D8EA' };
    }
    if (sharedTag === 'food' || sharedTag === 'cook') {
      return { id: 'food', glyph: '🍳', label: 'Food chat', color: '#F5CF7B' };
    }
    return Math.random() < 0.55
      ? { id: 'chat', glyph: '💬', label: 'Chatting', color: '#CBE4F5' }
      : { id: 'laugh', glyph: '😄', label: 'Laughing', color: '#FCE39E' };
  }

  private tryStartSocializing(): boolean {
    if (this.active.length < 2) return false;

    const isEligible = (v: ActiveVisitorRuntime): boolean => {
      if (v.socialPartnerId || v.socialCooldown > 0) return false;
      if (v.stumbleTimer > 0 || v.leavingPopTimer > 0) return false;
      if (v.bathroomStage !== 'none' || v.mood === 'leaving' || v.exteriorPath.length > 0) return false;
      return (
        v.phase === 'idle' ||
        v.phase === 'walking' ||
        (v.phase === 'using' && v.seatAnchor !== null)
      );
    };

    let started = false;
    for (let i = 0; i < this.active.length; i++) {
      const a = this.active[i];
      if (!isEligible(a)) continue;

      for (let j = i + 1; j < this.active.length; j++) {
        const b = this.active[j];
        if (!isEligible(b)) continue;

        const dist = Math.hypot(a.worldX - b.worldX, a.worldZ - b.worldZ);
        if (dist > SOCIAL_RADIUS || dist < 0.2) continue;
        if (!this.hasClearLineOfSight(a.worldX, a.worldZ, b.worldX, b.worldZ)) continue;

        const chatDuration = 4.2 + Math.random() * 1.8;
        const openEmote = this.pickSocialOpeningEmote(a, b);
        const replyEmote =
          SOCIAL_REPLY_EMOTES[Math.floor(Math.random() * SOCIAL_REPLY_EMOTES.length)];

        a.socialPartnerId = b.instanceId;
        b.socialPartnerId = a.instanceId;
        a.socialTimer = chatDuration;
        b.socialTimer = chatDuration;
        a.socialCooldown = SOCIAL_COOLDOWN_MIN + Math.random() * 5.0;
        b.socialCooldown = SOCIAL_COOLDOWN_MIN + Math.random() * 5.0;
        a.socialMoodBonus = Math.min(12, a.socialMoodBonus + 6);
        b.socialMoodBonus = Math.min(12, b.socialMoodBonus + 6);
        a.interactionBoost = Math.min(3.5, a.interactionBoost + 0.6);
        b.interactionBoost = Math.min(3.5, b.interactionBoost + 0.6);
        a.socialSavedPhase = a.seatAnchor ? null : a.phase;
        b.socialSavedPhase = b.seatAnchor ? null : b.phase;

        if (a.seatAnchor) {
          a.useTimer = Math.max(a.useTimer, chatDuration + 0.5);
        }
        if (b.seatAnchor) {
          b.useTimer = Math.max(b.useTimer, chatDuration + 0.5);
        }

        a.activity = `Chatting with ${b.persona.name}`;
        a.thought = `Chatting with ${b.persona.name}!`;
        b.activity = `Chatting with ${a.persona.name}`;
        b.thought = `Chatting with ${a.persona.name}!`;

        // Visitor A speaks first with cozy blabbering voice + emoji bubble
        const lineA = this.dialogueEngine.pickLine(a.def.id, a.mood, a.lastLineId);
        const blabberA = estimateBlabberDuration(lineA.text, lineA.speedMultiplier);
        a.lastLineId = lineA.id;
        a.lastEmote = resolveEmoteEmoji(openEmote.id, openEmote.glyph, a.mood);
        a.mesh.speechBubble.showEmote(openEmote, a.mood, 3.4, blabberA);
        this.audioModule?.playGibberishLine(
          lineA.text,
          a.def.voiceProfile,
          lineA.pitchOffset,
          lineA.speedMultiplier,
        );

        // Visitor B replies ~1.8s later with a happy emoji bubble!
        a.socialReplyPending = false;
        b.socialReplyPending = true;
        b.socialReplyDelay = 1.7 + Math.random() * 0.25;
        b.socialReplyEmoteId = replyEmote.id;

        this.updateVisitorMood(a, 0, true);
        this.updateVisitorMood(b, 0, true);
        a.thought = `Chatting with ${b.persona.name}!`;
        b.thought = `Chatting with ${a.persona.name}!`;

        started = true;
        break;
      }
    }

    return started;
  }

  private endSocializingFor(v: ActiveVisitorRuntime): void {
    if (!v.socialPartnerId) return;
    const partnerId = v.socialPartnerId;
    v.socialPartnerId = null;
    v.socialTimer = 0;
    v.socialReplyPending = false;
    v.socialSavedPhase = null;

    if (v.phase !== 'leaving' && v.phase !== 'waiting_pickup' && v.bathroomStage === 'none') {
      const state = this.store.getState();
      const aff = this.evaluateRoomAffinity(v.def, state);
      const activeItem = v.targetItemUid ? this.store.getItem(v.targetItemUid) : undefined;
      const activeDef = activeItem ? this.store.data.itemsById.get(activeItem.itemId) : undefined;
      v.thought = this.buildContextualThought(v, aff, activeDef);
      if (!v.seatAnchor && v.phase === 'idle') {
        v.activity = 'Looking around';
      } else if (v.seatAnchor && activeDef) {
        v.activity = `Sitting on ${activeDef.name}`;
      }
    }

    const partner = this.active.find((o) => o.instanceId === partnerId);
    if (partner && partner.socialPartnerId === v.instanceId) {
      this.endSocializingFor(partner);
    }
  }

  // =========================================================================
  // Hireable Cozy Bots & Human Staff Simulation
  // =========================================================================

  private syncStaffWithStore(houseMutated = false): void {
    const state = this.store.getState();
    const desiredStaff = this.getStoreStaff();
    const desiredIds = new Set(desiredStaff.map((s) => s.id));
    let changed = false;

    // 1. Remove fired staff cleanly
    const kept: ActiveStaffRuntime[] = [];
    for (const rt of this.staffRuntimes) {
      if (!desiredIds.has(rt.staff.id)) {
        this.staffRoot.remove(rt.mesh.root);
        rt.mesh.dispose();
        changed = true;
      } else {
        kept.push(rt);
      }
    }
    this.staffRuntimes = kept;

    // 2. Add newly hired staff or swap mesh cleanly on bot <-> human toggle / move / station reassign
    for (const rawEntry of desiredStaff) {
      const entry = rawEntry as HiredStaffWithHome;
      const existing = this.staffRuntimes.find((r) => r.staff.id === entry.id);
      if (existing) {
        const kindChanged = existing.staff.kind !== entry.kind || existing.staff.role !== entry.role;
        const nameChanged = existing.staff.name !== entry.name;
        const assignedChanged = existing.staff.assignedItemUid !== entry.assignedItemUid;
        const homeChanged =
          existing.staff.homeX !== entry.homeX || existing.staff.homeZ !== entry.homeZ;
        existing.staff = { ...entry };

        if (kindChanged) {
          // Smoothly swap 3D figurine in-place (Bot <-> Human)
          if (existing.seatAnchor) {
            existing.worldX = existing.seatAnchor.returnX;
            existing.worldY = 0;
            existing.worldZ = existing.seatAnchor.returnZ;
            existing.seatAnchor = null;
            existing.seatBlend = 0;
          }
          this.staffRoot.remove(existing.mesh.root);
          existing.mesh.dispose();

          const freshMesh = new StaffMesh(entry, this.staffVariantSeed++);
          freshMesh.root.position.set(existing.worldX, existing.worldY, existing.worldZ);
          freshMesh.root.rotation.y = existing.rotY;
          freshMesh.setScalePop(0.08);
          freshMesh.root.traverse((obj) => {
            obj.userData.staffId = entry.id;
          });
          this.staffRoot.add(freshMesh.root);

          existing.mesh = freshMesh;
          existing.spawnPopTimer = 0.001;
          existing.shiftRemaining = 28 + Math.random() * 10;
          existing.rechargeCountdown = 42 + Math.random() * 6;
          existing.phase = 'idle';
          existing.status = 'idle';
          existing.pose = 'idle';
          if (entry.kind === 'bot') {
            existing.mesh.speechBubble.showEmote(BOT_EMOTE_ROBOT, 'happy', 2.6, 0.8);
            this.playBotChirpSafe();
          }
          this.assignStaffToBestStation(existing, state);
          changed = true;
        } else if (homeChanged || assignedChanged) {
          // Player explicitly moved Bot/Staff to a custom (homeX, homeZ) or reassigned their station!
          if (existing.seatAnchor) {
            existing.worldX = existing.seatAnchor.returnX;
            existing.worldY = 0;
            existing.worldZ = existing.seatAnchor.returnZ;
            existing.seatAnchor = null;
            existing.seatBlend = 0;
            existing.mesh.root.position.set(existing.worldX, 0, existing.worldZ);
          }
          this.assignStaffToBestStation(existing, state);
          this.clampStaffToCityTerrace(existing, state);
          changed = true;
        } else if (houseMutated || nameChanged) {
          this.reconcileStaffAfterHouseChange(existing, state);
          changed = true;
        }
        continue;
      }

      // Newly hired staff member: spawn cleanly at custom homeX/homeZ if valid, else near workstation or front door!
      const match = this.findMatchingStationForStaff(entry, state, new Set(this.staffRuntimes.map((s) => s.stationUid).filter(Boolean) as string[]));
      let spawnTile: GridCoord;
      const customSpawn = match ? this.resolveStaffHomeTile(entry, match, state) : null;
      if (customSpawn) {
        spawnTile = customSpawn.tile;
      } else if (match) {
        const allReach = computeReachableDistances(this.navGrid, findNearestWalkableTile(this.navGrid, 0, 0));
        const app = resolveItemApproach(this.navGrid, state, this.store.data, match.item, match.def, allReach);
        spawnTile = app?.tile ?? findNearestWalkableTile(this.navGrid, 0, 0);
      } else {
        const doorSpawn = pickSpawnLocation(this.navGrid, this.staffVariantSeed);
        spawnTile = doorSpawn.firstGoal ?? doorSpawn.startTile;
      }

      const spawnWorld = tileCenterToWorld(spawnTile.x, spawnTile.z, state.gridWidth, state.gridDepth);
      const mesh = new StaffMesh(entry, this.staffVariantSeed++);
      mesh.root.position.set(spawnWorld.wx, 0, spawnWorld.wz);
      mesh.setScalePop(0.05);
      mesh.root.traverse((obj) => {
        obj.userData.staffId = entry.id;
      });
      this.staffRoot.add(mesh.root);

      const rt: ActiveStaffRuntime = {
        staff: { ...entry },
        mesh,
        status: 'idle',
        phase: 'idle',
        pose: 'idle',
        activity: `Ready (${STAFF_ROLE_LABELS[entry.role]})`,
        stationUid: null,
        stationName: undefined,
        worldX: spawnWorld.wx,
        worldY: 0,
        worldZ: spawnWorld.wz,
        velX: 0,
        velZ: 0,
        smoothVelX: 0,
        smoothVelZ: 0,
        rotY: 0,
        targetYaw: 0,
        currentTile: { ...spawnTile },
        path: [],
        pathTiles: [],
        targetTile: null,
        faceTarget: null,
        seatAnchor: null,
        seatBlend: 0,
        breakItemUid: null,
        breakIsToilet: false,
        shiftRemaining: 28 + Math.random() * 10,
        rechargeCountdown: 42 + Math.random() * 6,
        phaseTimer: 0,
        breakRemaining: 0,
        emoteCooldown: 2.5 + Math.random() * 2.5,
        machinePulseCooldown: 1.5,
        spawnPopTimer: 0.001,
        blockedProgressTimer: 0,
        lastWaypointDist: Infinity,
      };

      this.staffRuntimes.push(rt);
      this.assignStaffToBestStation(rt, state);
      this.clampStaffToCityTerrace(rt, state);

      if (entry.kind === 'bot') {
        rt.mesh.speechBubble.showEmote(BOT_EMOTE_ROBOT, 'happy', 2.8, 0.85);
        this.playBotChirpSafe();
      } else {
        const workEmote = STAFF_WORK_EMOTES[entry.role][0];
        rt.mesh.speechBubble.showEmote(workEmote, 'happy', 2.8, 0.85);
      }
      changed = true;
    }

    if (changed) {
      this.emitStaffChange();
    }
  }

  private reconcileStaffAfterHouseChange(s: ActiveStaffRuntime, state: HouseState): void {
    // If seated on a break item that was removed/moved, stand cleanly back on floor
    if (s.seatAnchor) {
      const seatItem = this.store.getItem(s.seatAnchor.itemUid);
      if (!seatItem) {
        const safeTile = findNearestWalkableTile(this.navGrid, s.seatAnchor.returnX, s.seatAnchor.returnZ);
        const sw = tileCenterToWorld(safeTile.x, safeTile.z, state.gridWidth, state.gridDepth);
        s.seatAnchor = null;
        s.seatBlend = 0;
        s.worldX = sw.wx;
        s.worldY = 0;
        s.worldZ = sw.wz;
        s.currentTile = safeTile;
        s.mesh.root.position.set(s.worldX, 0, s.worldZ);
        s.phase = 'idle';
        s.status = 'idle';
      }
    }

    // Ensure staff stays on a walkable tile if an object was placed on top of them
    if (
      !s.seatAnchor &&
      (!inGridBounds(s.currentTile.x, s.currentTile.z, state.gridWidth, state.gridDepth) ||
        !this.navGrid.walkable[s.currentTile.x][s.currentTile.z])
    ) {
      const safeTile = findNearestWalkableTile(this.navGrid, s.worldX, s.worldZ);
      const sw = tileCenterToWorld(safeTile.x, safeTile.z, state.gridWidth, state.gridDepth);
      s.currentTile = safeTile;
      s.worldX = sw.wx;
      s.worldY = 0;
      s.worldZ = sw.wz;
      s.mesh.root.position.set(s.worldX, 0, s.worldZ);
    }

    // If station was deleted or staff was idle waiting for a station, re-assign immediately!
    const stationStillExists = Boolean(s.stationUid && this.store.getItem(s.stationUid));
    if (
      s.phase === 'idle' ||
      ((s.phase === 'working' || s.phase === 'walking_to_station') && !stationStillExists)
    ) {
      this.assignStaffToBestStation(s, state);
    }

    this.clampStaffToCityTerrace(s, state);
  }

  private findMatchingStationForStaff(
    staff: HiredStaff,
    state: HouseState,
    claimedStationUids: Set<string>,
  ): { item: PlacedItem; def: FurnitureItemDef } | null {
    // 1. Respect explicit assignedItemUid if still present
    if (staff.assignedItemUid) {
      const explicit = state.items.find((it) => it.uid === staff.assignedItemUid);
      const explicitDef = explicit ? this.store.data.itemsById.get(explicit.itemId) : undefined;
      if (explicit && explicitDef) {
        return { item: explicit, def: explicitDef };
      }
    }

    const priorityIds = STAFF_STATION_ITEMS[staff.role];
    let bestFallback: { item: PlacedItem; def: FurnitureItemDef } | null = null;

    for (const targetItemId of priorityIds) {
      for (const item of state.items) {
        if (item.itemId !== targetItemId) continue;
        const def = this.store.data.itemsById.get(item.itemId);
        if (!def) continue;
        if (!claimedStationUids.has(item.uid)) {
          return { item, def };
        }
        if (!bestFallback) {
          bestFallback = { item, def };
        }
      }
    }

    return bestFallback;
  }

  /**
   * Resolves a custom player-placed `(homeX, homeZ)` tile if it is walkable and within `<= 2.6` tiles
   * of the matched workstation's footprint, returning that exact tile + station face target.
   */
  private resolveStaffHomeTile(
    staff: HiredStaffWithHome,
    match: { item: PlacedItem; def: FurnitureItemDef },
    state: HouseState,
  ): { tile: GridCoord; faceWorld: WorldPoint } | null {
    const hx = staff.homeX;
    const hz = staff.homeZ;
    if (hx === undefined || hz === undefined) return null;
    if (!Number.isInteger(hx) || !Number.isInteger(hz)) return null;
    if (!inGridBounds(hx, hz, state.gridWidth, state.gridDepth)) return null;
    if (!this.navGrid.walkable[hx][hz]) return null;

    const eff = getEffectiveFootprint(match.def, match.item.rotation);
    // Shortest distance from (hx, hz) to any footprint cell of the assigned/matched station
    let minDist = Infinity;
    for (let dx = 0; dx < eff.w; dx++) {
      for (let dz = 0; dz < eff.d; dz++) {
        const d = Math.hypot(hx - (match.item.x + dx), hz - (match.item.z + dz));
        if (d < minDist) minDist = d;
      }
    }
    if (minDist > STAFF_HOME_MAX_DIST) {
      return null;
    }

    const faceWorld = tileToWorldCenter(
      match.item.x,
      match.item.z,
      eff.w,
      eff.d,
      state.gridWidth,
      state.gridDepth,
    );
    return { tile: { x: hx, z: hz }, faceWorld };
  }

  private assignStaffToBestStation(s: ActiveStaffRuntime, state: HouseState): boolean {
    const claimed = new Set<string>();
    for (const other of this.staffRuntimes) {
      if (other.staff.id !== s.staff.id && other.stationUid) {
        claimed.add(other.stationUid);
      }
    }

    const match = this.findMatchingStationForStaff(s.staff, state, claimed);
    if (!match) {
      s.stationUid = null;
      s.stationName = undefined;
      s.phase = 'idle';
      s.status = 'idle';
      s.pose = 'idle';
      s.path = [];
      s.pathTiles = [];
      s.activity = `Waiting for a ${STAFF_ROLE_LABELS[s.staff.role]} station`;
      return false;
    }

    const reachable = computeReachableDistances(this.navGrid, s.currentTile);
    const customHome = this.resolveStaffHomeTile(s.staff, match, state);
    const approach =
      customHome && reachable.has(tileIndex(customHome.tile.x, customHome.tile.z, state.gridDepth))
        ? customHome
        : resolveItemApproach(
            this.navGrid,
            state,
            this.store.data,
            match.item,
            match.def,
            reachable,
          );

    s.stationUid = match.item.uid;
    s.stationName = match.def.name;

    if (!approach) {
      s.phase = 'idle';
      s.status = 'idle';
      s.pose = 'idle';
      s.activity = `Can't reach ${match.def.name}`;
      return false;
    }

    if (approach.tile.x === s.currentTile.x && approach.tile.z === s.currentTile.z) {
      const tw = tileCenterToWorld(approach.tile.x, approach.tile.z, state.gridWidth, state.gridDepth);
      s.worldX = tw.wx;
      s.worldZ = tw.wz;
      s.targetTile = approach.tile;
      s.faceTarget = approach.faceWorld;
      s.phase = 'working';
      s.status = 'working';
      s.pose = 'work';
      s.path = [];
      s.pathTiles = [];
      s.activity = `${STAFF_WORK_VERBS[s.staff.role]} ${match.def.name}`;
      return true;
    }

    const pathTiles = findGridPath(this.navGrid, s.currentTile, approach.tile);
    if (!pathTiles || pathTiles.length === 0) {
      s.phase = 'working';
      s.status = 'working';
      s.pose = 'work';
      s.targetTile = s.currentTile;
      s.faceTarget = approach.faceWorld;
      s.activity = `${STAFF_WORK_VERBS[s.staff.role]} ${match.def.name}`;
      return true;
    }

    s.phase = 'walking_to_station';
    s.status = 'walking';
    s.pose = 'walk';
    s.targetTile = approach.tile;
    s.faceTarget = approach.faceWorld;
    s.pathTiles = pathTiles;
    s.path = pathTiles.map((t) => tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth));
    s.blockedProgressTimer = 0;
    s.lastWaypointDist = Infinity;
    s.activity = `Heading to ${match.def.name}`;
    return true;
  }

  private startHumanStaffBreak(s: ActiveStaffRuntime, state: HouseState): void {
    const breakDuration = 14 + Math.random() * 6;
    s.breakRemaining = breakDuration;
    s.breakItemUid = null;
    s.breakIsToilet = false;
    s.status = 'break';

    const reachable = computeReachableDistances(this.navGrid, s.currentTile);
    const reserved = this.getReservedTiles(s.staff.id);

    // 1. Occasionally pick toilet_cozy for a funny pit stop on break!
    const toiletPick = this.findAvailableToilet(state, reachable, reserved, s.staff.id);
    const seatPick = this.pickStaffBreakSeat(s, state, reachable, reserved);

    const chooseToilet = Boolean(toiletPick) && (!seatPick || Math.random() < 0.38);
    if (chooseToilet && toiletPick) {
      const pathTiles = findGridPath(this.navGrid, s.currentTile, toiletPick.tile);
      if (pathTiles && pathTiles.length > 0) {
        s.phase = 'walking_to_break';
        s.pose = 'walk';
        s.breakItemUid = toiletPick.item.uid;
        s.breakIsToilet = true;
        s.targetTile = toiletPick.tile;
        s.faceTarget = toiletPick.faceWorld;
        s.pathTiles = pathTiles;
        s.path = pathTiles.map((t) => tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth));
        s.activity = 'On Break — Quick pit stop';
        s.mesh.speechBubble.showEmote(BATHROOM_EMOTE_TOILET, 'happy', 3.0, 0.8);
        return;
      }
    }

    // 2. Otherwise walk to a free couch/chair to sit down & relax!
    if (seatPick) {
      const pathTiles = findGridPath(this.navGrid, s.currentTile, seatPick.tile);
      if (pathTiles && pathTiles.length > 0) {
        s.phase = 'walking_to_break';
        s.pose = 'walk';
        s.breakItemUid = seatPick.item.uid;
        s.breakIsToilet = false;
        s.targetTile = seatPick.tile;
        s.faceTarget = seatPick.faceWorld;
        s.pathTiles = pathTiles;
        s.path = pathTiles.map((t) => tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth));
        s.activity = `On Break — Heading to ${seatPick.def.name}`;
        s.mesh.speechBubble.showEmote({ id: 'sofa', glyph: '🛋️', label: 'Break time', color: '#ECC0A4' }, 'happy', 3.0, 0.8);
        return;
      }
    }

    // 3. Fallback: take a relaxing standing coffee break right where they are
    s.phase = 'on_break';
    s.pose = 'idle';
    s.phaseTimer = breakDuration;
    s.activity = 'On Break — Sipping coffee';
    s.mesh.speechBubble.showEmote({ id: 'coffee', glyph: '☕', label: 'Coffee break', color: '#E8C5A5' }, 'happy', 3.2, 0.85);
  }

  private pickStaffBreakSeat(
    s: ActiveStaffRuntime,
    state: HouseState,
    reachable: Map<number, number>,
    reservedTiles: Set<number>,
  ): { item: PlacedItem; def: FurnitureItemDef; tile: GridCoord; faceWorld: WorldPoint } | null {
    let best: { item: PlacedItem; def: FurnitureItemDef; tile: GridCoord; faceWorld: WorldPoint; dist: number } | null = null;
    for (const item of state.items) {
      if (item.itemId === 'toilet_cozy') continue;
      const def = this.store.data.itemsById.get(item.itemId);
      if (!def) continue;
      const slots = getSeatSlotsForItem(def);
      if (!slots || slots.length === 0) continue;
      let anyFree = false;
      for (let i = 0; i < slots.length; i++) {
        if (!this.isSeatSlotTaken(item.uid, i, s.staff.id)) {
          anyFree = true;
          break;
        }
      }
      if (!anyFree) continue;
      const approach = resolveItemApproach(this.navGrid, state, this.store.data, item, def, reachable, reservedTiles);
      if (!approach) continue;
      const d = reachable.get(tileIndex(approach.tile.x, approach.tile.z, state.gridDepth)) ?? 99;
      if (!best || d < best.dist) {
        best = { item, def, tile: approach.tile, faceWorld: approach.faceWorld, dist: d };
      }
    }
    return best;
  }

  private stepStaffMovement(
    s: ActiveStaffRuntime,
    dt: number,
    velSmoothAlpha: number,
    state: HouseState,
  ): boolean {
    const nextWp = s.path[0];
    if (!nextWp) return true;

    const dx = nextWp.wx - s.worldX;
    const dz = nextWp.wz - s.worldZ;
    const dist = Math.hypot(dx, dz);
    const arrivalRadius = s.path.length > 1 ? 0.24 : 0.16;

    if (dist <= arrivalRadius) {
      s.path.shift();
      if (s.pathTiles.length > 0) {
        s.currentTile = s.pathTiles.shift()!;
      }
      s.blockedProgressTimer = 0;
      s.lastWaypointDist = Infinity;
      s.mesh.updateAnimation(dt, 'walk', 1.55);
      return s.path.length === 0;
    }

    const walkSpeed = s.staff.kind === 'bot' ? 1.65 : 1.5;
    const step = Math.min(walkSpeed * dt, dist);
    const candidateWx = s.worldX + (dx / dist) * step;
    const candidateWz = s.worldZ + (dz / dist) * step;
    const safe = resolveSafeMovement(this.navGrid, s.worldX, s.worldZ, candidateWx, candidateWz, false);

    const movedX = safe.wx - s.worldX;
    const movedZ = safe.wz - s.worldZ;
    s.worldX = safe.wx;
    s.worldZ = safe.wz;
    s.velX = dt > 0 ? movedX / dt : 0;
    s.velZ = dt > 0 ? movedZ / dt : 0;
    s.smoothVelX += (s.velX - s.smoothVelX) * velSmoothAlpha;
    s.smoothVelZ += (s.velZ - s.smoothVelZ) * velSmoothAlpha;

    const smoothSpeed = Math.hypot(s.smoothVelX, s.smoothVelZ);
    if (smoothSpeed > 0.1) {
      s.targetYaw = Math.atan2(s.smoothVelX, s.smoothVelZ);
    }
    s.rotY = dampAngle(s.rotY, s.targetYaw, 10, dt);
    s.mesh.root.rotation.y = s.rotY;
    s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
    s.mesh.updateAnimation(dt, 'walk', walkSpeed);

    const fx = Math.floor(s.worldX + state.gridWidth / 2);
    const fz = Math.floor(s.worldZ + state.gridDepth / 2);
    if (inGridBounds(fx, fz, state.gridWidth, state.gridDepth)) {
      s.currentTile = { x: fx, z: fz };
    }

    const newDist = Math.hypot(nextWp.wx - s.worldX, nextWp.wz - s.worldZ);
    if (newDist >= s.lastWaypointDist - 0.003) {
      s.blockedProgressTimer += dt;
      if (s.blockedProgressTimer > 1.2) {
        s.blockedProgressTimer = 0;
        s.path = [];
        s.pathTiles = [];
        return true;
      }
    } else {
      s.blockedProgressTimer = 0;
    }
    s.lastWaypointDist = newDist;
    return false;
  }

  private clampStaffToCityTerrace(s: ActiveStaffRuntime, state: HouseState): void {
    if (state.sceneryViewId !== 'city' || s.seatAnchor) return;
    const maxX = Math.max(0.5, state.gridWidth / 2 - 0.15);
    const maxZ = Math.max(0.5, state.gridDepth / 2 - 0.15);
    s.worldX = Math.max(-maxX, Math.min(maxX, s.worldX));
    s.worldZ = Math.max(-maxZ, Math.min(maxZ, s.worldZ));
    s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
  }

  private updateStaff(dt: number, state: HouseState): boolean {
    if (this.staffRuntimes.length === 0) return false;
    let changed = false;
    const velSmoothAlpha = 1 - Math.exp(-10 * dt);

    for (const s of this.staffRuntimes) {
      if (s.spawnPopTimer > 0) {
        s.spawnPopTimer += dt;
        const t = clamp01(s.spawnPopTimer / SPAWN_POP_DURATION);
        const eased = t < 1 ? 0.05 + 0.95 * (1 - Math.pow(1 - t, 3)) : 1;
        s.mesh.setScalePop(eased);
        if (t >= 1) {
          s.spawnPopTimer = 0;
          s.mesh.setScalePop(1);
        }
      }

      s.emoteCooldown = Math.max(0, s.emoteCooldown - dt);
      s.machinePulseCooldown = Math.max(0, s.machinePulseCooldown - dt);

      switch (s.phase) {
        case 'walking_to_station': {
          const arrived = this.stepStaffMovement(s, dt, velSmoothAlpha, state);
          if (arrived) {
            s.phase = 'working';
            s.status = 'working';
            s.pose = 'work';
            s.activity = s.stationName
              ? `${STAFF_WORK_VERBS[s.staff.role]} ${s.stationName}`
              : `${STAFF_ROLE_LABELS[s.staff.role]} on duty`;
            changed = true;
          }
          break;
        }

        case 'working': {
          s.velX = 0;
          s.velZ = 0;
          s.smoothVelX = 0;
          s.smoothVelZ = 0;

          if (s.faceTarget) {
            const dx = s.faceTarget.wx - s.worldX;
            const dz = s.faceTarget.wz - s.worldZ;
            if (Math.hypot(dx, dz) > 0.04) {
              s.targetYaw = Math.atan2(dx, dz);
              s.rotY = dampAngle(s.rotY, s.targetYaw, 9, dt);
              s.mesh.root.rotation.y = s.rotY;
            }
          }

          s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
          s.mesh.updateAnimation(dt, 'work', 1.5);

          // Periodically keep the workstation machine lively (turn it on if inactive)
          if (s.machinePulseCooldown <= 0 && s.stationUid) {
            s.machinePulseCooldown = 9 + Math.random() * 5;
            const item = this.store.getItem(s.stationUid);
            const def = item ? this.store.data.itemsById.get(item.itemId) : undefined;
            if (item && def?.interaction && !item.active) {
              this.store.triggerInteraction(item.uid);
            }
          }

          // Periodic cute themed work emote bubble
          if (s.emoteCooldown <= 0) {
            s.emoteCooldown = 8.5 + Math.random() * 5.0;
            const emotes = STAFF_WORK_EMOTES[s.staff.role];
            const chosen = emotes[Math.floor(Math.random() * emotes.length)];
            s.mesh.speechBubble.showEmote(chosen, 'happy', 3.0, 0.9);
            if (s.staff.kind === 'bot' && Math.random() < 0.45) {
              this.playBotChirpSafe();
            }
          }

          if (s.staff.kind === 'bot') {
            // Cozy Bots work happily nonstop with a cute 3-second recharging spin every ~45s!
            s.rechargeCountdown -= dt;
            if (s.rechargeCountdown <= 0) {
              s.phase = 'recharging';
              s.status = 'recharging';
              s.pose = 'recharge';
              s.phaseTimer = 3.0;
              s.activity = 'Recharging batteries';
              const e = Math.random() < 0.6 ? BOT_EMOTE_RECHARGE : BOT_EMOTE_ROBOT;
              s.mesh.speechBubble.showEmote(e, 'delighted', 3.0, 1.0);
              this.playBotChirpSafe();
              changed = true;
            }
          } else {
            // Human Staff work a 28–38s shift, then take a real 14–20s cozy break!
            s.shiftRemaining -= dt;
            if (s.shiftRemaining <= 0) {
              this.startHumanStaffBreak(s, state);
              changed = true;
            }
          }
          break;
        }

        case 'recharging': {
          s.phaseTimer -= dt;
          s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
          s.mesh.updateAnimation(dt, 'recharge', 1.5);
          if (s.phaseTimer <= 0) {
            s.rechargeCountdown = 42 + Math.random() * 6;
            s.phase = 'working';
            s.status = 'working';
            s.pose = 'work';
            s.activity = s.stationName
              ? `${STAFF_WORK_VERBS[s.staff.role]} ${s.stationName}`
              : `${STAFF_ROLE_LABELS[s.staff.role]} on duty`;
            changed = true;
          }
          break;
        }

        case 'walking_to_break': {
          s.breakRemaining = Math.max(0, s.breakRemaining - dt * 0.4);
          const arrived = this.stepStaffMovement(s, dt, velSmoothAlpha, state);
          if (arrived) {
            const breakItem = s.breakItemUid ? this.store.getItem(s.breakItemUid) : undefined;
            const breakDef = breakItem ? this.store.data.itemsById.get(breakItem.itemId) : undefined;
            if (breakItem && breakDef) {
              const seatAnchor = this.resolveAvailableSeatAnchor(
                breakItem,
                breakDef,
                s.worldX,
                s.worldZ,
                s.staff.id,
              );
              if (seatAnchor) {
                s.seatAnchor = seatAnchor;
                s.seatBlend = 0;
                s.phase = 'mounting_seat';
                s.pose = 'sit';
                s.phaseTimer = s.breakIsToilet ? 4.2 + Math.random() * 0.8 : Math.max(7, s.breakRemaining);
                s.activity = s.breakIsToilet ? 'On Break — Using restroom' : `On Break — Relaxing on ${breakDef.name}`;
                s.targetYaw = seatAnchor.facingYaw;
                changed = true;
                break;
              }
            }
            s.phase = 'on_break';
            s.pose = 'idle';
            s.phaseTimer = Math.max(5, s.breakRemaining);
            s.activity = 'On Break — Sipping coffee';
            changed = true;
          }
          break;
        }

        case 'mounting_seat': {
          if (!s.seatAnchor) {
            s.phase = 'on_break';
            break;
          }
          s.seatBlend = clamp01(s.seatBlend + dt / SEAT_MOUNT_DURATION);
          const t = s.seatBlend;
          const smoothT = t * t * (3 - 2 * t);
          const arcY = Math.sin(t * Math.PI) * 0.1;

          s.worldX = s.seatAnchor.returnX + (s.seatAnchor.wx - s.seatAnchor.returnX) * smoothT;
          s.worldZ = s.seatAnchor.returnZ + (s.seatAnchor.wz - s.seatAnchor.returnZ) * smoothT;
          s.worldY = s.seatAnchor.wy * smoothT + arcY;
          s.rotY = dampAngle(s.rotY, s.seatAnchor.facingYaw, 11, dt);
          s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
          s.mesh.root.rotation.y = s.rotY;
          s.mesh.updateAnimation(dt, 'sit', 1.5, smoothT);

          if (s.seatBlend >= 1) {
            s.phase = 'on_break';
            s.worldX = s.seatAnchor.wx;
            s.worldY = s.seatAnchor.wy;
            s.worldZ = s.seatAnchor.wz;
            s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
          }
          break;
        }

        case 'on_break': {
          s.phaseTimer -= dt;
          s.breakRemaining = Math.max(0, s.breakRemaining - dt);
          if (s.seatAnchor) {
            s.rotY = dampAngle(s.rotY, s.seatAnchor.facingYaw, 9, dt);
            s.mesh.root.rotation.y = s.rotY;
            s.mesh.root.position.set(s.seatAnchor.wx, s.seatAnchor.wy, s.seatAnchor.wz);
            s.mesh.updateAnimation(dt, 'sit', 1.5, 1);
          } else {
            s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
            s.mesh.updateAnimation(dt, 'idle', 1.5);
          }

          if (s.emoteCooldown <= 0) {
            s.emoteCooldown = 6.5 + Math.random() * 3.5;
            const e = s.breakIsToilet
              ? BATHROOM_EMOTE_TOILET
              : Math.random() < 0.5
                ? { id: 'coffee', glyph: '☕', label: 'Break', color: '#E8C5A5' }
                : { id: 'sofa', glyph: '🛋️', label: 'Relaxing', color: '#ECC0A4' };
            s.mesh.speechBubble.showEmote(e, 'happy', 3.0, 0.8);
          }

          if (s.phaseTimer <= 0) {
            if (s.breakIsToilet) {
              this.audioModule?.playInteract('toilet_cozy', ['bathroom'], true);
            }
            if (s.seatAnchor) {
              s.phase = 'dismounting_seat';
              s.seatBlend = 1;
            } else {
              s.shiftRemaining = 28 + Math.random() * 10;
              this.assignStaffToBestStation(s, state);
              changed = true;
            }
          }
          break;
        }

        case 'dismounting_seat': {
          if (!s.seatAnchor) {
            s.shiftRemaining = 28 + Math.random() * 10;
            this.assignStaffToBestStation(s, state);
            changed = true;
            break;
          }
          s.seatBlend = clamp01(s.seatBlend - dt / SEAT_DISMOUNT_DURATION);
          const t = s.seatBlend;
          const smoothT = t * t * (3 - 2 * t);
          const arcY = Math.sin(t * Math.PI) * 0.08;

          s.worldX = s.seatAnchor.returnX + (s.seatAnchor.wx - s.seatAnchor.returnX) * smoothT;
          s.worldZ = s.seatAnchor.returnZ + (s.seatAnchor.wz - s.seatAnchor.returnZ) * smoothT;
          s.worldY = s.seatAnchor.wy * smoothT + arcY;
          s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
          s.mesh.updateAnimation(dt, 'sit', 1.5, smoothT);

          if (s.seatBlend <= 0) {
            s.worldX = s.seatAnchor.returnX;
            s.worldY = 0;
            s.worldZ = s.seatAnchor.returnZ;
            s.seatAnchor = null;
            s.mesh.root.position.set(s.worldX, 0, s.worldZ);
            const fx = Math.floor(s.worldX + state.gridWidth / 2);
            const fz = Math.floor(s.worldZ + state.gridDepth / 2);
            if (inGridBounds(fx, fz, state.gridWidth, state.gridDepth)) {
              s.currentTile = { x: fx, z: fz };
            }

            if (s.breakIsToilet) {
              s.breakIsToilet = false;
              const reachable = computeReachableDistances(this.navGrid, s.currentTile);
              const sinkPick = this.findReachableBathroomSink(state, reachable, new Set());
              if (sinkPick) {
                const pathTiles = findGridPath(this.navGrid, s.currentTile, sinkPick.tile);
                if (pathTiles && pathTiles.length > 0) {
                  s.phase = 'walking_to_sink';
                  s.pose = 'walk';
                  s.faceTarget = sinkPick.faceWorld;
                  s.pathTiles = pathTiles;
                  s.path = pathTiles.map((pt) =>
                    tileCenterToWorld(pt.x, pt.z, state.gridWidth, state.gridDepth),
                  );
                  s.activity = 'On Break — Washing hands';
                  changed = true;
                  break;
                }
              }
            }

            // Return happily to workstation for next shift!
            s.shiftRemaining = 28 + Math.random() * 10;
            this.assignStaffToBestStation(s, state);
            changed = true;
          }
          break;
        }

        case 'walking_to_sink': {
          const arrived = this.stepStaffMovement(s, dt, velSmoothAlpha, state);
          if (arrived) {
            s.phase = 'washing_hands';
            s.pose = 'work';
            s.phaseTimer = 2.2;
            s.activity = 'On Break — Washing hands';
            s.mesh.speechBubble.showEmote(BATHROOM_EMOTE_BUBBLE, 'happy', 2.4, 0.7);
            this.audioModule?.playInteract('bathroom_sink', ['bathroom'], true);
            changed = true;
          }
          break;
        }

        case 'washing_hands': {
          s.phaseTimer -= dt;
          if (s.faceTarget) {
            const dx = s.faceTarget.wx - s.worldX;
            const dz = s.faceTarget.wz - s.worldZ;
            if (Math.hypot(dx, dz) > 0.04) {
              s.targetYaw = Math.atan2(dx, dz);
              s.rotY = dampAngle(s.rotY, s.targetYaw, 9, dt);
              s.mesh.root.rotation.y = s.rotY;
            }
          }
          s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
          s.mesh.updateAnimation(dt, 'work', 1.5);
          if (s.phaseTimer <= 0) {
            s.mesh.speechBubble.showEmote(BATHROOM_EMOTE_RELIEF, 'happy', 2.4, 0.7);
            s.shiftRemaining = 28 + Math.random() * 10;
            this.assignStaffToBestStation(s, state);
            changed = true;
          }
          break;
        }

        case 'idle':
        default: {
          s.mesh.root.position.set(s.worldX, s.worldY, s.worldZ);
          s.mesh.updateAnimation(dt, 'idle', 1.5);
          break;
        }
      }

      this.clampStaffToCityTerrace(s, state);
    }

    return changed;
  }

  dispose(): void {
    this.unsubscribeHouse();
    this.unsubscribeOpen?.();
    this.unsubscribeOpen = null;
    this.unsubscribeDoorPolicy?.();
    this.unsubscribeDoorPolicy = null;
    this.unsubscribeStaff?.();
    this.unsubscribeStaff = null;

    for (const uid of this.doorHoldTimers.keys()) {
      this.setDoorVisitorOpenSafe(uid, false);
    }
    this.doorHoldTimers.clear();

    for (const v of this.active) {
      this.visitorsRoot.remove(v.mesh.root);
      v.mesh.dispose();
    }
    this.active = [];

    for (const s of this.staffRuntimes) {
      this.staffRoot.remove(s.mesh.root);
      s.mesh.dispose();
    }
    this.staffRuntimes = [];

    for (const p of this.activePortals) {
      this.effectsRoot.remove(p.portal.group);
      p.portal.dispose();
    }
    this.activePortals = [];

    for (const puff of this.stinkPuffs) {
      this.effectsRoot.remove(puff.mesh);
      puff.geo.dispose();
      puff.mat.dispose();
    }
    this.stinkPuffs = [];

    if (this.activeCaptionOwnerId !== null) {
      this.emitCaption(null);
    }
    this.stopGojoVoiceAudio();
    this.releaseGojoCameraFollow();

    this.sceneManager.scene.remove(this.visitorsRoot);
    this.sceneManager.scene.remove(this.staffRoot);
    this.sceneManager.scene.remove(this.effectsRoot);
    this.transport.dispose();
    this.changeListeners.clear();
    this.staffChangeListeners.clear();
    this.captionListeners.clear();
  }

  // =========================================================================
  // Wave 6: Visual Effects (Rick's Green Portals & Cartoon Spicy Stink Puffs)
  // =========================================================================

  private pickOpenInteriorTile(state: HouseState): GridCoord {
    const interiorTiles: GridCoord[] = [];
    const walkableTiles: GridCoord[] = [];
    for (let x = 0; x < state.gridWidth; x++) {
      for (let z = 0; z < state.gridDepth; z++) {
        if (!this.navGrid.walkable[x][z]) continue;
        const coord = { x, z };
        walkableTiles.push(coord);
        if (this.navGrid.hasFloorTile[x][z]) {
          interiorTiles.push(coord);
        }
      }
    }
    const pool = interiorTiles.length > 0 ? interiorTiles : walkableTiles;
    if (pool.length === 0) {
      return findNearestWalkableTile(this.navGrid, 0, 0);
    }
    // Prefer tiles near room center so Rick portals cleanly inside the house
    const cx = state.gridWidth / 2;
    const cz = state.gridDepth / 2;
    pool.sort(
      (a, b) =>
        Math.hypot(a.x + 0.5 - cx, a.z + 0.5 - cz) -
        Math.hypot(b.x + 0.5 - cx, b.z + 0.5 - cz),
    );
    const pickIdx = Math.floor(Math.random() * Math.min(6, pool.length));
    return pool[pickIdx];
  }

  private spawnGreenPortal(wx: number, wz: number, yaw: number, duration = 1.65): void {
    const portal = createGreenPortalMesh();
    portal.group.position.set(wx, 0, wz);
    portal.group.rotation.y = yaw;
    portal.update(0, 0, 0.02);
    this.effectsRoot.add(portal.group);
    this.activePortals.push({ portal, age: 0, duration, elapsed: 0 });
  }

  private spawnStinkPuff(wx: number, wz: number): void {
    const radius = 0.1 + Math.random() * 0.055;
    const geo = new THREE.SphereGeometry(radius, 8, 6);
    const tint = Math.random() < 0.5 ? '#78D65E' : '#A2E368';
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tint),
      emissive: new THREE.Color('#468F34'),
      emissiveIntensity: 0.25,
      roughness: 0.85,
      metalness: 0,
      flatShading: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const ox = wx + (Math.random() - 0.5) * 0.24;
    const oz = wz + (Math.random() - 0.5) * 0.24;
    mesh.position.set(ox, 0.92 + Math.random() * 0.16, oz);
    this.effectsRoot.add(mesh);
    this.stinkPuffs.push({
      mesh,
      geo,
      mat,
      age: 0,
      duration: 2.3 + Math.random() * 0.6,
      vy: 0.44 + Math.random() * 0.16,
      baseX: ox,
      baseZ: oz,
      seed: Math.random() * Math.PI * 2,
    });
  }

  private updateVisualEffects(dt: number): void {
    // 1. Rick's Swirling Neon-Green 3D Portals
    for (let i = this.activePortals.length - 1; i >= 0; i--) {
      const p = this.activePortals[i];
      p.age += dt;
      p.elapsed += dt;
      let openFactor = 1;
      if (p.age < 0.38) {
        openFactor = clamp01(p.age / 0.38);
      } else if (p.age > p.duration - 0.42) {
        openFactor = clamp01((p.duration - p.age) / 0.42);
      }
      p.portal.update(dt, p.elapsed, Math.max(0.001, openFactor));
      if (p.age >= p.duration) {
        this.effectsRoot.remove(p.portal.group);
        p.portal.dispose();
        this.activePortals.splice(i, 1);
      }
    }

    // 2. Spicy Emergency Cartoon Green Stink-Puff Spheres
    for (let i = this.stinkPuffs.length - 1; i >= 0; i--) {
      const puff = this.stinkPuffs[i];
      puff.age += dt;
      const t = clamp01(puff.age / puff.duration);
      puff.mesh.position.y += puff.vy * dt;
      puff.mesh.position.x = puff.baseX + Math.sin(puff.age * 3.8 + puff.seed) * 0.09;
      puff.mesh.position.z = puff.baseZ + Math.cos(puff.age * 3.1 + puff.seed) * 0.09;
      const sc = 0.72 + t * 0.85;
      puff.mesh.scale.set(sc, sc * 0.9, sc);
      puff.mat.opacity = 0.62 * (1 - t * t);
      if (puff.age >= puff.duration) {
        this.effectsRoot.remove(puff.mesh);
        puff.geo.dispose();
        puff.mat.dispose();
        this.stinkPuffs.splice(i, 1);
      }
    }
  }

  // =========================================================================
  // Wave 6: Legendary Special Character Behaviors & Baki Ragdoll Physics
  // =========================================================================

  private triggerShakespeareAnnoyanceEscape(
    bard: ActiveVisitorRuntime,
    victim: ActiveVisitorRuntime,
  ): void {
    const state = this.store.getState();
    this.endSocializingFor(victim);

    // If seated, stand cleanly down on return tile first
    if (victim.seatAnchor) {
      victim.worldX = victim.seatAnchor.returnX;
      victim.worldY = 0;
      victim.worldZ = victim.seatAnchor.returnZ;
      victim.seatAnchor = null;
      victim.seatBlend = 0;
      victim.mesh.root.position.set(victim.worldX, 0, victim.worldZ);
      const fx = Math.floor(victim.worldX + state.gridWidth / 2);
      const fz = Math.floor(victim.worldZ + state.gridDepth / 2);
      if (inGridBounds(fx, fz, state.gridWidth, state.gridDepth)) {
        victim.currentTile = { x: fx, z: fz };
      }
    }

    const annoyEmote = Math.random() < 0.5 ? DISLIKE_EMOTES[1] : DISLIKE_EMOTES[2];
    const annoyQuote =
      SHAKESPEARE_ANNOYED_QUOTES[Math.floor(Math.random() * SHAKESPEARE_ANNOYED_QUOTES.length)];

    victim.annoyedMoodPenalty = Math.min(24, victim.annoyedMoodPenalty + 12);
    victim.moodScore = Math.max(0, victim.moodScore - 12);
    victim.lastEmote = annoyEmote.glyph;
    victim.mesh.speechBubble.showEmote(annoyEmote, 'bored', 3.4, 0.9);
    this.updateVisitorMood(victim, 0, true);
    victim.thought = annoyQuote;

    // Pick the farthest reachable walkable tile across the room to escape Shakespeare!
    const reachable = computeReachableDistances(this.navGrid, victim.currentTile);
    let escapeTile: GridCoord | null = null;
    let bestDistSq = -1;
    for (const idx of reachable.keys()) {
      const tx = Math.floor(idx / state.gridDepth);
      const tz = idx % state.gridDepth;
      if (tx === victim.currentTile.x && tz === victim.currentTile.z) continue;
      if (!this.navGrid.walkable[tx][tz]) continue;
      const w = tileCenterToWorld(tx, tz, state.gridWidth, state.gridDepth);
      const floorWeight = this.navGrid.hasFloorTile[tx][tz] ? 4.0 : 0;
      const dSq =
        (w.wx - bard.worldX) * (w.wx - bard.worldX) +
        (w.wz - bard.worldZ) * (w.wz - bard.worldZ) +
        floorWeight;
      if (dSq > bestDistSq) {
        bestDistSq = dSq;
        escapeTile = { x: tx, z: tz };
      }
    }

    if (escapeTile) {
      const pathTiles = this.computePathAvoidingVisitors(victim, escapeTile);
      if (pathTiles && pathTiles.length > 0) {
        victim.phase = 'walking';
        victim.pose = 'walk';
        victim.targetItemUid = null;
        victim.targetTile = escapeTile;
        victim.faceTarget = null;
        victim.pathTiles = pathTiles;
        victim.path = pathTiles.map((t) =>
          tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth),
        );
        victim.blockedProgressTimer = 0;
        victim.lastWaypointDist = Infinity;
        victim.activity = 'Escaping Shakespeare';
      }
    }
  }

  private launchVisitorRagdoll(target: ActiveVisitorRuntime, fromX: number, fromZ: number): void {
    this.endSocializingFor(target);
    if (target.seatAnchor) {
      target.worldX = target.seatAnchor.returnX;
      target.worldY = 0;
      target.worldZ = target.seatAnchor.returnZ;
      target.seatAnchor = null;
      target.seatBlend = 0;
    }
    const dx = target.worldX - fromX;
    const dz = target.worldZ - fromZ;
    const dist = Math.hypot(dx, dz);
    const nx = dist > 0.01 ? dx / dist : 1;
    const nz = dist > 0.01 ? dz / dist : 0;

    target.ragdollTimer = 1.6;
    target.ragdollVx = nx * 6.5;
    target.ragdollVz = nz * 6.5;
    target.ragdollSpin = 0;
    target.pose = 'ragdoll';
    target.stumbleTimer = 0;
    target.activity = 'Flying across the room!!';
    target.thought = 'WHOA—WHAT A KICK!! 💫';
    target.lastEmote = SPECIAL_EMOTES.boom.glyph;
    target.mesh.speechBubble.showEmote(SPECIAL_EMOTES.boom, 'neutral', 2.8, 0.9);
  }

  private updateVisitorRagdoll(
    v: ActiveVisitorRuntime,
    dt: number,
    state: HouseState,
  ): boolean {
    const prevTimer = v.ragdollTimer;
    v.ragdollTimer = Math.max(0, v.ragdollTimer - dt);
    const elapsed = 1.6 - v.ragdollTimer;

    if (elapsed <= 1.1) {
      // Hilarious 1.1s spinning flight with wall-clamped elastic bounces!
      const drag = Math.exp(-1.15 * dt);
      v.ragdollVx *= drag;
      v.ragdollVz *= drag;
      const candX = v.worldX + v.ragdollVx * dt;
      const candZ = v.worldZ + v.ragdollVz * dt;
      const safe = resolveSafeMovement(this.navGrid, v.worldX, v.worldZ, candX, candZ, false);

      // Reflect velocity crisply if clamped against a wall!
      if (Math.abs(safe.wx - candX) > 0.01) v.ragdollVx = -v.ragdollVx * 0.65;
      if (Math.abs(safe.wz - candZ) > 0.01) v.ragdollVz = -v.ragdollVz * 0.65;

      v.worldX = safe.wx;
      v.worldZ = safe.wz;
      const arcT = elapsed / 1.1;
      v.worldY = Math.sin(arcT * Math.PI) * 1.15;
      v.ragdollSpin += dt * 13.5;

      v.mesh.root.position.set(v.worldX, v.worldY, v.worldZ);
      v.mesh.root.rotation.set(Math.sin(v.ragdollSpin) * 0.95, v.rotY + v.ragdollSpin, Math.cos(v.ragdollSpin) * 0.85);
      v.mesh.updateAnimation(dt, 'ragdoll', 4.0);
    } else {
      // 0.5s dizzy recovery on the floor before popping right back up unharmed!
      if (prevTimer > 0.5 && v.ragdollTimer <= 0.5) {
        v.lastEmote = SPECIAL_EMOTES.dizzyStar.glyph;
        v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.dizzyStar, 'neutral', 2.2, 0.7);
      }
      v.worldY = 0;
      v.mesh.root.position.set(v.worldX, 0, v.worldZ);
      v.mesh.root.rotation.set(0, v.rotY, Math.sin(elapsed * 22) * 0.14);
      v.mesh.updateAnimation(dt, 'stumble', v.def.walkSpeed);
    }

    this.clampToCityTerrace(v, state);

    if (v.ragdollTimer <= 0) {
      v.worldY = 0;
      v.ragdollVx = 0;
      v.ragdollVz = 0;
      v.mesh.root.position.set(v.worldX, 0, v.worldZ);
      v.mesh.root.rotation.set(0, v.rotY, 0);
      v.pose = 'idle';
      v.phase = 'idle';
      v.idleTimer = 0.6;
      v.activity = 'Shaking it off';
      v.thought = 'Okay… I am totally fine! That guy hits hard!';
      const fx = Math.floor(v.worldX + state.gridWidth / 2);
      const fz = Math.floor(v.worldZ + state.gridDepth / 2);
      if (inGridBounds(fx, fz, state.gridWidth, state.gridDepth)) {
        v.currentTile = { x: fx, z: fz };
      }
      return true;
    }

    return false;
  }

  private updateSpecialCharacterBehavior(
    v: ActiveVisitorRuntime,
    dt: number,
    _state: HouseState,
    toRemove: ActiveVisitorRuntime[],
  ): { handled: boolean; changed: boolean } {
    let changed = false;

    if (v.squeakPoseTimer > 0) {
      v.squeakPoseTimer = Math.max(0, v.squeakPoseTimer - dt);
    }

    // ---- 1. RICK SANCHEZ: Swirling Green 3D Portal Arrival & Departure ----
    if (v.def.id === 'rick') {
      if (v.specialState === 'rick_portal_in') {
        v.specialActionTimer -= dt;
        const progress = clamp01(1 - v.specialActionTimer / 1.6);
        v.mesh.setScalePop(Math.max(0.05, Math.min(1, progress * 2.2)));
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
        v.mesh.updateAnimation(dt, 'idle', v.def.walkSpeed);
        if (v.specialActionTimer <= 0) {
          v.specialState = 'none';
          v.mesh.setScalePop(1);
          v.activity = 'Inspecting dimension C-137';
          this.pickNextDestination(v);
          changed = true;
        }
        return { handled: true, changed };
      }

      if (v.specialState === 'rick_portal_out') {
        v.specialActionTimer -= dt;
        const progress = clamp01(1 - v.specialActionTimer / 1.45);
        const hopIn = progress > 0.35 ? clamp01((progress - 0.35) / 0.55) : 0;
        v.mesh.setScalePop(Math.max(0.01, 1 - hopIn * hopIn));
        v.mesh.root.position.set(v.worldX, Math.sin(hopIn * Math.PI) * 0.22, v.worldZ);
        v.mesh.updateAnimation(dt, 'walk', v.def.walkSpeed);
        if (v.specialActionTimer <= 0) {
          toRemove.push(v);
          changed = true;
        }
        return { handled: true, changed };
      }

      // Rick leaves via green portal after inspecting the dimension!
      if (v.phase !== 'leaving' && v.phase !== 'waiting_pickup') {
        v.specialTimer -= dt;
        if (v.specialTimer <= 0) {
          v.dismissedVoluntarily = true;
          this.beginLeaving(v, 'Opening green exit portal');
          return { handled: true, changed: true };
        }
      }
      return { handled: false, changed };
    }

    // Skip remaining special behaviors while leaving or arriving via transport
    if (v.phase === 'leaving' || v.phase === 'waiting_pickup' || v.exteriorPath.length > 0) {
      return { handled: false, changed };
    }

    // ---- 2. SQUEAKY CHICKEN: Constant hilarious squeaks every 2.6–4.4s ----
    if (v.def.id === 'squeaky_chicken') {
      v.specialTimer -= dt;
      if (v.specialTimer <= 0) {
        v.specialTimer = 2.6 + Math.random() * 1.8;
        v.squeakPoseTimer = 0.65;
        this.playSpecialSfxSafe('playChickenSqueak');
        v.mesh.specialRig?.triggerSqueakPulse?.();
        const emote = Math.random() < 0.55 ? SPECIAL_EMOTES.chicken : SPECIAL_EMOTES.megaphone;
        v.lastEmote = emote.glyph;
        v.thought = 'BAAAAWK—SQUEEEAK!';
        v.activity = 'Screaming joyfully!';
        v.mesh.speechBubble.showEmote(emote, 'delighted', 2.4, 0.9);
        changed = true;
      }
      return { handled: false, changed };
    }

    // ---- 3. SATORU GOJO: Strictly ONCE Japanese Honored One Levitation Monologue + Forced Camera Focus ----
    if (v.def.id === 'gojo') {
      if (
        v.specialState === 'gojo_line1' ||
        v.specialState === 'gojo_line2' ||
        v.specialState === 'gojo_line3' ||
        v.specialState === 'gojo_descend'
      ) {
        const realDt = dt / Math.max(1, this.store.getSimSpeed());

        // Keep optional MP3 volume/mute synced live with AudioModule
        if (this.gojoVoiceAudio) {
          const audioMod = this.audioModule as unknown as {
            getVolume?: () => number;
            isMuted?: () => boolean;
          } | null;
          this.gojoVoiceAudio.muted = Boolean(audioMod?.isMuted?.());
          this.gojoVoiceAudio.volume = Math.max(0, Math.min(1, audioMod?.getVolume?.() ?? 0.85));
        }

        v.velX = 0;
        v.velZ = 0;
        v.smoothVelX = 0;
        v.smoothVelZ = 0;
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
        v.mesh.updateAnimation(dt, v.specialState === 'gojo_descend' ? 'idle' : 'levitate', v.def.walkSpeed);

        if (v.specialState === 'gojo_descend') {
          v.specialActionTimer -= realDt;
          if (v.specialActionTimer <= 0) {
            v.specialState = 'none';
            v.pose = 'idle';
            v.phase = 'idle';
            v.idleTimer = 0.6;
            v.activity = 'Looking around effortlessly';
            changed = true;
          }
          return { handled: true, changed };
        }

        // Advance monologue in real unscaled time, locking directly to gojoVoiceAudio.currentTime while playing!
        const audioPlaying = Boolean(
          this.gojoVoiceAudio &&
            !this.gojoVoiceAudio.paused &&
            Number.isFinite(this.gojoVoiceAudio.currentTime) &&
            this.gojoVoiceAudio.currentTime > 0,
        );
        v.specialActionTimer = audioPlaying
          ? this.gojoVoiceAudio!.currentTime
          : v.specialActionTimer + realDt;

        const audioEnded = Boolean(this.gojoVoiceAudio?.ended);
        const t = v.specialActionTimer;

        if (v.specialState === 'gojo_line1' && t >= GOJO_MONOLOGUE[1].start) {
          v.specialState = 'gojo_line2';
          const line2 = GOJO_MONOLOGUE[1];
          v.thought = line2.text;
          v.lastEmote = line2.emote.glyph;
          v.mesh.speechBubble.showEmote(line2.emote, 'delighted', 5.0, 1.3);
          this.emitCaption({ speaker: GOJO_SPEAKER, text: line2.text, accent: '#68A8F5' }, v.instanceId);
          changed = true;
        }
        if (v.specialState === 'gojo_line2' && t >= GOJO_MONOLOGUE[2].start) {
          v.specialState = 'gojo_line3';
          const line3 = GOJO_MONOLOGUE[2];
          v.thought = line3.text;
          v.lastEmote = line3.emote.glyph;
          v.mesh.speechBubble.showEmote(line3.emote, 'delighted', line3.duration, 1.5);
          this.emitCaption({ speaker: GOJO_SPEAKER, text: line3.text, accent: '#68A8F5' }, v.instanceId);
          changed = true;
        }
        if (t >= GOJO_MONOLOGUE[2].end || audioEnded) {
          v.specialState = 'gojo_descend';
          v.specialActionTimer = 1.0;
          v.mesh.specialRig?.setAuraActive?.(false);
          this.stopGojoVoiceAudio();
          if (this.activeCaptionOwnerId === v.instanceId) {
            this.emitCaption(null);
          }
          this.releaseGojoCameraFollow(v.instanceId);
          v.activity = 'Floating gently back down';
          changed = true;
        }

        return { handled: true, changed };
      }

      if (!v.gojoHasMonologued && !v.seatAnchor && (v.phase === 'walking' || v.phase === 'idle')) {
        v.specialTimer -= dt;
        if (v.specialTimer <= 0) {
          this.endSocializingFor(v);
          const line1 = GOJO_MONOLOGUE[0];
          v.gojoHasMonologued = true;
          v.specialState = 'gojo_line1';
          v.specialActionTimer = 0;
          v.pose = 'levitate';
          v.activity = 'Ascending as the Honored One';
          v.thought = line1.text;
          v.lastEmote = line1.emote.glyph;
          v.mesh.specialRig?.setAuraActive?.(true);
          this.playGojoVoiceOrSynth();
          this.focusCameraOnGojo(v);
          v.mesh.speechBubble.showEmote(line1.emote, 'delighted', line1.duration, 1.2);
          this.emitCaption({ speaker: GOJO_SPEAKER, text: line1.text, accent: '#68A8F5' }, v.instanceId);
          return { handled: true, changed: true };
        }
      }
      return { handled: false, changed };
    }

    // ---- 4. BAKI HANMA: Stalking, flexing, dashing in & spinning roundhouse kick -> ragdoll! ----
    if (v.def.id === 'baki') {
      if (v.specialState === 'baki_kick') {
        v.specialActionTimer -= dt;
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
        v.mesh.updateAnimation(dt, 'kick', v.def.walkSpeed);
        if (v.specialActionTimer <= 0) {
          v.specialState = 'none';
          v.specialTargetId = null;
          v.specialTimer = 14.0;
          v.pose = 'idle';
          v.phase = 'idle';
          v.idleTimer = 0.8;
          v.activity = 'Flexing victoriously';
          v.thought = 'Heh! Nice flying form! Who wants next round?';
          changed = true;
        }
        return { handled: true, changed };
      }

      if (v.specialState === 'baki_dash') {
        const target = this.active.find((o) => o.instanceId === v.specialTargetId);
        if (
          !target ||
          target.seatAnchor ||
          target.phase === 'leaving' ||
          target.leavingPopTimer > 0 ||
          target.ragdollTimer > 0
        ) {
          v.specialState = 'none';
          v.specialTargetId = null;
          v.specialTimer = 5.0;
          return { handled: false, changed: true };
        }
        const dx = target.worldX - v.worldX;
        const dz = target.worldZ - v.worldZ;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.85) {
          // Execute spinning roundhouse kick & launch target across the room!
          v.rotY = Math.atan2(dx, dz);
          v.targetYaw = v.rotY;
          v.mesh.root.rotation.y = v.rotY;
          v.specialState = 'baki_kick';
          v.specialActionTimer = 0.65;
          v.pose = 'kick';
          v.activity = `Roundhouse kicking ${target.persona.name}!`;
          v.thought = 'HYAAAH!! Feel the Hanma style!!';
          v.lastEmote = SPECIAL_EMOTES.boom.glyph;
          v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.boom, 'delighted', 2.4, 0.8);
          this.playSpecialSfxSafe('playComicKick');
          this.launchVisitorRagdoll(target, v.worldX, v.worldZ);
          return { handled: true, changed: true };
        }

        const dashSpeed = v.def.walkSpeed * 1.45;
        const step = Math.min(dashSpeed * dt, dist);
        const safe = resolveSafeMovement(
          this.navGrid,
          v.worldX,
          v.worldZ,
          v.worldX + (dx / dist) * step,
          v.worldZ + (dz / dist) * step,
          false,
        );
        v.worldX = safe.wx;
        v.worldZ = safe.wz;
        v.rotY = dampAngle(v.rotY, Math.atan2(dx, dz), 12, dt);
        v.mesh.root.rotation.y = v.rotY;
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
        v.mesh.updateAnimation(dt, 'walk', dashSpeed);
        v.specialActionTimer -= dt;
        if (v.specialActionTimer <= 0) {
          v.specialState = 'none';
          v.specialTargetId = null;
          v.specialTimer = 6.0;
        }
        return { handled: true, changed };
      }

      if (!v.seatAnchor && (v.phase === 'walking' || v.phase === 'idle')) {
        v.specialTimer -= dt;
        if (v.specialTimer <= 0) {
          // Find a nearby standing visitor within 3.6 world units
          let bestTarget: ActiveVisitorRuntime | null = null;
          let bestDist = 3.6;
          for (const other of this.active) {
            if (other.instanceId === v.instanceId) continue;
            if (
              other.seatAnchor ||
              other.phase === 'arriving_transport' ||
              other.phase === 'leaving' ||
              other.leavingPopTimer > 0 ||
              other.ragdollTimer > 0 ||
              other.specialState === 'gojo_line1' ||
              other.specialState === 'gojo_line2' ||
              other.specialState === 'gojo_line3'
            ) {
              continue;
            }
            const d = Math.hypot(other.worldX - v.worldX, other.worldZ - v.worldZ);
            if (d < bestDist && this.hasClearLineOfSight(v.worldX, v.worldZ, other.worldX, other.worldZ)) {
              bestDist = d;
              bestTarget = other;
            }
          }
          if (bestTarget) {
            v.specialState = 'baki_dash';
            v.specialTargetId = bestTarget.instanceId;
            v.specialActionTimer = 3.2;
            v.activity = `Dashing at ${bestTarget.persona.name}!`;
            v.thought = 'Show me your guard!! 🥊';
            v.lastEmote = SPECIAL_EMOTES.boxing.glyph;
            v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.boxing, 'delighted', 2.4, 0.7);
            return { handled: true, changed: true };
          }
          // Flex while scanning for a sparring partner
          v.specialTimer = 4.5;
          v.lastEmote = SPECIAL_EMOTES.boxing.glyph;
          v.thought = 'Shadowboxing… looking for a sparring partner!';
          v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.boxing, 'happy', 2.4, 0.7);
          changed = true;
        }
      }
      return { handled: false, changed };
    }

    // ---- 5. WILLIAM SHAKESPEARE: Obnoxious dramatic critic staring intently at other guests ----
    if (v.def.id === 'shakespeare') {
      if (v.specialState === 'bard_stare') {
        const subject = this.active.find((o) => o.instanceId === v.specialTargetId);
        v.specialActionTimer -= dt;
        v.bardStareElapsed += dt;
        if (subject) {
          const dx = subject.worldX - v.worldX;
          const dz = subject.worldZ - v.worldZ;
          if (Math.hypot(dx, dz) > 0.05) {
            v.rotY = dampAngle(v.rotY, Math.atan2(dx, dz), 9, dt);
            v.mesh.root.rotation.y = v.rotY;
          }

          // After ~3.8s of Shakespeare's obnoxious staring, the victim gets annoyed (-12 mood) and walks away!
          if (
            !v.bardAnnoyedVictim &&
            v.bardStareElapsed >= 3.8 &&
            subject.phase !== 'leaving' &&
            subject.leavingPopTimer === 0 &&
            subject.ragdollTimer <= 0
          ) {
            v.bardAnnoyedVictim = true;
            this.triggerShakespeareAnnoyanceEscape(v, subject);
            changed = true;
          }
        }
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
        v.mesh.updateAnimation(dt, 'stare', v.def.walkSpeed);
        if (v.specialActionTimer <= 0 || !subject || subject.leavingPopTimer > 0) {
          v.specialState = 'none';
          v.specialTargetId = null;
          v.bardStareElapsed = 0;
          v.bardAnnoyedVictim = false;
          v.specialTimer = 9.0 + Math.random() * 4.0;
          v.pose = 'idle';
          v.phase = 'idle';
          v.idleTimer = 0.7;
          v.activity = 'Drafting scathing review';
          changed = true;
        }
        return { handled: true, changed };
      }

      if (v.specialState === 'bard_approach') {
        const subject = this.active.find((o) => o.instanceId === v.specialTargetId);
        if (!subject || subject.phase === 'leaving' || subject.leavingPopTimer > 0) {
          v.specialState = 'none';
          v.specialTargetId = null;
          v.specialTimer = 4.0;
          return { handled: false, changed: true };
        }
        const dx = subject.worldX - v.worldX;
        const dz = subject.worldZ - v.worldZ;
        const dist = Math.hypot(dx, dz);
        if (dist <= 1.25) {
          v.specialState = 'bard_stare';
          v.specialActionTimer = 6.0 + Math.random() * 3.0;
          v.bardStareElapsed = 0;
          v.bardAnnoyedVictim = false;
          v.pose = 'stare';
          const quote = SHAKESPEARE_CRITIQUES[Math.floor(Math.random() * SHAKESPEARE_CRITIQUES.length)];
          const emote = Math.random() < 0.6 ? SPECIAL_EMOTES.raisedBrow : SPECIAL_EMOTES.quill;
          v.activity = `Critically staring at ${subject.persona.name}`;
          v.thought = quote;
          v.lastEmote = emote.glyph;
          v.mesh.speechBubble.showEmote(emote, 'neutral', 3.8, 1.0);
          return { handled: true, changed: true };
        }

        const step = Math.min(v.def.walkSpeed * dt, dist);
        const safe = resolveSafeMovement(
          this.navGrid,
          v.worldX,
          v.worldZ,
          v.worldX + (dx / dist) * step,
          v.worldZ + (dz / dist) * step,
          false,
        );
        v.worldX = safe.wx;
        v.worldZ = safe.wz;
        v.rotY = dampAngle(v.rotY, Math.atan2(dx, dz), 9, dt);
        v.mesh.root.rotation.y = v.rotY;
        v.mesh.root.position.set(v.worldX, 0, v.worldZ);
        v.mesh.updateAnimation(dt, 'walk', v.def.walkSpeed);
        v.specialActionTimer -= dt;
        if (v.specialActionTimer <= 0) {
          v.specialState = 'none';
          v.specialTargetId = null;
          v.specialTimer = 5.0;
        }
        return { handled: true, changed };
      }

      if (!v.seatAnchor && (v.phase === 'walking' || v.phase === 'idle')) {
        v.specialTimer -= dt;
        if (v.specialTimer <= 0) {
          const candidates = this.active.filter(
            (o) =>
              o.instanceId !== v.instanceId &&
              o.phase !== 'arriving_transport' &&
              o.phase !== 'leaving' &&
              o.leavingPopTimer === 0,
          );
          if (candidates.length > 0) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            v.specialState = 'bard_approach';
            v.specialTargetId = pick.instanceId;
            v.specialActionTimer = 5.5;
            v.activity = `Approaching ${pick.persona.name} to critique`;
            v.thought = 'Let us inspect this mortal up close…';
            return { handled: true, changed: true };
          }
          v.specialTimer = 7.0;
          v.lastEmote = SPECIAL_EMOTES.quill.glyph;
          v.thought = SHAKESPEARE_CRITIQUES[0];
          v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.quill, 'neutral', 3.2, 0.9);
          changed = true;
        }
      }
      return { handled: false, changed };
    }

    return { handled: false, changed };
  }

  private pickSpecialDestination(
    v: ActiveVisitorRuntime,
    state: HouseState,
    reachable: Map<number, number>,
    reservedTiles: Set<number>,
  ): boolean {
    const pickMatchingItem = (
      matcher: (item: PlacedItem, def: FurnitureItemDef) => boolean,
      requireFreeSeat = false,
    ): { item: PlacedItem; def: FurnitureItemDef; tile: GridCoord; faceWorld: WorldPoint } | null => {
      let best: { item: PlacedItem; def: FurnitureItemDef; tile: GridCoord; faceWorld: WorldPoint; dist: number } | null =
        null;
      for (const item of state.items) {
        if (item.itemId === 'toilet_cozy') continue;
        const def = this.store.data.itemsById.get(item.itemId);
        if (!def || !matcher(item, def)) continue;
        if (requireFreeSeat) {
          const slots = getSeatSlotsForItem(def);
          if (!slots || slots.length === 0) continue;
          let free = false;
          for (let i = 0; i < slots.length; i++) {
            if (!this.isSeatSlotTaken(item.uid, i, v.instanceId)) {
              free = true;
              break;
            }
          }
          if (!free) continue;
        }
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
        const dist = reachable.get(tileIndex(approach.tile.x, approach.tile.z, state.gridDepth)) ?? 99;
        const repeatPen = item.uid === v.lastTargetItemUid ? 8 : 0;
        if (!best || dist + repeatPen < best.dist) {
          best = { item, def, tile: approach.tile, faceWorld: approach.faceWorld, dist: dist + repeatPen };
        }
      }
      return best;
    };

    const routeToMatch = (
      match: { item: PlacedItem; def: FurnitureItemDef; tile: GridCoord; faceWorld: WorldPoint },
      activity: string,
      thought: string,
    ): boolean => {
      const pathTiles = this.computePathAvoidingVisitors(v, match.tile);
      if (!pathTiles) return false;
      v.phase = 'walking';
      v.pose = 'walk';
      v.targetItemUid = match.item.uid;
      v.lastTargetItemUid = match.item.uid;
      v.targetTile = match.tile;
      v.faceTarget = match.faceWorld;
      v.pathTiles = pathTiles;
      v.path = pathTiles.map((t) => tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth));
      v.blockedProgressTimer = 0;
      v.lastWaypointDist = Infinity;
      v.activity = activity;
      v.thought = thought;
      this.emitChange();
      return true;
    };

    // 6. PHILOSOPHER (Socrates): beelines straight to nearest couch/armchair for 26–38s Thinker pose!
    if (v.def.id === 'philosopher') {
      const seat = pickMatchingItem((_it, def) => Boolean(getSeatSlotsForItem(def)), true);
      if (seat) {
        return routeToMatch(
          seat,
          `Seeking ${seat.def.name} to ponder`,
          'Ah, a seat worthy of deep contemplation…',
        );
      }
      return false;
    }

    // 7. JOHN WICK: marches purposefully to any cat/pet item!
    if (v.def.id === 'john_wick') {
      if (v.specialState === 'wick_done') {
        v.dismissedVoluntarily = true;
        this.beginLeaving(v, 'Mission accomplished — heading out');
        return true;
      }
      const pet = pickMatchingItem(
        (it, def) => WICK_PET_IDS.has(it.itemId) || def.tags.includes('cat') || def.tags.includes('pet'),
      );
      if (pet) {
        return routeToMatch(
          pet,
          `Marching purposefully to ${pet.def.name}`,
          'I need to say hello to this kitty.',
        );
      }
      return false;
    }

    // 8. ROCKY: zooms happily at 1.8x speed across 5–6 points exploring the entire house, then exits!
    if (v.def.id === 'rocky') {
      if (v.specialCounter <= 0) {
        v.dismissedVoluntarily = true;
        v.thought = 'Amaze! Amaze! Heading back to Hail Mary!';
        this.beginLeaving(v, 'Amaze! Zipping home!');
        return true;
      }
      const explorePool = state.items.filter((it) => {
        const d = this.store.data.itemsById.get(it.itemId);
        return d && d.layer === 'floor' && d.subLayer === 'object' && it.uid !== v.lastTargetItemUid;
      });
      if (explorePool.length > 0) {
        const chosenItem = explorePool[Math.floor(Math.random() * explorePool.length)];
        const chosenDef = this.store.data.itemsById.get(chosenItem.itemId);
        if (chosenDef) {
          const approach = resolveItemApproach(
            this.navGrid,
            state,
            this.store.data,
            chosenItem,
            chosenDef,
            reachable,
            reservedTiles,
          );
          if (approach) {
            return routeToMatch(
              { item: chosenItem, def: chosenDef, tile: approach.tile, faceWorld: approach.faceWorld },
              `Scurrying to inspect ${chosenDef.name}!`,
              'Amaze! What is this object, question?',
            );
          }
        }
      }
      // Fallback: scurry to any distant reachable tile across the house
      const tiles = Array.from(reachable.keys());
      if (tiles.length > 1) {
        const idx = tiles[Math.floor(Math.random() * tiles.length)];
        const tx = Math.floor(idx / state.gridDepth);
        const tz = idx % state.gridDepth;
        const pathTiles = this.computePathAvoidingVisitors(v, { x: tx, z: tz });
        if (pathTiles && pathTiles.length > 0) {
          v.phase = 'walking';
          v.pose = 'walk';
          v.targetItemUid = null;
          v.targetTile = { x: tx, z: tz };
          v.pathTiles = pathTiles;
          v.path = pathTiles.map((t) => tileCenterToWorld(t.x, t.z, state.gridWidth, state.gridDepth));
          v.activity = 'Scurrying across the house!';
          v.thought = 'Amaze! Exploring every corner!';
          this.emitChange();
          return true;
        }
      }
      return false;
    }

    // 9. HOMER SIMPSON: Stage 1 beelines to food/pastry/coffee -> Stage 2 beelines to bed/couch for a big nap!
    if (v.def.id === 'homer') {
      if (v.specialState === 'homer_sleep') {
        const napSpot = pickMatchingItem(
          (it, def) =>
            it.itemId.startsWith('bed_') ||
            it.itemId.startsWith('sofa_') ||
            it.itemId.startsWith('loveseat_') ||
            def.tags.includes('sleep') ||
            Boolean(getSeatSlotsForItem(def)),
          true,
        );
        if (napSpot) {
          return routeToMatch(
            napSpot,
            `Waddling to ${napSpot.def.name} for a nap`,
            'Zzz… couch calling my name…',
          );
        }
        // No seat/bed placed -> snooze right in place!
        v.phase = 'using';
        v.pose = 'sleep';
        v.useTimer = 16 + Math.random() * 6;
        v.activity = 'Fast asleep snoring';
        v.thought = 'Zzz… donuts… Zzz…';
        v.lastEmote = SPECIAL_EMOTES.zzz.glyph;
        v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.zzz, 'happy', 4.0, 0.9);
        this.emitChange();
        return true;
      }

      const food = pickMatchingItem(
        (it, def) =>
          HOMER_FOOD_IDS.has(it.itemId) ||
          it.itemId.startsWith('fridge_') ||
          def.tags.includes('food') ||
          def.tags.includes('coffee') ||
          def.tags.includes('cafe') ||
          def.tags.includes('dining') ||
          def.tags.includes('cook'),
      );
      if (food) {
        v.specialState = 'homer_eat';
        return routeToMatch(
          food,
          `Heading straight for ${food.def.name}!`,
          'Mmm… snacks ahead…',
        );
      }
      // If no food station exists, skip straight to napping!
      v.specialState = 'homer_sleep';
      return false;
    }

    // 1. VIKING (Bjorn): bold marches to dining/drinks/warm light!
    if (v.def.id === 'viking') {
      const feast = pickMatchingItem(
        (_it, def) =>
          def.tags.includes('dining') ||
          def.tags.includes('drinks') ||
          def.tags.includes('food') ||
          def.tags.includes('light') ||
          def.tags.includes('cafe'),
      );
      if (feast) {
        return routeToMatch(
          feast,
          `Marching boldly to ${feast.def.name}`,
          'SKÅL! A hall worthy of Valhalla!',
        );
      }
      return false;
    }

    // 10. RICK: inspects gadgets, drinks, & screens!
    if (v.def.id === 'rick') {
      const gadget = pickMatchingItem(
        (it, def) =>
          RICK_GADGET_IDS.has(it.itemId) ||
          def.tags.includes('drinks') ||
          def.tags.includes('party') ||
          def.tags.includes('media') ||
          def.tags.includes('nightlife'),
      );
      if (gadget) {
        return routeToMatch(
          gadget,
          `Inspecting ${gadget.def.name}`,
          '*burp* Let us see what tech this dimension has.',
        );
      }
      return false;
    }

    return false;
  }

  private handleSpecialArrival(
    v: ActiveVisitorRuntime,
    item: PlacedItem,
    def: FurnitureItemDef,
    state: HouseState,
  ): boolean {
    void state;

    // 1. VIKING: SKÅL!
    if (v.def.id === 'viking') {
      v.phase = 'using';
      v.pose = 'admire';
      v.useTimer = 4.6 + Math.random() * 2.0;
      v.activity = `Toasting ${def.name}!`;
      v.thought = 'SKÅL! A hall worthy of Valhalla!';
      const emotes = [SPECIAL_EMOTES.sword, SPECIAL_EMOTES.beer, SPECIAL_EMOTES.fire];
      const e = emotes[Math.floor(Math.random() * emotes.length)];
      v.lastEmote = e.glyph;
      v.mesh.speechBubble.showEmote(e, 'delighted', 3.6, 1.0);
      this.emitChange();
      return true;
    }

    // 6. PHILOSOPHER (Socrates): sits on cushion in Rodin's 'thinker' pose for 26–38s!
    if (v.def.id === 'philosopher' && getSeatSlotsForItem(def)) {
      const seatAnchor = this.resolveAvailableSeatAnchor(item, def, v.worldX, v.worldZ, v.instanceId);
      if (seatAnchor) {
        v.seatAnchor = seatAnchor;
        v.seatBlend = 0;
        v.phase = 'mounting_seat';
        v.pose = 'thinker';
        v.useTimer = 26 + Math.random() * 12;
        v.targetYaw = seatAnchor.facingYaw;
        v.activity = `Pondering existence on ${def.name}`;
        const q = PHILOSOPHER_THOUGHTS[Math.floor(Math.random() * PHILOSOPHER_THOUGHTS.length)];
        v.thought = q;
        v.lastEmote = SPECIAL_EMOTES.thinking.glyph;
        v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.thinking, 'happy', 4.2, 1.0);
        this.emitChange();
        return true;
      }
    }

    // 7. JOHN WICK: kneels to pet the kitty tenderly (4.5s) -> delighted (100) -> exits front door!
    if (
      v.def.id === 'john_wick' &&
      (WICK_PET_IDS.has(item.itemId) || def.tags.includes('cat') || def.tags.includes('pet'))
    ) {
      v.specialState = 'wick_pet';
      v.phase = 'using';
      v.pose = 'pet';
      v.useTimer = 4.5;
      v.mood = 'delighted';
      v.moodScore = 100;
      v.reliefMoodBonus = 20;
      v.mesh.setMood('delighted');
      v.activity = `Petting ${def.name}`;
      v.thought = "Good kitty. Very good kitty. Yeah, I'm happy.";
      const e = Math.random() < 0.6 ? SPECIAL_EMOTES.heart : SPECIAL_EMOTES.paw;
      v.lastEmote = e.glyph;
      v.mesh.speechBubble.showEmote(e, 'delighted', 4.2, 1.1);
      if (def.interaction) {
        this.store.triggerInteraction(item.uid);
      }
      this.emitChange();
      return true;
    }

    // 8. ROCKY: plays Eridian chords + jazz hands, decrements stop counter!
    if (v.def.id === 'rocky') {
      v.specialCounter = Math.max(0, v.specialCounter - 1);
      v.phase = 'using';
      v.pose = 'admire';
      v.useTimer = 1.4 + Math.random() * 0.5;
      const quote = ROCKY_QUOTES[Math.floor(Math.random() * ROCKY_QUOTES.length)];
      const e = Math.random() < 0.5 ? SPECIAL_EMOTES.spider : SPECIAL_EMOTES.music;
      v.activity = `Inspecting ${def.name} (jazz hands!)`;
      v.thought = quote;
      v.lastEmote = e.glyph;
      v.mesh.speechBubble.showEmote(e, 'delighted', 2.6, 0.9);
      this.playSpecialSfxSafe('playRockyChords');
      this.emitChange();
      return true;
    }

    // 9. HOMER SIMPSON: chomps voraciously ('eat', 7s) OR snoozes on bed/couch ('sleep', 16–22s)!
    if (v.def.id === 'homer') {
      if (v.specialState === 'homer_sleep' && getSeatSlotsForItem(def)) {
        const seatAnchor = this.resolveAvailableSeatAnchor(item, def, v.worldX, v.worldZ, v.instanceId);
        if (seatAnchor) {
          v.seatAnchor = seatAnchor;
          v.seatBlend = 0;
          v.phase = 'mounting_seat';
          v.pose = 'sleep';
          v.useTimer = 16 + Math.random() * 6;
          v.targetYaw = seatAnchor.facingYaw;
          v.activity = `Fast asleep snoring on ${def.name}`;
          v.thought = 'Zzz… donuts… Zzz…';
          const e = Math.random() < 0.55 ? SPECIAL_EMOTES.zzz : SPECIAL_EMOTES.sleepy;
          v.lastEmote = e.glyph;
          v.mesh.speechBubble.showEmote(e, 'happy', 4.2, 0.9);
          this.emitChange();
          return true;
        }
      }

      if (
        v.specialState === 'homer_eat' &&
        (HOMER_FOOD_IDS.has(item.itemId) ||
          item.itemId.startsWith('fridge_') ||
          def.tags.includes('food') ||
          def.tags.includes('coffee') ||
          def.tags.includes('cafe') ||
          def.tags.includes('dining') ||
          def.tags.includes('cook'))
      ) {
        v.phase = 'using';
        v.pose = 'eat';
        v.useTimer = 7.0;
        v.activity = `Chomping near ${def.name}!`;
        v.thought = 'Mmm… pastries… *gargle*';
        const e = Math.random() < 0.65 ? SPECIAL_EMOTES.donut : SPECIAL_EMOTES.coffee;
        v.lastEmote = e.glyph;
        v.mesh.speechBubble.showEmote(e, 'delighted', 4.0, 1.1);
        this.emitChange();
        return true;
      }
    }

    // 10. RICK: gadget/drinks inspection!
    if (v.def.id === 'rick') {
      v.phase = 'using';
      v.pose = 'admire';
      v.useTimer = 4.2 + Math.random() * 2.0;
      v.activity = `Scanning ${def.name}`;
      v.thought = '*burp* Nice little dimension you got here.';
      v.lastEmote = SPECIAL_EMOTES.portal.glyph;
      v.mesh.speechBubble.showEmote(SPECIAL_EMOTES.portal, 'happy', 3.4, 0.9);
      this.emitChange();
      return true;
    }

    return false;
  }
}
