import * as THREE from 'three';
import type { SceneryViewDef, TimeOfDay, WeatherDef } from '../data/schemas';

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vNdc = clipPos.xy / max(0.0001, clipPos.w);
    gl_Position = clipPos;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uTopColor;
  uniform vec3 uMidColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uLowerColor;
  uniform vec3 uCelestialColor;
  uniform vec2 uCelestialPos;
  uniform float uCelestialStrength;
  uniform float uCelestialRadius;
  uniform float uLightning;
  varying vec2 vNdc;

  void main() {
    float t = clamp(vNdc.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 col;
    if (t < 0.34) {
      col = mix(uLowerColor, uHorizonColor, smoothstep(0.0, 0.34, t));
    } else if (t < 0.68) {
      col = mix(uHorizonColor, uMidColor, smoothstep(0.34, 0.68, t));
    } else {
      col = mix(uMidColor, uTopColor, smoothstep(0.68, 1.0, t));
    }

    // Sun or Moon glow + soft atmospheric halo
    vec2 delta = (vNdc - uCelestialPos) * vec2(1.45, 1.0);
    float dist = length(delta);
    float halo = exp(-dist * (3.2 / max(0.4, uCelestialRadius))) * 0.34 * uCelestialStrength;
    float disc = smoothstep(0.14 * uCelestialRadius, 0.045 * uCelestialRadius, dist) * 0.52 * uCelestialStrength;
    col += uCelestialColor * (halo + disc);

    // Thunderstorm lightning sky wash
    vec3 flashCol = vec3(0.84, 0.91, 1.0);
    col = mix(col, flashCol, clamp(uLightning * 0.82, 0.0, 0.88));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const STAR_VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uAzimuthShift;
  uniform float uAlpha;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    float x = mod(position.x + uAzimuthShift + 1.0, 2.0) - 1.0;
    float y = position.y;

    float twinkle = 0.55 + 0.45 * sin(uTime * (1.4 + mod(aPhase, 1.8)) + aPhase * 6.2831);
    float horizonFade = smoothstep(-0.08, 0.35, y);
    vAlpha = uAlpha * twinkle * horizonFade;
    vColor = aColor;

    gl_Position = vec4(x, y, 0.999, 1.0);
    gl_PointSize = aSize * (0.85 + 0.25 * twinkle);
  }
`;

const STAR_FRAGMENT_SHADER = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    if (vAlpha <= 0.005) discard;
    vec2 centered = gl_PointCoord - vec2(0.5);
    float d = length(centered) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(1.0, 0.15, d);
    gl_FragColor = vec4(vColor, core * vAlpha);
  }
`;

const LOWER_HAZE_BY_VIEW: Record<string, string> = {
  city: '#AEBED6',
  beach: '#BEE5EA',
  mountains: '#C6D9EC',
  forest: '#C6DAC9',
  countryside: '#E4E2CA',
  suburbs: '#DFDFD6',
};

export function resolveTimeHour(timeOfDay: TimeOfDay = 'day', timeHour?: number): number {
  if (typeof timeHour === 'number' && Number.isFinite(timeHour)) {
    return ((timeHour % 24) + 24) % 24;
  }
  switch (timeOfDay) {
    case 'morning':
      return 7.5;
    case 'sunset':
      return 18.6;
    case 'night':
      return 22.5;
    case 'day':
    default:
      return 12.0;
  }
}

/**
 * Smooth 0..1 curve representing how brightly windows, streetlamps, and avenues
 * should glow across the 24-hour cycle (ramps up 17:15 -> 20:30, fades 5:00 -> 7:45).
 */
export function computeNightGlowFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 20.5 || h <= 5.0) return 1.0;
  if (h > 17.2) return THREE.MathUtils.smoothstep(h, 17.2, 20.5);
  if (h < 7.8) return 1.0 - THREE.MathUtils.smoothstep(h, 5.0, 7.8);
  return 0.0;
}

/**
 * Smooth 0..1 curve for twilight/night star visibility (fades in 18:45 -> 20:30, out 4:30 -> 6:10).
 */
function computeStarNightFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 20.6 || h <= 4.5) return 1.0;
  if (h > 18.7) return THREE.MathUtils.smoothstep(h, 18.7, 20.6);
  if (h < 6.1) return 1.0 - THREE.MathUtils.smoothstep(h, 4.5, 6.1);
  return 0.0;
}

interface SkyKeyframe {
  hour: number;
  top: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  lower: THREE.Color;
  /** 0 = pure keyframe palette (night/sunset), 1 = full view-specific daylight palette. */
  viewWeight: number;
  cloudTint: THREE.Color;
  cloudBlend: number;
}

const SKY_KEYFRAMES: SkyKeyframe[] = [
  {
    hour: 0.0,
    top: new THREE.Color('#101830'),
    mid: new THREE.Color('#172342'),
    horizon: new THREE.Color('#213054'),
    lower: new THREE.Color('#15203A'),
    viewWeight: 0.0,
    cloudTint: new THREE.Color('#3B4B6E'),
    cloudBlend: 0.84,
  },
  {
    hour: 4.8,
    top: new THREE.Color('#1A2346'),
    mid: new THREE.Color('#2E3661'),
    horizon: new THREE.Color('#554972'),
    lower: new THREE.Color('#303054'),
    viewWeight: 0.05,
    cloudTint: new THREE.Color('#666287'),
    cloudBlend: 0.72,
  },
  {
    hour: 6.4,
    top: new THREE.Color('#6A98CC'),
    mid: new THREE.Color('#D5A5B2'),
    horizon: new THREE.Color('#FBC28E'),
    lower: new THREE.Color('#E8C0A9'),
    viewWeight: 0.28,
    cloudTint: new THREE.Color('#FFD9C2'),
    cloudBlend: 0.65,
  },
  {
    hour: 8.6,
    top: new THREE.Color('#8EC4EC'),
    mid: new THREE.Color('#D4E4F0'),
    horizon: new THREE.Color('#FCE8D2'),
    lower: new THREE.Color('#EFE3D6'),
    viewWeight: 0.75,
    cloudTint: new THREE.Color('#FFF2E6'),
    cloudBlend: 0.25,
  },
  {
    hour: 12.0,
    top: new THREE.Color('#8BC4EA'),
    mid: new THREE.Color('#C5E0F0'),
    horizon: new THREE.Color('#F8EFE0'),
    lower: new THREE.Color('#E2E4DC'),
    viewWeight: 1.0,
    cloudTint: new THREE.Color('#FFFFFF'),
    cloudBlend: 0.0,
  },
  {
    hour: 16.0,
    top: new THREE.Color('#84B9E2'),
    mid: new THREE.Color('#CADBE8'),
    horizon: new THREE.Color('#FBE7CA'),
    lower: new THREE.Color('#E8DFD0'),
    viewWeight: 0.86,
    cloudTint: new THREE.Color('#FFF1DC'),
    cloudBlend: 0.2,
  },
  {
    hour: 18.4,
    top: new THREE.Color('#3D457B'),
    mid: new THREE.Color('#C87682'),
    horizon: new THREE.Color('#FAA966'),
    lower: new THREE.Color('#8C6A84'),
    viewWeight: 0.14,
    cloudTint: new THREE.Color('#F7AF94'),
    cloudBlend: 0.66,
  },
  {
    hour: 19.8,
    top: new THREE.Color('#202A52'),
    mid: new THREE.Color('#474572'),
    horizon: new THREE.Color('#85607B'),
    lower: new THREE.Color('#35385C'),
    viewWeight: 0.04,
    cloudTint: new THREE.Color('#6A6282'),
    cloudBlend: 0.78,
  },
  {
    hour: 21.5,
    top: new THREE.Color('#141D38'),
    mid: new THREE.Color('#1C294D'),
    horizon: new THREE.Color('#263459'),
    lower: new THREE.Color('#192440'),
    viewWeight: 0.0,
    cloudTint: new THREE.Color('#425277'),
    cloudBlend: 0.82,
  },
  {
    hour: 24.0,
    top: new THREE.Color('#101830'),
    mid: new THREE.Color('#172342'),
    horizon: new THREE.Color('#213054'),
    lower: new THREE.Color('#15203A'),
    viewWeight: 0.0,
    cloudTint: new THREE.Color('#3B4B6E'),
    cloudBlend: 0.84,
  },
];

const COL_WHITE = new THREE.Color('#FFFFFF');
const COL_DAWN_SUN = new THREE.Color('#FFD29C');
const COL_NOON_SUN = new THREE.Color('#FFF7E2');
const COL_SUNSET_SUN = new THREE.Color('#FFB266');
const COL_MOON = new THREE.Color('#DCE8FF');
const COL_STORM_NIGHT_CLOUD = new THREE.Color('#293349');

function findKeyframeSegment(hour: number): { a: SkyKeyframe; b: SkyKeyframe; t: number } {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    const a = SKY_KEYFRAMES[i];
    const b = SKY_KEYFRAMES[i + 1];
    if (h >= a.hour && h <= b.hour) {
      const span = Math.max(0.0001, b.hour - a.hour);
      const raw = (h - a.hour) / span;
      const t = raw * raw * (3 - 2 * raw); // smoothstep
      return { a, b, t };
    }
  }
  return { a: SKY_KEYFRAMES[0], b: SKY_KEYFRAMES[1], t: 0 };
}

function seededHash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export interface SkyDomeHandle {
  group: THREE.Group;
  configure(view: SceneryViewDef, weather: WeatherDef, timeOfDay?: TimeOfDay, timeHour?: number): void;
  setLightning(intensity: number): void;
  update(elapsed: number, cameraPos: THREE.Vector3, cameraForward: THREE.Vector3): void;
  dispose(): void;
}

export function createSkyDome(
  view: SceneryViewDef,
  weather: WeatherDef,
  timeOfDay: TimeOfDay = 'day',
  timeHour?: number,
): SkyDomeHandle {
  const group = new THREE.Group();
  group.name = 'ScenerySkyRoot';
  group.matrixAutoUpdate = false;
  group.updateMatrix();

  const geo = new THREE.SphereGeometry(118, 24, 16);
  const skyUniforms = {
    uTopColor: { value: new THREE.Color(view.skyTop) },
    uMidColor: { value: new THREE.Color(view.skyTop) },
    uHorizonColor: { value: new THREE.Color(view.skyHorizon) },
    uLowerColor: { value: new THREE.Color(LOWER_HAZE_BY_VIEW[view.id] ?? view.fogColor) },
    uCelestialColor: { value: new THREE.Color(view.sunColor) },
    uCelestialPos: { value: new THREE.Vector2(0.58, 0.72) },
    uCelestialStrength: { value: 1.0 },
    uCelestialRadius: { value: 1.0 },
    uLightning: { value: 0.0 },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });

  const domeMesh = new THREE.Mesh(geo, mat);
  domeMesh.name = 'ScenerySkyDome';
  domeMesh.renderOrder = -1000;
  domeMesh.frustumCulled = false;
  group.add(domeMesh);

  // Twinkling procedural starfield rendered behind all 3D world geometry
  const starCount = 190;
  const starPositions = new Float32Array(starCount * 3);
  const starSizes = new Float32Array(starCount);
  const starPhases = new Float32Array(starCount);
  const starColors = new Float32Array(starCount * 3);
  const starPalette = [
    new THREE.Color('#FFFFFF'),
    new THREE.Color('#DCEBFF'),
    new THREE.Color('#FFF3D4'),
    new THREE.Color('#C8DCFF'),
  ];
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;

  for (let i = 0; i < starCount; i++) {
    starPositions[i * 3] = seededHash(i * 7 + 1) * 2 - 1;
    starPositions[i * 3 + 1] = -0.05 + Math.pow(seededHash(i * 13 + 3), 0.72) * 1.03;
    starPositions[i * 3 + 2] = 0;
    starSizes[i] = (1.6 + seededHash(i * 19 + 5) * 2.4) * dpr;
    starPhases[i] = seededHash(i * 29 + 7) * 5.0;
    const sc = starPalette[i % starPalette.length];
    starColors[i * 3] = sc.r;
    starColors[i * 3 + 1] = sc.g;
    starColors[i * 3 + 2] = sc.b;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));
  starGeo.setAttribute('aColor', new THREE.BufferAttribute(starColors, 3));

  const starUniforms = {
    uTime: { value: 0 },
    uAzimuthShift: { value: 0 },
    uAlpha: { value: 0 },
  };

  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    uniforms: starUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });

  const starPoints = new THREE.Points(starGeo, starMat);
  starPoints.name = 'SceneryStarfield';
  starPoints.renderOrder = -999;
  starPoints.frustumCulled = false;
  starPoints.visible = false;
  starPoints.matrixAutoUpdate = false;
  starPoints.updateMatrix();
  group.add(starPoints);

  // Scratch colors (zero allocation on Time Slider drag!)
  const tintColor = new THREE.Color();
  const scratchTint = new THREE.Color();
  const viewTop = new THREE.Color();
  const viewMid = new THREE.Color();
  const viewHor = new THREE.Color();
  const viewLow = new THREE.Color();
  const topTmp = new THREE.Color();
  const midTmp = new THREE.Color();
  const horTmp = new THREE.Color();
  const lowTmp = new THREE.Color();
  const celestialTmp = new THREE.Color();
  let baseStarAlpha = 0;

  const configure = (
    v: SceneryViewDef,
    w: WeatherDef,
    tod: TimeOfDay = 'day',
    hourParam?: number,
  ) => {
    const h = resolveTimeHour(tod, hourParam);
    const { a, b, t } = findKeyframeSegment(h);

    viewTop.set(v.skyTop);
    viewHor.set(v.skyHorizon);
    viewMid.copy(viewTop).lerp(viewHor, 0.48);
    viewLow.set(LOWER_HAZE_BY_VIEW[v.id] ?? v.fogColor);

    const viewWeight = a.viewWeight + (b.viewWeight - a.viewWeight) * t;
    topTmp.copy(a.top).lerp(b.top, t).lerp(viewTop, viewWeight);
    midTmp.copy(a.mid).lerp(b.mid, t).lerp(viewMid, viewWeight);
    horTmp.copy(a.horizon).lerp(b.horizon, t).lerp(viewHor, viewWeight);
    lowTmp.copy(a.lower).lerp(b.lower, t).lerp(viewLow, viewWeight);

    // Apply weather sky tint (softened smoothly as night deepens so twilight indigo stays vivid)
    const nightWeight = computeStarNightFactor(h);
    tintColor.set(w.skyTint);
    scratchTint.copy(COL_WHITE).lerp(tintColor, 1.0 - nightWeight * 0.42);
    topTmp.multiply(scratchTint);
    midTmp.multiply(scratchTint);
    horTmp.multiply(scratchTint);
    lowTmp.multiply(scratchTint);

    skyUniforms.uTopColor.value.copy(topTmp);
    skyUniforms.uMidColor.value.copy(midTmp);
    skyUniforms.uHorizonColor.value.copy(horTmp);
    skyUniforms.uLowerColor.value.copy(lowTmp);

    // Continuous Sun arc (5:36 -> 19:24) and Moon arc (19:24 -> 5:36)
    const weatherSunFactor = w.lightning
      ? 0.08
      : w.id === 'rain'
        ? 0.22
        : w.id === 'fog'
          ? 0.3
          : w.id === 'snow'
            ? 0.58
            : 1.0;

    if (h >= 5.6 && h <= 19.4) {
      const p = (h - 5.6) / (19.4 - 5.6); // 0 = east dawn, 0.5 = noon, 1 = west sunset
      const arcX = 0.78 - p * 1.56;
      const arcY = 0.14 + Math.sin(p * Math.PI) * 0.68;
      skyUniforms.uCelestialPos.value.set(arcX, arcY);

      if (p < 0.5) {
        celestialTmp.copy(COL_DAWN_SUN).lerp(COL_NOON_SUN, THREE.MathUtils.smoothstep(p, 0.0, 0.35));
      } else {
        celestialTmp.copy(COL_NOON_SUN).lerp(COL_SUNSET_SUN, THREE.MathUtils.smoothstep(p, 0.65, 1.0));
      }
      skyUniforms.uCelestialColor.value.copy(celestialTmp);

      const horizonFade =
        THREE.MathUtils.smoothstep(h, 5.6, 6.4) * (1 - THREE.MathUtils.smoothstep(h, 18.6, 19.4));
      const sunsetGlowBoost = 1.0 + THREE.MathUtils.smoothstep(p, 0.72, 0.96) * 0.32;
      skyUniforms.uCelestialRadius.value = 0.96 + (1 - Math.sin(p * Math.PI)) * 0.35;
      skyUniforms.uCelestialStrength.value = weatherSunFactor * horizonFade * sunsetGlowBoost;
    } else {
      const nightElapsed = h > 19.4 ? h - 19.4 : h + (24.0 - 19.4);
      const np = nightElapsed / 10.2;
      const moonX = 0.68 - np * 1.36;
      const moonY = 0.22 + Math.sin(np * Math.PI) * 0.54;
      skyUniforms.uCelestialPos.value.set(moonX, moonY);
      skyUniforms.uCelestialColor.value.copy(COL_MOON);
      skyUniforms.uCelestialRadius.value = 0.66;

      const moonFade =
        THREE.MathUtils.smoothstep(np, 0.0, 0.12) * (1 - THREE.MathUtils.smoothstep(np, 0.88, 1.0));
      skyUniforms.uCelestialStrength.value = weatherSunFactor * moonFade * 0.92;
    }

    // Smooth continuous twinkling starfield fade
    const skyClearForStars =
      w.id === 'clear' ? 1.0 : w.id === 'snow' ? 0.65 : w.id === 'fog' ? 0.15 : 0.0;
    baseStarAlpha = nightWeight * 0.94 * skyClearForStars;
    starUniforms.uAlpha.value = baseStarAlpha;
    starPoints.visible = baseStarAlpha > 0.01;
  };

  configure(view, weather, timeOfDay, timeHour);

  return {
    group,
    configure,
    setLightning(intensity: number) {
      const clamped = Math.max(0, Math.min(1, intensity));
      skyUniforms.uLightning.value = clamped;
      starUniforms.uAlpha.value = baseStarAlpha * (1 - clamped * 0.9);
    },
    update(elapsed: number, cameraPos: THREE.Vector3, cameraForward: THREE.Vector3) {
      domeMesh.position.copy(cameraPos);
      if (starPoints.visible) {
        starUniforms.uTime.value = elapsed;
        const az = Math.atan2(cameraForward.x, cameraForward.z);
        starUniforms.uAzimuthShift.value = (az / Math.PI) * 0.55;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      starGeo.dispose();
      starMat.dispose();
    },
  };
}

interface LinearCloud {
  x: number;
  z: number;
  baseY: number;
  rotY: number;
  speedMul: number;
  bobPhase: number;
  baseScale: number;
  puffOffsets: Array<{ ox: number; oy: number; oz: number; sx: number; sy: number; sz: number }>;
}

export interface LinearCloudFieldHandle {
  group: THREE.Group;
  applyThemeTint(weather: WeatherDef, timeOfDay?: TimeOfDay, timeHour?: number): void;
  update(
    elapsed: number,
    dt: number,
    weather: WeatherDef,
    cameraPos: THREE.Vector3,
    cameraForward: THREE.Vector3,
  ): void;
  dispose(): void;
}

const CLOUD_SPAN = 90; // 180 x 180 drifting field

/**
 * Natural linear wind-drifting cumulus cloud layer rendered as a SINGLE InstancedMesh
 * draw call, continuously tinted across all 24 hours with zero per-frame allocations.
 */
export function createLinearCloudField(
  weather: WeatherDef,
  timeOfDay: TimeOfDay = 'day',
  timeHour?: number,
): LinearCloudFieldHandle {
  const group = new THREE.Group();
  group.name = 'LinearCloudField';
  group.matrixAutoUpdate = false;
  group.updateMatrix();

  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const cloudMat = new THREE.MeshStandardMaterial({
    color: '#FAFBFD',
    roughness: 0.94,
    metalness: 0.0,
    flatShading: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  const clouds: LinearCloud[] = [];
  const count = 20;
  let totalPuffs = 0;

  for (let i = 0; i < count; i++) {
    const baseScale = 1.45 + seededHash(i * 3 + 1) * 1.35;
    const puffCount = 4 + (i % 3);
    const puffOffsets: LinearCloud['puffOffsets'] = [];

    for (let p = 0; p < puffCount; p++) {
      const spreadX = (p - (puffCount - 1) * 0.5) * 0.88;
      const spreadZ = (seededHash(i * 11 + p * 7) - 0.5) * 0.75;
      const spreadY = p === Math.floor(puffCount / 2) ? 0.28 : (seededHash(i * 5 + p) - 0.45) * 0.22;
      const r = p === Math.floor(puffCount / 2) ? 0.95 : 0.58 + seededHash(i * 13 + p) * 0.28;
      puffOffsets.push({
        ox: spreadX,
        oy: spreadY,
        oz: spreadZ,
        sx: r * 1.42,
        sy: r * 0.56,
        sz: r * 1.02,
      });
      totalPuffs++;
    }

    const col = i % 5;
    const row = Math.floor(i / 5);
    const x = -CLOUD_SPAN + ((col + 0.5) / 5) * (CLOUD_SPAN * 2) + (seededHash(i * 17) - 0.5) * 26;
    const z = -CLOUD_SPAN + ((row + 0.5) / 4) * (CLOUD_SPAN * 2) + (seededHash(i * 23) - 0.5) * 26;
    const baseY = 18.5 + seededHash(i * 29) * 9.0;

    clouds.push({
      x,
      z,
      baseY,
      rotY: (seededHash(i * 31) - 0.5) * 0.5 + 0.35,
      speedMul: 0.75 + seededHash(i * 37) * 0.55,
      bobPhase: seededHash(i * 41) * Math.PI * 2,
      baseScale,
      puffOffsets,
    });
  }

  const instancedClouds = new THREE.InstancedMesh(puffGeo, cloudMat, totalPuffs);
  instancedClouds.name = 'LinearCloudInstances';
  instancedClouds.renderOrder = 2;
  instancedClouds.frustumCulled = false;
  instancedClouds.matrixAutoUpdate = false;
  instancedClouds.updateMatrix();
  group.add(instancedClouds);

  const baseColor = new THREE.Color();
  const keyTint = new THREE.Color();

  const applyThemeTint = (w: WeatherDef, tod: TimeOfDay = 'day', hourParam?: number) => {
    const h = resolveTimeHour(tod, hourParam);
    const { a, b, t } = findKeyframeSegment(h);
    const nightWeight = computeStarNightFactor(h);

    let baseOpacity = 0.68;
    if (w.lightning) {
      baseColor.set('#6C798E');
      baseOpacity = 0.84;
    } else if (w.id === 'rain') {
      baseColor.set('#A4B2C4');
      baseOpacity = 0.78;
    } else if (w.id === 'fog') {
      baseColor.set('#E4E8EB');
      baseOpacity = 0.65;
    } else if (w.id === 'snow') {
      baseColor.set('#EFF5FB');
      baseOpacity = 0.76;
    } else {
      baseColor.set('#FAFBFD');
      baseOpacity = 0.68;
    }

    keyTint.copy(a.cloudTint).lerp(b.cloudTint, t);
    const blend = (a.cloudBlend + (b.cloudBlend - a.cloudBlend) * t) * (w.lightning ? 0.55 : 1.0);
    baseColor.lerp(keyTint, blend);
    if (w.lightning && nightWeight > 0.1) {
      baseColor.lerp(COL_STORM_NIGHT_CLOUD, nightWeight * 0.7);
    }

    cloudMat.color.copy(baseColor);
    cloudMat.opacity = baseOpacity * (1.0 - nightWeight * 0.15);
  };

  applyThemeTint(weather, timeOfDay, timeHour);

  return {
    group,
    applyThemeTint,
    update(elapsed, dt, activeWeather, cameraPos, cameraForward) {
      const baseSpeed = 1.05 + activeWeather.windStrength * 3.8;
      const windDirX = 0.86;
      const windDirZ = 0.51;
      const arr = instancedClouds.instanceMatrix.array as Float32Array;
      let idx = 0;

      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        c.x += windDirX * baseSpeed * c.speedMul * dt;
        c.z += windDirZ * baseSpeed * c.speedMul * dt;

        if (c.x > CLOUD_SPAN) c.x -= CLOUD_SPAN * 2;
        if (c.x < -CLOUD_SPAN) c.x += CLOUD_SPAN * 2;
        if (c.z > CLOUD_SPAN) c.z -= CLOUD_SPAN * 2;
        if (c.z < -CLOUD_SPAN) c.z += CLOUD_SPAN * 2;

        const cy = c.baseY + Math.sin(elapsed * 0.45 + c.bobPhase) * 0.25;
        const camDepth =
          (c.x - cameraPos.x) * cameraForward.x +
          (cy - cameraPos.y) * cameraForward.y +
          (c.z - cameraPos.z) * cameraForward.z;

        let cloudScale = 0;
        if (camDepth >= 7.5 && camDepth <= 132) {
          const nearFade = THREE.MathUtils.smoothstep(camDepth, 7.5, 16.5);
          const farFade = 1 - THREE.MathUtils.smoothstep(camDepth, 114, 132);
          cloudScale = c.baseScale * nearFade * farFade;
        }

        const cosY = Math.cos(c.rotY);
        const sinY = Math.sin(c.rotY);
        const puffs = c.puffOffsets;

        for (let p = 0; p < puffs.length; p++) {
          const o = idx * 16;
          if (cloudScale <= 0.002) {
            arr[o] = 0; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
            arr[o + 4] = 0; arr[o + 5] = 0; arr[o + 6] = 0; arr[o + 7] = 0;
            arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = 0; arr[o + 11] = 0;
            arr[o + 12] = 0; arr[o + 13] = -999; arr[o + 14] = 0; arr[o + 15] = 1;
          } else {
            const pf = puffs[p];
            const sx = pf.sx * cloudScale;
            const sy = pf.sy * cloudScale;
            const sz = pf.sz * cloudScale;
            const px = c.x + (pf.ox * cosY + pf.oz * sinY) * cloudScale;
            const py = cy + pf.oy * cloudScale;
            const pz = c.z + (-pf.ox * sinY + pf.oz * cosY) * cloudScale;

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
          }
          idx++;
        }
      }

      instancedClouds.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      puffGeo.dispose();
      cloudMat.dispose();
    },
  };
}
