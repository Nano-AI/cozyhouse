import * as THREE from 'three';
import type { GridCoord, WorldPoint } from './Pathfinder';

export type TransportKind = 'car' | 'boat' | 'elevator' | 'trail';

export interface BiomeRoute {
  kind: TransportKind;
  /** World spot where visitor emerges (dropoff) or stands waiting (pickup). */
  stopPoint: WorldPoint;
  /** Ordered exterior waypoints leading from stopPoint to the lot edge. */
  approachWaypoints: WorldPoint[];
  /** Ordered exterior waypoints leading from the lot edge back to stopPoint. */
  exitWaypoints: WorldPoint[];
  /** Target tile inside the buildable lot perimeter closest to the biome entrance. */
  lotEdgeTile: GridCoord;
  /** Friendly status label shown while transport is bringing the visitor in. */
  arrivalLabel: string;
  /** Optional friendly status label shown while visitor departs along the route. */
  departureLabel?: string;
}

interface ActiveVehicleTrip {
  id: number;
  kind: 'car' | 'boat';
  mode: 'arrive' | 'depart';
  group: THREE.Group;
  wheels: THREE.Object3D[];
  baseY: number;
  startX: number;
  stopX: number;
  endX: number;
  laneZ: number;
  phase: 'approach' | 'dwell' | 'depart';
  timer: number;
  approachDuration: number;
  dwellDuration: number;
  departDuration: number;
  callbackFired: boolean;
  onAtStop: () => void;
  phaseOffset: number;
}

interface CityElevatorRig {
  group: THREE.Group;
  leftDoor: THREE.Mesh;
  rightDoor: THREE.Mesh;
  interiorGlowMat: THREE.MeshStandardMaterial;
  indicatorMat: THREE.MeshStandardMaterial;
  openProgress: number;
  holdTimer: number;
  pendingCallbacks: Array<{ delay: number; fn: () => void }>;
}

const CAR_PALETTE = ['#F09E8C', '#8AC0DE', '#F2D27E', '#9ACBA6', '#CBB0E2', '#F2B8C6'];
const BOAT_PALETTE = ['#F2A590', '#86C8CF', '#F2D488', '#A5CFA8', '#DFB6CE'];
const GROUND_Y = -0.015;
const CITY_STREET_Y = -34;

function easeOutCubic(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - k, 3);
}

function easeInCubic(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * k;
}

function disposeGroupResources(group: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (obj.geometry) geos.add(obj.geometry);
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) mats.add(m);
      } else if (obj.material) {
        mats.add(obj.material);
      }
    }
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}

/**
 * Manages biome-specific arrival and departure animations for visitors:
 * - `suburbs`: Pastel low-poly car driving up along the suburban street curb, pausing at the front walkway, and driving away.
 * - `beach`: Pastel wooden boat gliding across the turquoise lagoon to the wooden pier tip and sailing back out.
 * - `city`: Persistent brass-and-glass rooftop terrace elevator kiosk with smoothly sliding frosted-glass doors & warm cabin glow.
 * - `forest` / `countryside` / `mountains`: Organic distant trail waypoints along the biome's natural path.
 */
export class ArrivalTransportManager {
  readonly root = new THREE.Group();

  private biome = 'suburbs';
  private gridWidth = 16;
  private gridDepth = 16;
  private trips: ActiveVehicleTrip[] = [];
  private elevator: CityElevatorRig | null = null;
  private tripSeq = 1;
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.root.name = 'ArrivalTransportRoot';
    scene.add(this.root);
  }

  /**
   * Syncs active biome and lot dimensions. Rebuilds the persistent City elevator kiosk
   * only when switching into/out of `city` or resizing the lot.
   * Returns `true` if the biome changed (never fires stale dropoff callbacks from old biomes).
   */
  syncEnvironment(biome: string, gridWidth: number, gridDepth: number): boolean {
    const changed =
      this.biome !== biome || this.gridWidth !== gridWidth || this.gridDepth !== gridDepth;
    if (!changed) return false;

    const biomeChanged = this.biome !== biome;
    this.biome = biome;
    this.gridWidth = gridWidth;
    this.gridDepth = gridDepth;

    // Cancel old-biome vehicle trips cleanly WITHOUT firing stale dropoff coordinates!
    if (biomeChanged) {
      this.clearActiveTrips(false);
    }

    // Rebuild or tear down City terrace elevator kiosk
    if (this.elevator) {
      if (!biomeChanged) {
        for (const p of this.elevator.pendingCallbacks) {
          p.fn();
        }
      }
      this.root.remove(this.elevator.group);
      disposeGroupResources(this.elevator.group);
      this.elevator = null;
    }

    if (this.biome === 'city') {
      this.elevator = this.createCityElevatorKiosk(gridDepth / 2);
      this.root.add(this.elevator.group);
    }

    return biomeChanged;
  }

  /**
   * Computes exact world-aligned dropoff/pickup coordinates & exterior waypoints matching `BackdropBuilder.ts`.
   */
  computeRoute(slotOffsetIndex = 0): BiomeRoute {
    const halfW = this.gridWidth / 2;
    const halfD = this.gridDepth / 2;
    const centerTileX = Math.floor(this.gridWidth / 2);

    switch (this.biome) {
      case 'suburbs': {
        // Curbside walkway & gate at x=0, z=-(halfD+4.2) -> -(halfD+1.45) -> lot north edge
        const stopOffsets = [0, -2.1, 2.1];
        const stopX = stopOffsets[slotOffsetIndex % stopOffsets.length];
        const sidewalkZ = -(halfD + 4.15);
        const gateZ = -(halfD + 1.45);
        const entryZ = -(halfD - 0.5);
        const stopPoint: WorldPoint = { wx: stopX, wz: sidewalkZ };
        const approachWaypoints: WorldPoint[] = [
          { wx: 0, wz: sidewalkZ + 0.35 },
          { wx: 0, wz: gateZ },
          { wx: 0, wz: entryZ },
        ];
        return {
          kind: 'car',
          stopPoint,
          approachWaypoints,
          exitWaypoints: [
            { wx: 0, wz: entryZ },
            { wx: 0, wz: gateZ },
            { wx: 0, wz: sidewalkZ + 0.35 },
            stopPoint,
          ],
          lotEdgeTile: { x: centerTileX, z: 0 },
          arrivalLabel: 'Pulling up by car',
        };
      }

      case 'beach': {
        // Wooden pier on North (-Z) cove: pierZStart = -(sandScaleZ - 1.2), 8 planks * 0.58
        const sandScaleZ = halfD * 1.42 + 4.4;
        const pierZStart = -(sandScaleZ - 1.2);
        const pierTipZ = pierZStart - 7 * 0.58;
        const entryZ = -(halfD - 0.5);
        const stopPoint: WorldPoint = { wx: 0, wz: pierTipZ + 0.2 };
        const approachWaypoints: WorldPoint[] = [
          { wx: 0, wz: pierZStart },
          { wx: 0, wz: -(halfD + 1.3) },
          { wx: 0, wz: entryZ },
        ];
        return {
          kind: 'boat',
          stopPoint,
          approachWaypoints,
          exitWaypoints: [
            { wx: 0, wz: entryZ },
            { wx: 0, wz: -(halfD + 1.3) },
            { wx: 0, wz: pierZStart },
            stopPoint,
          ],
          lotEdgeTile: { x: centerTileX, z: 0 },
          arrivalLabel: 'Arriving by boat',
        };
      }

      case 'city': {
        // Persistent brass-and-glass elevator kiosk flush outside North terrace edge
        const cabZ = -(halfD + 0.85);
        const thresholdZ = -(halfD + 0.05);
        const entryZ = -(halfD - 0.5);
        const stopPoint: WorldPoint = { wx: 0, wz: cabZ };
        return {
          kind: 'elevator',
          stopPoint,
          approachWaypoints: [
            { wx: 0, wz: thresholdZ },
            { wx: 0, wz: entryZ },
          ],
          exitWaypoints: [
            { wx: 0, wz: entryZ },
            { wx: 0, wz: thresholdZ },
            stopPoint,
          ],
          lotEdgeTile: { x: centerTileX, z: 0 },
          arrivalLabel: 'Taking the elevator',
        };
      }

      case 'forest': {
        // Curving dirt woodland stepping-stone trail along North (-Z) edge
        const trailSteps = [6, 5, 3, 1, 0];
        const pts: WorldPoint[] = trailSteps.map((i) => ({
          wx: Math.sin(i * 0.45) * 2.2,
          wz: -(halfD + 1.6) - i * 1.9,
        }));
        const entryZ = -(halfD - 0.5);
        return {
          kind: 'trail',
          stopPoint: pts[0],
          approachWaypoints: [...pts.slice(1), { wx: 0, wz: entryZ }],
          exitWaypoints: [{ wx: 0, wz: entryZ }, ...[...pts].reverse()],
          lotEdgeTile: { x: centerTileX, z: 0 },
          arrivalLabel: 'Walking up the forest trail',
        };
      }

      case 'countryside': {
        // Open split-rail pasture gate at (0.15, -(halfD + 1.85)) leading from dirt country lane
        const laneZ = -(halfD + 13.4);
        const gateZ = -(halfD + 1.85);
        const entryZ = -(halfD - 0.5);
        const stopPoint: WorldPoint = { wx: 0.15, wz: laneZ };
        return {
          kind: 'trail',
          stopPoint,
          approachWaypoints: [
            { wx: 0.15, wz: -(halfD + 7.2) },
            { wx: 0.15, wz: gateZ },
            { wx: 0.15, wz: entryZ },
          ],
          exitWaypoints: [
            { wx: 0.15, wz: entryZ },
            { wx: 0.15, wz: gateZ },
            { wx: 0.15, wz: -(halfD + 7.2) },
            stopPoint,
          ],
          lotEdgeTile: { x: centerTileX, z: 0 },
          arrivalLabel: 'Strolling up the country lane',
        };
      }

      case 'backrooms': {
        // Mono-yellow Level 0 corridor leading straight down into the North (-Z) lot edge
        const farZ = -(halfD + 7.5);
        const midZ = -(halfD + 3.6);
        const nearZ = -(halfD + 1.15);
        const entryZ = -(halfD - 0.5);
        const stopPoint: WorldPoint = { wx: 0, wz: farZ };
        return {
          kind: 'trail',
          stopPoint,
          approachWaypoints: [
            { wx: 0, wz: midZ },
            { wx: 0, wz: nearZ },
            { wx: 0, wz: entryZ },
          ],
          exitWaypoints: [
            { wx: 0, wz: entryZ },
            { wx: 0, wz: nearZ },
            { wx: 0, wz: midZ },
            stopPoint,
          ],
          lotEdgeTile: { x: centerTileX, z: 0 },
          arrivalLabel: 'Wandering out of the corridors',
          departureLabel: 'Slipping back into the corridors',
        };
      }

      case 'mountains':
      default: {
        // Dry South-East alpine meadow trail (cleanly avoids the North/West alpine river!)
        const trailX = Math.min(halfW - 1.2, Math.max(0.5, halfW * 0.25));
        const farZ = halfD + 11.8;
        const entryZ = halfD - 0.5;
        const tileX = Math.max(0, Math.min(this.gridWidth - 1, Math.floor(trailX + halfW)));
        const stopPoint: WorldPoint = { wx: trailX, wz: farZ };
        return {
          kind: 'trail',
          stopPoint,
          approachWaypoints: [
            { wx: trailX, wz: halfD + 6.0 },
            { wx: trailX, wz: halfD + 1.4 },
            { wx: trailX, wz: entryZ },
          ],
          exitWaypoints: [
            { wx: trailX, wz: entryZ },
            { wx: trailX, wz: halfD + 1.4 },
            { wx: trailX, wz: halfD + 6.0 },
            stopPoint,
          ],
          lotEdgeTile: { x: tileX, z: this.gridDepth - 1 },
          arrivalLabel: 'Hiking up the mountain path',
        };
      }
    }
  }

  /**
   * Dispatches a biome-appropriate arrival animation (car / boat / elevator / trail)
   * and invokes `onEmerge()` at the exact moment the visitor should step out!
   */
  dispatchArrival(route: BiomeRoute, onEmerge: () => void): void {
    if (route.kind === 'car') {
      this.spawnCarTrip('arrive', route.stopPoint.wx, onEmerge);
      return;
    }
    if (route.kind === 'boat') {
      this.spawnBoatTrip('arrive', route.stopPoint.wx, onEmerge);
      return;
    }
    if (route.kind === 'elevator' && this.elevator) {
      this.elevator.holdTimer = Math.max(this.elevator.holdTimer, 1.85);
      this.elevator.pendingCallbacks.push({ delay: 0.42, fn: onEmerge });
      return;
    }
    // Organic trail walk-in starts immediately from far trail point
    onEmerge();
  }

  /**
   * Dispatches a biome-appropriate departure pickup (car / boat / elevator / trail)
   * and invokes `onBoarded()` when the visitor boards and should pop out cleanly!
   */
  dispatchDeparture(route: BiomeRoute, onBoarded: () => void): void {
    if (route.kind === 'car') {
      this.spawnCarTrip('depart', route.stopPoint.wx, onBoarded);
      return;
    }
    if (route.kind === 'boat') {
      this.spawnBoatTrip('depart', route.stopPoint.wx, onBoarded);
      return;
    }
    if (route.kind === 'elevator' && this.elevator) {
      this.elevator.holdTimer = Math.max(this.elevator.holdTimer, 1.55);
      this.elevator.pendingCallbacks.push({ delay: 0.38, fn: onBoarded });
      return;
    }
    onBoarded();
  }

  private spawnCarTrip(mode: 'arrive' | 'depart', stopX: number, onAtStop: () => void): void {
    const halfD = this.gridDepth / 2;
    const roadZ = -(halfD + 6.45);
    const laneZ = roadZ + 0.68; // Curbside lane right beside the front garden walkway
    const id = this.tripSeq++;
    const paint = CAR_PALETTE[id % CAR_PALETTE.length];
    const { group, wheels } = this.buildPastelCar(paint);

    const startX = -26;
    const endX = 28;
    group.position.set(startX, GROUND_Y + 0.025, laneZ);
    this.root.add(group);

    this.trips.push({
      id,
      kind: 'car',
      mode,
      group,
      wheels,
      baseY: GROUND_Y + 0.025,
      startX,
      stopX,
      endX,
      laneZ,
      phase: 'approach',
      timer: 0,
      approachDuration: 1.95,
      dwellDuration: mode === 'arrive' ? 0.95 : 0.75,
      departDuration: 1.9,
      callbackFired: false,
      onAtStop,
      phaseOffset: id * 1.1,
    });
  }

  private spawnBoatTrip(mode: 'arrive' | 'depart', stopX: number, onAtStop: () => void): void {
    const halfD = this.gridDepth / 2;
    const sandScaleZ = halfD * 1.42 + 4.4;
    const pierTipZ = -(sandScaleZ - 1.2) - 7 * 0.58;
    const dockZ = pierTipZ - 1.18;
    const id = this.tripSeq++;
    const hullColor = BOAT_PALETTE[id % BOAT_PALETTE.length];
    const group = this.buildPastelBoat(hullColor);

    const fromLeft = id % 2 === 0;
    const startX = fromLeft ? -23 : 23;
    const endX = fromLeft ? 25 : -25;
    group.rotation.y = fromLeft ? 0 : Math.PI;
    group.position.set(startX, GROUND_Y - 0.04, dockZ);
    this.root.add(group);

    this.trips.push({
      id,
      kind: 'boat',
      mode,
      group,
      wheels: [],
      baseY: GROUND_Y - 0.04,
      startX,
      stopX,
      endX,
      laneZ: dockZ,
      phase: 'approach',
      timer: 0,
      approachDuration: 2.1,
      dwellDuration: mode === 'arrive' ? 1.0 : 0.8,
      departDuration: 2.1,
      callbackFired: false,
      onAtStop,
      phaseOffset: id * 1.7,
    });
  }

  /**
   * Builds a clean, zero-Z-fighting low-poly pastel compact car (facing +X).
   */
  private buildPastelCar(paintHex: string): { group: THREE.Group; wheels: THREE.Object3D[] } {
    const g = new THREE.Group();
    const paintMat = new THREE.MeshStandardMaterial({
      color: paintHex,
      roughness: 0.62,
      metalness: 0.08,
      flatShading: true,
    });
    const roofMat = new THREE.MeshStandardMaterial({
      color: '#FAF4EA',
      roughness: 0.72,
      flatShading: true,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#5D7082',
      roughness: 0.25,
      metalness: 0.18,
      flatShading: true,
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: '#3B3A3E',
      roughness: 0.9,
      flatShading: true,
    });
    const hubMat = new THREE.MeshStandardMaterial({
      color: '#EFEAE2',
      roughness: 0.5,
      metalness: 0.2,
      flatShading: true,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: '#DDD7CE',
      roughness: 0.4,
      metalness: 0.45,
      flatShading: true,
    });
    const headLightMat = new THREE.MeshStandardMaterial({
      color: '#FFF6CF',
      emissive: '#FFE588',
      emissiveIntensity: 0.85,
      roughness: 0.25,
    });
    const tailLightMat = new THREE.MeshStandardMaterial({
      color: '#E86A62',
      emissive: '#E04F47',
      emissiveIntensity: 0.65,
      roughness: 0.3,
    });

    const addPart = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      cast = true,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    // Lower body chassis (y: 0.14..0.48)
    addPart(new THREE.BoxGeometry(1.88, 0.34, 0.92), paintMat, 0, 0.31, 0);
    // Upper cabin strictly above chassis (y: 0.485..0.785 — zero coplanar overlap!)
    addPart(new THREE.BoxGeometry(1.02, 0.3, 0.82), paintMat, -0.08, 0.635, 0);
    // Cream roof cap cleanly proud above cabin (y: 0.788..0.832)
    addPart(new THREE.BoxGeometry(1.04, 0.044, 0.84), roofMat, -0.08, 0.81, 0);

    // Front & rear windshields cleanly proud of cabin X faces (+0.012)
    addPart(new THREE.BoxGeometry(0.02, 0.21, 0.72), glassMat, 0.442, 0.64, 0, false);
    addPart(new THREE.BoxGeometry(0.02, 0.2, 0.72), glassMat, -0.602, 0.64, 0, false);
    // Side windows cleanly proud of cabin Z faces (+0.012)
    addPart(new THREE.BoxGeometry(0.84, 0.19, 0.02), glassMat, -0.08, 0.64, 0.422, false);
    addPart(new THREE.BoxGeometry(0.84, 0.19, 0.02), glassMat, -0.08, 0.64, -0.422, false);

    // Bumpers cleanly proud at x = ±0.96
    addPart(new THREE.BoxGeometry(0.07, 0.08, 0.95), chromeMat, 0.96, 0.2, 0);
    addPart(new THREE.BoxGeometry(0.07, 0.08, 0.95), chromeMat, -0.96, 0.2, 0);

    // Warm headlights (+X) & red taillights (-X) proud of body ends
    addPart(new THREE.BoxGeometry(0.03, 0.09, 0.15), headLightMat, 0.952, 0.34, 0.31, false);
    addPart(new THREE.BoxGeometry(0.03, 0.09, 0.15), headLightMat, 0.952, 0.34, -0.31, false);
    addPart(new THREE.BoxGeometry(0.03, 0.08, 0.16), tailLightMat, -0.952, 0.34, 0.31, false);
    addPart(new THREE.BoxGeometry(0.03, 0.08, 0.16), tailLightMat, -0.952, 0.34, -0.31, false);

    // 4 spinning wheels with proud cream hubcaps
    const wheels: THREE.Object3D[] = [];
    const wheelPositions: [number, number][] = [
      [0.56, 0.46],
      [0.56, -0.46],
      [-0.56, 0.46],
      [-0.56, -0.46],
    ];
    for (const [wx, wz] of wheelPositions) {
      const wGroup = new THREE.Group();
      wGroup.position.set(wx, 0.165, wz);
      const tireGeo = new THREE.CylinderGeometry(0.165, 0.165, 0.13, 12);
      tireGeo.rotateX(Math.PI / 2);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      wGroup.add(tire);

      const hubGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.02, 10);
      hubGeo.rotateX(Math.PI / 2);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.position.z = wz > 0 ? 0.072 : -0.072;
      wGroup.add(hub);

      g.add(wGroup);
      wheels.push(wGroup);
    }

    return { group: g, wheels };
  }

  /**
   * Builds a cute pastel wooden coastal boat (facing +X).
   */
  private buildPastelBoat(hullHex: string): THREE.Group {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: hullHex,
      roughness: 0.72,
      flatShading: true,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: '#FAF3E6',
      roughness: 0.8,
      flatShading: true,
    });
    const woodMat = new THREE.MeshStandardMaterial({
      color: '#CCA77E',
      roughness: 0.86,
      flatShading: true,
    });
    const mastMat = new THREE.MeshStandardMaterial({
      color: '#9C7858',
      roughness: 0.88,
      flatShading: true,
    });
    const flagMat = new THREE.MeshStandardMaterial({
      color: '#F7DC88',
      roughness: 0.75,
      flatShading: true,
    });
    const lanternMat = new THREE.MeshStandardMaterial({
      color: '#FFF4C8',
      emissive: '#FFE08A',
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });

    const addPart = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      rotZ = 0,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.z = rotZ;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    // Main boat hull + bow prow cone
    addPart(new THREE.BoxGeometry(1.58, 0.28, 0.86), hullMat, -0.08, 0.14, 0);
    const prowGeo = new THREE.ConeGeometry(0.46, 0.62, 4);
    prowGeo.rotateY(Math.PI / 4);
    prowGeo.rotateZ(-Math.PI / 2);
    const prow = new THREE.Mesh(prowGeo, hullMat);
    prow.position.set(1.0, 0.16, 0);
    prow.scale.set(1, 0.62, 1.25);
    prow.castShadow = true;
    g.add(prow);

    // Cream gunwale rail cleanly above hull
    addPart(new THREE.BoxGeometry(1.62, 0.045, 0.9), trimMat, -0.08, 0.305, 0);
    // Interior wooden deck & benches
    addPart(new THREE.BoxGeometry(1.42, 0.04, 0.72), woodMat, -0.08, 0.28, 0);
    addPart(new THREE.BoxGeometry(0.24, 0.06, 0.76), woodMat, 0.28, 0.345, 0);
    addPart(new THREE.BoxGeometry(0.24, 0.06, 0.76), woodMat, -0.42, 0.345, 0);

    // Cozy short wooden mast + pastel triangular pennant flag + bow lantern
    addPart(new THREE.CylinderGeometry(0.032, 0.042, 1.15, 7), mastMat, -0.1, 0.86, 0);
    addPart(new THREE.BoxGeometry(0.36, 0.2, 0.025), flagMat, -0.3, 1.28, 0);
    addPart(new THREE.BoxGeometry(0.11, 0.14, 0.11), lanternMat, 0.86, 0.36, 0);

    return g;
  }

  /**
   * Builds a persistent sleek brass-and-glass rooftop terrace elevator kiosk for the `city` biome.
   */
  private createCityElevatorKiosk(halfD: number): CityElevatorRig {
    const g = new THREE.Group();
    g.name = 'CityTerraceElevatorKiosk';
    const kioskZ = -(halfD + 0.98);
    g.position.set(0, 0, kioskZ);

    const frameMat = new THREE.MeshStandardMaterial({
      color: '#D2B57E',
      roughness: 0.38,
      metalness: 0.55,
      flatShading: true,
    });
    const stoneMat = new THREE.MeshStandardMaterial({
      color: '#DBD6CE',
      roughness: 0.86,
      flatShading: true,
    });
    const ledgeMat = new THREE.MeshStandardMaterial({
      color: '#EFEAE2',
      roughness: 0.82,
      flatShading: true,
    });
    const mullionMat = new THREE.MeshStandardMaterial({
      color: '#B7B1A9',
      roughness: 0.84,
      flatShading: true,
    });
    const terracePadMat = new THREE.MeshStandardMaterial({
      color: '#E2DDD5',
      roughness: 0.88,
      flatShading: true,
    });
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: '#595D69',
      roughness: 0.55,
      metalness: 0.3,
      flatShading: true,
    });
    const doorGlassMat = new THREE.MeshStandardMaterial({
      color: '#CFE3F2',
      roughness: 0.18,
      metalness: 0.15,
      transparent: true,
      opacity: 0.72,
      flatShading: true,
    });
    const interiorGlowMat = new THREE.MeshStandardMaterial({
      color: '#FFF6DE',
      emissive: '#FFD98E',
      emissiveIntensity: 0.32,
      roughness: 0.6,
    });
    const indicatorMat = new THREE.MeshStandardMaterial({
      color: '#E5E0D6',
      emissive: '#FFD676',
      emissiveIntensity: 0.2,
      roughness: 0.35,
    });

    const addMesh = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      cast = true,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };

    // Attached full-height concrete elevator shaft column extending cleanly from y = -0.022 down to CITY_STREET_Y = -34
    const shaftTopY = -0.022;
    const shaftHeight = shaftTopY - CITY_STREET_Y;
    const shaftCenterY = CITY_STREET_Y + shaftHeight / 2;
    const shaftCenterZ = 0.06; // Spans local z = -0.71 .. +0.83 -> locks solidly into apartment tower wall at -(halfD + 0.23)!
    addMesh(new THREE.BoxGeometry(1.82, shaftHeight, 1.54), stoneMat, 0, shaftCenterY, shaftCenterZ, false);

    // Architectural top ledge collar + floor-level trim bands matching the main high-rise shaft (zero Z-fighting!)
    addMesh(new THREE.BoxGeometry(1.94, 0.14, 1.62), ledgeMat, 0, -0.094, shaftCenterZ - 0.02, false);
    for (let by = -4.2; by > CITY_STREET_Y + 1.5; by -= 4.2) {
      addMesh(new THREE.BoxGeometry(1.9, 0.12, 1.58), ledgeMat, 0, by, shaftCenterZ - 0.02, false);
    }

    // Subtle proud vertical mullion ribs along the exterior shaft faces (proud >= 0.015, never coplanar)
    addMesh(new THREE.BoxGeometry(0.08, shaftHeight - 0.2, 0.08), mullionMat, -0.92, shaftCenterY, -0.68, false);
    addMesh(new THREE.BoxGeometry(0.08, shaftHeight - 0.2, 0.08), mullionMat, 0.92, shaftCenterY, -0.68, false);
    addMesh(new THREE.BoxGeometry(0.08, shaftHeight - 0.2, 0.06), mullionMat, -0.45, shaftCenterY, -0.73, false);
    addMesh(new THREE.BoxGeometry(0.08, shaftHeight - 0.2, 0.06), mullionMat, 0.45, shaftCenterY, -0.73, false);

    // Solid flush concrete threshold landing bridging cleanly into the rooftop terrace at z = -(halfD + 0.18)
    addMesh(new THREE.BoxGeometry(1.84, 0.06, 0.96), terracePadMat, 0, -0.004, 0.78, false);

    // Kiosk cab shell (back, left, right walls & roof canopy, strictly non-coplanar with shaft)
    addMesh(new THREE.BoxGeometry(1.72, 2.38, 0.12), stoneMat, 0, 1.19, -0.62);
    addMesh(new THREE.BoxGeometry(0.14, 2.38, 1.3), stoneMat, -0.8, 1.19, 0);
    addMesh(new THREE.BoxGeometry(0.14, 2.38, 1.3), stoneMat, 0.8, 1.19, 0);
    addMesh(new THREE.BoxGeometry(1.82, 0.16, 1.44), darkTrimMat, 0, 2.46, 0.02);

    // Warm brass portal pilasters & header lintel facing the terrace (+Z)
    addMesh(new THREE.BoxGeometry(0.14, 2.38, 0.14), frameMat, -0.78, 1.19, 0.64);
    addMesh(new THREE.BoxGeometry(0.14, 2.38, 0.14), frameMat, 0.78, 1.19, 0.64);
    addMesh(new THREE.BoxGeometry(1.74, 0.26, 0.16), frameMat, 0, 2.26, 0.64);

    // Glowing floor indicator bar cleanly proud of brass header (+Z)
    addMesh(new THREE.BoxGeometry(0.56, 0.08, 0.03), indicatorMat, 0, 2.26, 0.735, false);

    // Warm backlit interior back panel + floor inside cab
    addMesh(new THREE.BoxGeometry(1.42, 2.08, 0.04), interiorGlowMat, 0, 1.12, -0.52, false);
    addMesh(new THREE.BoxGeometry(1.48, 0.04, 1.18), frameMat, 0, 0.022, 0, false);

    // Twin sliding frosted-glass & brass elevator doors (closed at x = ±0.35, open at ±0.74)
    const leftDoor = addMesh(new THREE.BoxGeometry(0.68, 2.08, 0.055), doorGlassMat, -0.35, 1.07, 0.58, false);
    const rightDoor = addMesh(new THREE.BoxGeometry(0.68, 2.08, 0.055), doorGlassMat, 0.35, 1.07, 0.58, false);

    // Vertical brass edge handles on each door leaf
    const leftEdge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.08, 0.07), frameMat);
    leftEdge.position.set(0.31, 0, 0);
    leftDoor.add(leftEdge);
    const rightEdge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.08, 0.07), frameMat);
    rightEdge.position.set(-0.31, 0, 0);
    rightDoor.add(rightEdge);

    return {
      group: g,
      leftDoor,
      rightDoor,
      interiorGlowMat,
      indicatorMat,
      openProgress: 0,
      holdTimer: 0,
      pendingCallbacks: [],
    };
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.elapsed += dt;

    // Animate Suburbs cars & Beach boats
    const finished: ActiveVehicleTrip[] = [];
    for (const trip of this.trips) {
      trip.timer += dt;

      if (trip.phase === 'approach') {
        const t = Math.min(1, trip.timer / trip.approachDuration);
        const eased = easeOutCubic(t);
        const prevX = trip.group.position.x;
        const nextX = trip.startX + (trip.stopX - trip.startX) * eased;
        trip.group.position.x = nextX;
        this.spinWheels(trip, nextX - prevX);
        if (t >= 1) {
          trip.phase = 'dwell';
          trip.timer = 0;
        }
      } else if (trip.phase === 'dwell') {
        if (!trip.callbackFired && trip.timer >= 0.28) {
          trip.callbackFired = true;
          trip.onAtStop();
        }
        if (trip.timer >= trip.dwellDuration) {
          trip.phase = 'depart';
          trip.timer = 0;
        }
      } else if (trip.phase === 'depart') {
        const t = Math.min(1, trip.timer / trip.departDuration);
        const eased = easeInCubic(t);
        const prevX = trip.group.position.x;
        const nextX = trip.stopX + (trip.endX - trip.stopX) * eased;
        trip.group.position.x = nextX;
        this.spinWheels(trip, nextX - prevX);
        if (t >= 1) {
          finished.push(trip);
        }
      }

      // Gentle buoyant ocean wave bob for boats
      if (trip.kind === 'boat') {
        const bob = Math.sin(this.elapsed * 2.6 + trip.phaseOffset) * 0.032;
        const roll = Math.sin(this.elapsed * 2.0 + trip.phaseOffset) * 0.038;
        trip.group.position.y = trip.baseY + bob;
        trip.group.rotation.x = roll;
      }
    }

    if (finished.length > 0) {
      const doneIds = new Set(finished.map((f) => f.id));
      for (const f of finished) {
        if (!f.callbackFired) {
          f.callbackFired = true;
          f.onAtStop();
        }
        this.root.remove(f.group);
        disposeGroupResources(f.group);
      }
      this.trips = this.trips.filter((tr) => !doneIds.has(tr.id));
    }

    // Animate City terrace elevator sliding doors & warm cabin glow
    if (this.elevator) {
      const ev = this.elevator;
      if (ev.pendingCallbacks.length > 0) {
        const remaining: typeof ev.pendingCallbacks = [];
        for (const p of ev.pendingCallbacks) {
          p.delay -= dt;
          if (p.delay <= 0) {
            p.fn();
          } else {
            remaining.push(p);
          }
        }
        ev.pendingCallbacks = remaining;
      }

      if (ev.holdTimer > 0) {
        ev.holdTimer = Math.max(0, ev.holdTimer - dt);
      }
      const targetOpen = ev.holdTimer > 0 ? 1 : 0;
      const rate = targetOpen > ev.openProgress ? 3.8 : 2.6;
      ev.openProgress += (targetOpen - ev.openProgress) * Math.min(1, dt * rate);

      const doorOffset = 0.35 + ev.openProgress * 0.39;
      ev.leftDoor.position.x = -doorOffset;
      ev.rightDoor.position.x = doorOffset;
      ev.interiorGlowMat.emissiveIntensity = 0.25 + ev.openProgress * 0.78;
      ev.indicatorMat.emissiveIntensity = 0.18 + ev.openProgress * 0.95;
    }
  }

  private spinWheels(trip: ActiveVehicleTrip, dx: number): void {
    if (trip.wheels.length === 0) return;
    const dAngle = -dx / 0.165;
    for (const w of trip.wheels) {
      w.rotation.z += dAngle;
    }
  }

  private clearActiveTrips(fireCallbacks: boolean): void {
    for (const trip of this.trips) {
      if (fireCallbacks && !trip.callbackFired) {
        trip.callbackFired = true;
        trip.onAtStop();
      }
      this.root.remove(trip.group);
      disposeGroupResources(trip.group);
    }
    this.trips = [];
  }

  dispose(): void {
    this.clearActiveTrips(false);
    if (this.elevator) {
      this.root.remove(this.elevator.group);
      disposeGroupResources(this.elevator.group);
      this.elevator = null;
    }
    this.root.parent?.remove(this.root);
  }
}
