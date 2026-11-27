import * as THREE from 'three';
import type { SceneryViewDef, WeatherDef } from '../data/schemas';
import { disposeObjectTree, rectPerimeterPointInto } from './BackdropBuilder';

interface RainParticle {
  x: number;
  y: number;
  z: number;
  speed: number;
}

interface SnowParticle {
  x: number;
  y: number;
  z: number;
  speed: number;
  phase: number;
  scale: number;
}

interface MistBank {
  angle: number;
  radialOffset: number;
  baseY: number;
  scale: number;
  speed: number;
  phase: number;
}

const WEATHER_TOP_Y = 10.5;
const WEATHER_BOTTOM_Y = -0.05;

export class WeatherSystem {
  readonly root = new THREE.Group();

  private activeView: SceneryViewDef | null = null;
  private activeWeather: WeatherDef | null = null;
  private isClearIdle = true;
  private halfW = 8;
  private halfD = 8;
  private extentX = 17;
  private extentZ = 17;

  // Preallocated scratch objects (zero per-frame allocations)
  private readonly spawnPos = { x: 0, z: 0 };
  private readonly mistPos = { x: 0, z: 0 };
  private readonly scratchTintColor = new THREE.Color();

  // Rain state
  private rainLines: THREE.LineSegments | null = null;
  private rainPositions: Float32Array | null = null;
  private rainParticles: RainParticle[] = [];

  // Snow state
  private snowMesh: THREE.InstancedMesh | null = null;
  private snowParticles: SnowParticle[] = [];

  // Fog mist layer state (single InstancedMesh draw call for all 14x3 = 42 puffs)
  private mistMesh: THREE.InstancedMesh | null = null;
  private mistBanks: MistBank[] = [];

  // Lightning flash state
  private elapsed = 0;
  private nextLightningAt = 3.0;
  private flashElapsed = -1;
  private onLightningFlash: (() => void) | null = null;
  private onFlashVisualUpdate: ((flashIntensity: number) => void) | null = null;

  constructor() {
    this.root.name = 'WeatherEffectsRoot';
    this.root.matrixAutoUpdate = false;
    this.root.updateMatrix();
  }

  setOnLightningFlash(cb: (() => void) | null): void {
    this.onLightningFlash = cb;
  }

  setOnFlashVisualUpdate(cb: ((flashIntensity: number) => void) | null): void {
    this.onFlashVisualUpdate = cb;
  }

  /** Updates fog mist tint smoothly in-place when sliding 24h time (zero rebuild). */
  setMistColor(fogHex: string, skyTintHex: string): void {
    if (!this.mistMesh) return;
    const mat = this.mistMesh.material;
    if (mat instanceof THREE.MeshBasicMaterial) {
      this.scratchTintColor.set(skyTintHex);
      mat.color.set(fogHex).multiply(this.scratchTintColor);
    }
  }

  configure(
    view: SceneryViewDef,
    weather: WeatherDef,
    gridWidth = 16,
    gridDepth = 16,
  ): void {
    this.activeView = view;
    this.activeWeather = weather;
    this.halfW = gridWidth / 2;
    this.halfD = gridDepth / 2;
    this.extentX = this.halfW + 9.0;
    this.extentZ = this.halfD + 9.0;

    this.clearEffects();

    if (weather.particleType === 'rain') {
      this.createRain(weather);
    } else if (weather.particleType === 'snow') {
      this.createSnow(weather);
    }

    if (weather.id === 'fog') {
      this.createMistLayers(view, weather);
    }

    if (weather.lightning) {
      this.flashElapsed = -1;
      this.nextLightningAt = this.elapsed + 2.4 + Math.random() * 2.2;
    } else {
      this.flashElapsed = -1;
    }

    this.isClearIdle =
      weather.particleType === 'none' &&
      weather.fogDensity === 0 &&
      !weather.lightning &&
      this.mistBanks.length === 0;
  }

  private fillRandomExteriorPos(): void {
    const innerX = Math.max(2, this.halfW - 0.6);
    const innerZ = Math.max(2, this.halfD - 0.6);
    for (let attempt = 0; attempt < 4; attempt++) {
      const x = (Math.random() * 2 - 1) * this.extentX;
      const z = (Math.random() * 2 - 1) * this.extentZ;
      if (attempt === 3 || Math.abs(x) > innerX || Math.abs(z) > innerZ) {
        this.spawnPos.x = x;
        this.spawnPos.z = z;
        return;
      }
    }
    this.spawnPos.x = this.extentX * 0.8;
    this.spawnPos.z = -this.extentZ * 0.8;
  }

  private lotDensityScale(): number {
    const areaRatio = (this.halfW * this.halfD) / 64;
    return THREE.MathUtils.clamp(Math.sqrt(areaRatio), 0.85, 1.75);
  }

  private createRain(weather: WeatherDef): void {
    const count = Math.max(120, Math.round(weather.particleRate * 1.15 * this.lotDensityScale()));
    const positions = new Float32Array(count * 2 * 3);
    const particles: RainParticle[] = [];

    for (let i = 0; i < count; i++) {
      this.fillRandomExteriorPos();
      const y = WEATHER_BOTTOM_Y + Math.random() * (WEATHER_TOP_Y - WEATHER_BOTTOM_Y);
      particles.push({
        x: this.spawnPos.x,
        y,
        z: this.spawnPos.z,
        speed: 12.5 + Math.random() * 4.5 + weather.windStrength * 5.0,
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: weather.lightning ? 0xcad9eb : 0xdbe9f6,
      transparent: true,
      opacity: weather.lightning ? 0.56 : 0.44,
      depthWrite: false,
    });

    this.rainLines = new THREE.LineSegments(geo, mat);
    this.rainLines.frustumCulled = false;
    this.rainLines.matrixAutoUpdate = false;
    this.rainLines.updateMatrix();
    this.rainPositions = positions;
    this.rainParticles = particles;
    this.root.add(this.rainLines);
    this.syncRainBuffer(weather);
  }

  private syncRainBuffer(weather: WeatherDef): void {
    if (!this.rainLines || !this.rainPositions) return;
    const streakLen = weather.lightning ? 0.82 : 0.62;
    const dx = weather.windStrength * 0.48 * streakLen;
    const dz = weather.windStrength * 0.24 * streakLen;
    const pos = this.rainPositions;
    const list = this.rainParticles;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const base = i * 6;
      pos[base] = p.x;
      pos[base + 1] = p.y;
      pos[base + 2] = p.z;
      pos[base + 3] = p.x - dx;
      pos[base + 4] = p.y + streakLen;
      pos[base + 5] = p.z - dz;
    }

    const attr = this.rainLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }

  private createSnow(weather: WeatherDef): void {
    const count = Math.max(100, Math.round(weather.particleRate * 1.45 * this.lotDensityScale()));
    const geo = new THREE.OctahedronGeometry(0.068, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf7fbff,
      transparent: true,
      opacity: 0.9,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    const particles: SnowParticle[] = [];
    for (let i = 0; i < count; i++) {
      this.fillRandomExteriorPos();
      particles.push({
        x: this.spawnPos.x,
        y: WEATHER_BOTTOM_Y + Math.random() * (WEATHER_TOP_Y - WEATHER_BOTTOM_Y),
        z: this.spawnPos.z,
        speed: 1.35 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        scale: 0.72 + Math.random() * 0.65,
      });
    }

    this.snowMesh = mesh;
    this.snowParticles = particles;
    this.root.add(mesh);
    this.syncSnowMatrices();
  }

  private syncSnowMatrices(): void {
    if (!this.snowMesh) return;
    const arr = this.snowMesh.instanceMatrix.array as Float32Array;
    const list = this.snowParticles;
    const elapsed = this.elapsed;
    const cy = Math.cos(elapsed * 0.6);
    const sy = Math.sin(elapsed * 0.6);

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const rx = elapsed * 0.8 + p.phase;
      const cx = Math.cos(rx);
      const sx = Math.sin(rx);
      const s = p.scale;
      const o = i * 16;

      // Direct Rx(rx) * Ry(elapsed*0.6) * Scale(s) + Translation(p.x, p.y, p.z)
      arr[o] = cy * s;
      arr[o + 1] = sx * sy * s;
      arr[o + 2] = -cx * sy * s;
      arr[o + 3] = 0;
      arr[o + 4] = 0;
      arr[o + 5] = cx * s;
      arr[o + 6] = sx * s;
      arr[o + 7] = 0;
      arr[o + 8] = sy * s;
      arr[o + 9] = -sx * cy * s;
      arr[o + 10] = cx * cy * s;
      arr[o + 11] = 0;
      arr[o + 12] = p.x;
      arr[o + 13] = p.y;
      arr[o + 14] = p.z;
      arr[o + 15] = 1;
    }
    this.snowMesh.instanceMatrix.needsUpdate = true;
  }

  private createMistLayers(view: SceneryViewDef, weather: WeatherDef): void {
    const mistColor = new THREE.Color(view.fogColor).multiply(new THREE.Color(weather.skyTint));
    const mistMat = new THREE.MeshBasicMaterial({
      color: mistColor,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const puffGeo = new THREE.IcosahedronGeometry(0.95, 1);

    const bankCount = 14;
    const mesh = new THREE.InstancedMesh(puffGeo, mistMat, bankCount * 3);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.mistMesh = mesh;
    this.root.add(mesh);

    for (let i = 0; i < bankCount; i++) {
      this.mistBanks.push({
        angle: (i / bankCount) * Math.PI * 2,
        radialOffset: 1.6 + (i % 3) * 2.4,
        baseY: 0.35 + (i % 3) * 0.45,
        scale: 1.2 + (i % 3) * 0.35,
        speed: (i % 2 === 0 ? 1 : -1) * (0.025 + (i % 3) * 0.008),
        phase: i * 0.85,
      });
    }

    this.syncMistMatrices();
  }

  private syncMistMatrices(): void {
    if (!this.mistMesh || this.mistBanks.length === 0) return;
    const arr = this.mistMesh.instanceMatrix.array as Float32Array;
    const clearX = this.halfW + 1.8;
    const clearZ = this.halfD + 1.8;
    const t = this.elapsed * 0.55;
    let idx = 0;

    for (let i = 0; i < this.mistBanks.length; i++) {
      const bank = this.mistBanks[i];
      const yBase = bank.baseY + Math.sin(t + bank.phase) * 0.14;
      rectPerimeterPointInto(bank.angle, clearX, clearZ, bank.radialOffset, this.mistPos);
      const rotY = -bank.angle + Math.PI / 2;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const sc = bank.scale;
      const sx = 1.6 * sc;
      const sy = 0.36 * sc;
      const sz = 1.15 * sc;

      for (let j = 0; j < 3; j++) {
        const ox = (j - 1) * 0.85 * sc;
        const oy = (j % 2) * 0.12;
        const oz = (j === 1 ? 0.25 : -0.15) * sc;
        const px = this.mistPos.x + ox * cosY + oz * sinY;
        const py = yBase + oy;
        const pz = this.mistPos.z - ox * sinY + oz * cosY;
        const o = idx * 16;

        arr[o] = cosY * sx;
        arr[o + 1] = 0;
        arr[o + 2] = -sinY * sx;
        arr[o + 3] = 0;
        arr[o + 4] = 0;
        arr[o + 5] = sy;
        arr[o + 6] = 0;
        arr[o + 7] = 0;
        arr[o + 8] = sinY * sz;
        arr[o + 9] = 0;
        arr[o + 10] = cosY * sz;
        arr[o + 11] = 0;
        arr[o + 12] = px;
        arr[o + 13] = py;
        arr[o + 14] = pz;
        arr[o + 15] = 1;
        idx++;
      }
    }
    this.mistMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.isClearIdle || !this.activeWeather || !this.activeView) return;
    this.elapsed += dt;
    const weather = this.activeWeather;

    if (this.rainLines && this.rainParticles.length > 0) {
      const windX = weather.windStrength * 5.6 * dt;
      const windZ = weather.windStrength * 2.8 * dt;
      const list = this.rainParticles;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.x += windX;
        p.z += windZ;
        p.y -= p.speed * dt;
        if (p.y < WEATHER_BOTTOM_Y) {
          this.fillRandomExteriorPos();
          p.x = this.spawnPos.x;
          p.z = this.spawnPos.z;
          p.y = WEATHER_TOP_Y - Math.random() * 0.8;
        }
      }
      this.syncRainBuffer(weather);
    }

    if (this.snowMesh && this.snowParticles.length > 0) {
      const windX = weather.windStrength * 1.4;
      const windZ = weather.windStrength * 0.7;
      const list = this.snowParticles;
      const t1 = this.elapsed * 1.4;
      const t2 = this.elapsed * 1.1;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.x += (windX + Math.sin(t1 + p.phase) * 0.45) * dt;
        p.z += (windZ + Math.cos(t2 + p.phase) * 0.25) * dt;
        p.y -= p.speed * dt;
        if (p.y < WEATHER_BOTTOM_Y) {
          this.fillRandomExteriorPos();
          p.x = this.spawnPos.x;
          p.z = this.spawnPos.z;
          p.y = WEATHER_TOP_Y - Math.random() * 0.6;
        }
      }
      this.syncSnowMatrices();
    }

    if (this.mistBanks.length > 0) {
      for (let i = 0; i < this.mistBanks.length; i++) {
        this.mistBanks[i].angle += this.mistBanks[i].speed * dt;
      }
      this.syncMistMatrices();
    }

    this.updateLightning(dt);
  }

  private updateLightning(dt: number): void {
    if (!this.activeWeather?.lightning) return;

    if (this.flashElapsed < 0 && this.elapsed >= this.nextLightningAt) {
      this.flashElapsed = 0;
      this.nextLightningAt = this.elapsed + 6.5 + Math.random() * 6.5;
      this.onLightningFlash?.();
    }

    if (this.flashElapsed < 0) return;

    this.flashElapsed += dt;
    const t = this.flashElapsed;
    let intensity = 0;

    if (t < 0.07) {
      intensity = 1.0;
    } else if (t < 0.13) {
      intensity = 0.22;
    } else if (t < 0.2) {
      intensity = 0.85;
    } else if (t < 0.46) {
      const fade = 1 - (t - 0.2) / 0.26;
      intensity = Math.max(0, fade * fade * 0.85);
    } else {
      this.flashElapsed = -1;
      this.onFlashVisualUpdate?.(0);
      return;
    }

    this.onFlashVisualUpdate?.(intensity);
  }

  private clearEffects(): void {
    disposeObjectTree(this.root);
    this.root.clear();
    this.rainLines = null;
    this.rainPositions = null;
    this.rainParticles = [];
    this.snowMesh = null;
    this.snowParticles = [];
    this.mistMesh = null;
    this.mistBanks = [];
  }

  dispose(): void {
    this.clearEffects();
  }
}
