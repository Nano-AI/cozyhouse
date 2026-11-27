import * as THREE from 'three';

const ISO_ELEVATION_RAD = Math.atan(Math.SQRT1_2); // True isometric ~35.264°
const CAMERA_DISTANCE = 32;
const BASE_FRUSTUM_HALF_HEIGHT = 8.4;
// Tight near/far span maximizes 24-bit depth buffer precision while cleanly containing
// SkyDome (radius <= 125) and LinearCloudField (depth <= 132) without far-plane clipping.
const CAMERA_NEAR = 1.5;
const CAMERA_FAR = 160;

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.45;
const DEFAULT_ZOOM = 1.05;

export class IsometricCamera {
  readonly camera: THREE.OrthographicCamera;

  /** Target look-at point on the ground plane (y = 0.6). */
  private target = new THREE.Vector3(0, 0.5, 0);
  private desiredTarget = new THREE.Vector3(0, 0.5, 0);

  /** Current step index (unbounded integer so rotation always takes the shortest 90° path). */
  private rotationStep = 0;
  private currentAzimuth = Math.PI / 4; // 45° default isometric angle
  private desiredAzimuth = Math.PI / 4;

  private currentZoom = DEFAULT_ZOOM;
  private desiredZoom = DEFAULT_ZOOM;

  private aspect = 1;
  private panLimit = 9;
  private cinematicMode = false;
  private cinematicTime = 0;
  private preCinematicZoom = DEFAULT_ZOOM;
  private preCinematicTarget = new THREE.Vector3(0, 0.5, 0);

  private onStepChange?: (quarter: number) => void;

  constructor(width: number, height: number, onStepChange?: (quarter: number) => void) {
    this.aspect = Math.max(0.1, width / Math.max(1, height));
    this.onStepChange = onStepChange;

    this.camera = new THREE.OrthographicCamera(
      -BASE_FRUSTUM_HALF_HEIGHT * this.aspect,
      BASE_FRUSTUM_HALF_HEIGHT * this.aspect,
      BASE_FRUSTUM_HALF_HEIGHT,
      -BASE_FRUSTUM_HALF_HEIGHT,
      CAMERA_NEAR,
      CAMERA_FAR,
    );
    this.camera.zoom = this.currentZoom;
    this.camera.updateProjectionMatrix();
    this.applyCameraTransform();
  }

  setPanLimit(gridWidth: number, gridDepth: number): void {
    this.panLimit = Math.max(gridWidth, gridDepth) * 0.65;
  }

  isCinematicMode(): boolean {
    return this.cinematicMode;
  }

  setCinematicMode(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.cinematicMode === next) return;
    this.cinematicMode = next;
    if (next) {
      this.preCinematicZoom = this.desiredZoom;
      this.preCinematicTarget.copy(this.desiredTarget);
      this.cinematicTime = 0;
      this.desiredTarget.set(0, 0.7, 0);
    } else {
      this.rotationStep = Math.round((this.currentAzimuth - Math.PI / 4) / (Math.PI / 2));
      this.desiredAzimuth = Math.PI / 4 + this.rotationStep * (Math.PI / 2);
      const normalized = ((this.rotationStep % 4) + 4) % 4;
      this.onStepChange?.(normalized);
      this.desiredZoom = this.preCinematicZoom;
      this.desiredTarget.set(this.preCinematicTarget.x, 0.5, this.preCinematicTarget.z);
    }
  }

  resize(width: number, height: number): void {
    this.aspect = Math.max(0.1, width / Math.max(1, height));
    this.camera.left = -BASE_FRUSTUM_HALF_HEIGHT * this.aspect;
    this.camera.right = BASE_FRUSTUM_HALF_HEIGHT * this.aspect;
    this.camera.top = BASE_FRUSTUM_HALF_HEIGHT;
    this.camera.bottom = -BASE_FRUSTUM_HALF_HEIGHT;
    this.camera.updateProjectionMatrix();
  }

  rotateStep(deltaSteps: 1 | -1): void {
    this.rotationStep += deltaSteps;
    this.desiredAzimuth = Math.PI / 4 + this.rotationStep * (Math.PI / 2);
    const normalized = ((this.rotationStep % 4) + 4) % 4;
    this.onStepChange?.(normalized);
  }

  getQuarterStep(): number {
    return ((this.rotationStep % 4) + 4) % 4;
  }

  zoomByFactor(factor: number): void {
    this.desiredZoom = THREE.MathUtils.clamp(this.desiredZoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  setZoom(zoom: number): void {
    this.desiredZoom = THREE.MathUtils.clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  }

  getZoom(): number {
    return this.desiredZoom;
  }

  /**
   * Pans camera in screen-space pixel delta (trackpad two-finger scroll or click-drag).
   */
  panByPixels(dxPixels: number, dyPixels: number, viewportHeight: number): void {
    const worldPerPixel = (BASE_FRUSTUM_HALF_HEIGHT * 2) / (Math.max(1, viewportHeight) * this.currentZoom);

    // Screen right vector projected onto the XZ ground plane
    const cosA = Math.cos(this.currentAzimuth);
    const sinA = Math.sin(this.currentAzimuth);
    // Right in XZ plane: (cosA, 0, -sinA)
    const rightX = cosA;
    const rightZ = -sinA;
    // Screen-down projected onto XZ plane (away from camera look direction)
    const downScale = 1 / Math.sin(ISO_ELEVATION_RAD);
    const forwardX = -sinA;
    const forwardZ = -cosA;

    const moveRight = -dxPixels * worldPerPixel;
    const moveForward = dyPixels * worldPerPixel * downScale;

    this.desiredTarget.x = THREE.MathUtils.clamp(
      this.desiredTarget.x + rightX * moveRight + forwardX * moveForward,
      -this.panLimit,
      this.panLimit,
    );
    this.desiredTarget.z = THREE.MathUtils.clamp(
      this.desiredTarget.z + rightZ * moveRight + forwardZ * moveForward,
      -this.panLimit,
      this.panLimit,
    );
  }

  resetView(): void {
    this.desiredTarget.set(0, 0.5, 0);
    this.desiredZoom = DEFAULT_ZOOM;
    // Snap smoothly back to nearest multiple of 4 (45° default)
    const mod = ((this.rotationStep % 4) + 4) % 4;
    if (mod === 1) this.rotationStep -= 1;
    else if (mod === 2) this.rotationStep -= 2;
    else if (mod === 3) this.rotationStep += 1;
    this.desiredAzimuth = Math.PI / 4 + this.rotationStep * (Math.PI / 2);
    this.onStepChange?.(0);
  }

  update(dt: number): void {
    const clampedDt = Math.min(dt, 0.1);
    const smooth = 1 - Math.exp(-12 * clampedDt);

    if (this.cinematicMode) {
      this.cinematicTime += clampedDt;
      this.currentAzimuth += 0.16 * clampedDt;
      this.desiredAzimuth = this.currentAzimuth;
      this.desiredTarget.set(0, 0.7, 0);
      this.desiredZoom = 1.08 + 0.08 * Math.sin(this.cinematicTime * 0.35);
      const cinSmooth = 1 - Math.exp(-3.5 * clampedDt);
      this.currentZoom = THREE.MathUtils.lerp(this.currentZoom, this.desiredZoom, cinSmooth);
      this.target.lerp(this.desiredTarget, cinSmooth);
    } else {
      this.currentAzimuth = THREE.MathUtils.lerp(this.currentAzimuth, this.desiredAzimuth, smooth);
      this.currentZoom = THREE.MathUtils.lerp(this.currentZoom, this.desiredZoom, smooth);
      this.target.lerp(this.desiredTarget, smooth);
    }

    if (Math.abs(this.camera.zoom - this.currentZoom) > 0.0002) {
      this.camera.zoom = this.currentZoom;
      this.camera.updateProjectionMatrix();
    }

    this.applyCameraTransform();
  }

  private applyCameraTransform(): void {
    const horizDist = CAMERA_DISTANCE * Math.cos(ISO_ELEVATION_RAD);
    const vertDist = CAMERA_DISTANCE * Math.sin(ISO_ELEVATION_RAD);

    this.camera.position.set(
      this.target.x + Math.sin(this.currentAzimuth) * horizDist,
      this.target.y + vertDist,
      this.target.z + Math.cos(this.currentAzimuth) * horizDist,
    );
    this.camera.lookAt(this.target);
  }
}
