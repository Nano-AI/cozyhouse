import * as THREE from 'three';

export type VisualShaderId =
  | 'default'
  | 'retro_dither'
  | 'pocket'
  | 'storybook_ink'
  | 'golden_film'
  | 'crt_lofi';

export const VALID_VISUAL_SHADERS: readonly VisualShaderId[] = [
  'default',
  'retro_dither',
  'pocket',
  'storybook_ink',
  'golden_film',
  'crt_lofi',
];

export function isVisualShaderId(value: unknown): value is VisualShaderId {
  return typeof value === 'string' && (VALID_VISUAL_SHADERS as readonly string[]).includes(value);
}

const SHADER_MODE_INDEX: Record<VisualShaderId, number> = {
  default: 0,
  retro_dither: 1,
  pocket: 2,
  storybook_ink: 3,
  golden_film: 4,
  crt_lofi: 5,
};

const POST_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform int uMode;
  uniform float uExposure;
  uniform float uHasDepth;

  varying vec2 vUv;

  // Exact Three.js ACESFilmic RRT+ODT curve so offscreen linear render target matches default tone mapping
  vec3 rrtAndOdtFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }

  vec3 acesFilmic(vec3 color) {
    const mat3 ACESInputMat = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777
    );
    const mat3 ACESOutputMat = mat3(
      1.60475, -0.10208, -0.00327,
      -0.53108, 1.10813, -0.07276,
      -0.07367, -0.00605, 1.07602
    );
    color = ACESInputMat * max(color, vec3(0.0));
    color = rrtAndOdtFit(color);
    color = ACESOutputMat * color;
    return clamp(color, 0.0, 1.0);
  }

  vec3 linearToSrgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
  }

  vec3 toDisplay(vec3 linearRgb) {
    return linearToSrgb(acesFilmic(linearRgb * (uExposure / 0.6)));
  }

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // Ordered 4x4 Bayer matrix normalized to [-0.5, +0.5] (WebGL1 & WebGL2 compatible)
  float bayer4x4(vec2 pos) {
    int x = int(mod(floor(pos.x), 4.0));
    int y = int(mod(floor(pos.y), 4.0));
    int idx = y * 4 + x;
    float v = 0.0;
    if (idx == 0) v = 0.0;
    else if (idx == 1) v = 8.0;
    else if (idx == 2) v = 2.0;
    else if (idx == 3) v = 10.0;
    else if (idx == 4) v = 12.0;
    else if (idx == 5) v = 4.0;
    else if (idx == 6) v = 14.0;
    else if (idx == 7) v = 6.0;
    else if (idx == 8) v = 3.0;
    else if (idx == 9) v = 11.0;
    else if (idx == 10) v = 1.0;
    else if (idx == 11) v = 9.0;
    else if (idx == 12) v = 15.0;
    else if (idx == 13) v = 7.0;
    else if (idx == 14) v = 13.0;
    else v = 5.0;
    return (v + 0.5) / 16.0 - 0.5;
  }

  vec3 sampleDisplay(vec2 uv) {
    return toDisplay(texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb);
  }

  // 1. Low-Poly Retro Dithered Lighting (PS1 / N64 cozy diorama)
  vec3 renderRetroDither(vec2 uv) {
    float aspect = uResolution.x / max(1.0, uResolution.y);
    float gridH = 360.0;
    vec2 gridSize = vec2(max(1.0, floor(gridH * aspect + 0.5)), gridH);
    vec2 pix = floor(uv * gridSize);
    vec2 snapUv = (pix + 0.5) / gridSize;

    vec3 col = sampleDisplay(snapUv);
    float lum = luma(col);

    // Subtle warm shadow tint characteristic of nostalgic low-poly lighting
    vec3 warmShadow = col * vec3(1.04, 0.99, 0.93) + vec3(0.018, 0.010, 0.022);
    col = mix(col, warmShadow, (1.0 - smoothstep(0.08, 0.65, lum)) * 0.42);

    // 4x4 Bayer ordered dithering on luminance + RGB channels into 15-bit (32 levels/ch)
    float b = bayer4x4(pix);
    float ditherStrength = 0.030 + (1.0 - lum) * 0.026;
    vec3 dithered = clamp(col + vec3(b * (ditherStrength + 0.85 / 31.0)), 0.0, 1.0);
    col = floor(dithered * 31.0 + 0.5) / 31.0;

    // Gentle retro vignette
    vec2 centered = uv - 0.5;
    float vig = 1.0 - dot(centered, centered) * 0.28;
    return col * clamp(vig, 0.78, 1.0);
  }

  // 2. Handheld Pocket Dither (220p + 4x4 Bayer + cozy 4-tone sage/cream palette)
  vec3 renderPocket(vec2 uv) {
    float aspect = uResolution.x / max(1.0, uResolution.y);
    float gridH = 220.0;
    vec2 gridSize = vec2(max(1.0, floor(gridH * aspect + 0.5)), gridH);
    vec2 pix = floor(uv * gridSize);
    vec2 snapUv = (pix + 0.5) / gridSize;

    vec3 col = sampleDisplay(snapUv);
    float lum = clamp((luma(col) - 0.5) * 1.18 + 0.52, 0.0, 1.0);
    float b = bayer4x4(pix);
    float level = clamp(lum + b * 0.27, 0.0, 1.0);

    vec3 pal0 = vec3(0.137, 0.188, 0.145); // #233025
    vec3 pal1 = vec3(0.306, 0.416, 0.290); // #4E6A4A
    vec3 pal2 = vec3(0.588, 0.694, 0.486); // #96B17C
    vec3 pal3 = vec3(0.914, 0.933, 0.824); // #E9EED2

    vec3 outCol = pal0;
    if (level >= 0.75) outCol = pal3;
    else if (level >= 0.50) outCol = pal2;
    else if (level >= 0.25) outCol = pal1;

    // Subtle handheld LCD dot matrix micro-grid
    vec2 sub = fract(uv * gridSize);
    float lcd = 0.955 + 0.045 * smoothstep(0.0, 0.18, sub.x) * smoothstep(0.0, 0.18, sub.y);
    return outCol * lcd;
  }

  // 3. Storybook Ink & Cel (Orthographic Sobel depth + luminance outlines + cel pastel + paper grain)
  vec3 renderStorybookInk(vec2 uv) {
    vec2 texel = 1.0 / max(uResolution, vec2(1.0));
    vec3 centerCol = sampleDisplay(uv);

    // 3x3 Sobel luminance kernel
    float lTL = luma(sampleDisplay(uv + vec2(-texel.x,  texel.y)));
    float lTC = luma(sampleDisplay(uv + vec2( 0.0,      texel.y)));
    float lTR = luma(sampleDisplay(uv + vec2( texel.x,  texel.y)));
    float lML = luma(sampleDisplay(uv + vec2(-texel.x,  0.0)));
    float lMR = luma(sampleDisplay(uv + vec2( texel.x,  0.0)));
    float lBL = luma(sampleDisplay(uv + vec2(-texel.x, -texel.y)));
    float lBC = luma(sampleDisplay(uv + vec2( 0.0,     -texel.y)));
    float lBR = luma(sampleDisplay(uv + vec2( texel.x, -texel.y)));

    float gxL = -lTL - 2.0 * lML - lBL + lTR + 2.0 * lMR + lBR;
    float gyL = -lTL - 2.0 * lTC - lTR + lBL + 2.0 * lBC + lBR;
    float lumaEdge = smoothstep(0.24, 0.58, length(vec2(gxL, gyL)));

    // 3x3 Sobel orthographic depth kernel (linear in view Z for IsometricCamera!)
    float depthEdge = 0.0;
    if (uHasDepth > 0.5) {
      vec2 dt = texel * 1.15;
      float dTL = texture2D(tDepth, uv + vec2(-dt.x,  dt.y)).r;
      float dTC = texture2D(tDepth, uv + vec2( 0.0,   dt.y)).r;
      float dTR = texture2D(tDepth, uv + vec2( dt.x,  dt.y)).r;
      float dML = texture2D(tDepth, uv + vec2(-dt.x,  0.0)).r;
      float dMR = texture2D(tDepth, uv + vec2( dt.x,  0.0)).r;
      float dBL = texture2D(tDepth, uv + vec2(-dt.x, -dt.y)).r;
      float dBC = texture2D(tDepth, uv + vec2( 0.0,  -dt.y)).r;
      float dBR = texture2D(tDepth, uv + vec2( dt.x, -dt.y)).r;

      float gxD = -dTL - 2.0 * dML - dBL + dTR + 2.0 * dMR + dBR;
      float gyD = -dTL - 2.0 * dTC - dTR + dBL + 2.0 * dBC + dBR;
      depthEdge = smoothstep(0.012, 0.042, length(vec2(gxD, gyD)));
    }

    // Soft cel-stepped pastel shading
    float lum = max(0.001, luma(centerCol));
    float celLum = mix(lum, floor(lum * 5.0 + 0.5) / 5.0, 0.36);
    vec3 pastel = centerCol * (celLum / lum);
    // Warm storybook paper lift + slight saturation boost
    float pLum = luma(pastel);
    pastel = mix(vec3(pLum), pastel, 1.09);
    pastel = mix(pastel, pastel * vec3(1.02, 1.00, 0.96), 0.35);

    // Subtle static warm paper tooth grain
    float grain = (hash12(floor(gl_FragCoord.xy * 0.75)) - 0.5) * 0.032;
    pastel = clamp(pastel + vec3(grain, grain * 0.95, grain * 0.85), 0.0, 1.0);

    vec3 inkCol = vec3(0.176, 0.149, 0.125); // #2D2620 warm storybook ink
    float inkMask = clamp(max(depthEdge * 0.88, lumaEdge * 0.52), 0.0, 0.90);
    return mix(pastel, inkCol, inkMask);
  }

  // 4. Golden Analog Film (Warm highlight halation bloom + Kodak gold warmth + shadow lift + animated grain)
  vec3 renderGoldenFilm(vec2 uv) {
    vec2 texel = 1.0 / max(uResolution, vec2(1.0));
    vec3 linearCenter = texture2D(tDiffuse, uv).rgb;

    // 8-tap radial highlight halation bloom in linear space
    vec3 bloom = vec3(0.0);
    vec2 offsets[8];
    offsets[0] = vec2( 1.0,  0.0);
    offsets[1] = vec2(-1.0,  0.0);
    offsets[2] = vec2( 0.0,  1.0);
    offsets[3] = vec2( 0.0, -1.0);
    offsets[4] = vec2( 0.707,  0.707);
    offsets[5] = vec2(-0.707,  0.707);
    offsets[6] = vec2( 0.707, -0.707);
    offsets[7] = vec2(-0.707, -0.707);

    for (int i = 0; i < 8; i++) {
      vec3 s1 = texture2D(tDiffuse, clamp(uv + offsets[i] * texel * 2.6, vec2(0.001), vec2(0.999))).rgb;
      vec3 s2 = texture2D(tDiffuse, clamp(uv + offsets[i] * texel * 5.8, vec2(0.001), vec2(0.999))).rgb;
      bloom += max(s1 - vec3(0.55), vec3(0.0)) * 0.62;
      bloom += max(s2 - vec3(0.55), vec3(0.0)) * 0.38;
    }
    bloom *= (1.0 / 8.0);

    // Warm reddish-gold film halation glow
    vec3 halated = linearCenter + bloom * vec3(1.22, 0.90, 0.56) * 0.48;
    vec3 col = toDisplay(halated);

    // Kodak-gold warm highlights + gentle lifted cozy shadow toe
    col = mix(vec3(0.052, 0.038, 0.044), vec3(1.0), col);
    col *= vec3(1.045, 1.005, 0.928);
    // Gentle analog S-curve
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);

    // Subtle 24fps organic film grain
    float frameSeed = floor(uTime * 24.0) * 0.37;
    float g = (hash12(gl_FragCoord.xy + vec2(frameSeed * 17.3, frameSeed * 31.7)) - 0.5);
    float grainMask = 0.6 + 0.4 * (1.0 - luma(col));
    col += vec3(g * 0.032 * grainMask);

    // Soft analog lens vignette
    vec2 centered = uv - 0.5;
    float vig = 1.0 - dot(centered, centered) * 0.42;
    return clamp(col * clamp(vig, 0.68, 1.0), 0.0, 1.0);
  }

  // 5. CRT Lo-Fi (Subtle scanlines + radial RGB phosphor offset + warm glow + cozy vignette)
  vec3 renderCrtLofi(vec2 uv) {
    vec2 centered = uv - 0.5;
    float r2 = dot(centered, centered);

    // Subtle CRT glass barrel curvature
    vec2 crtUv = 0.5 + centered * (1.0 + 0.055 * r2);
    vec2 clampedUv = clamp(crtUv, vec2(0.001), vec2(0.999));

    // Gentle radial RGB phosphor chromatic offset strongest near edges
    vec2 caOffset = centered * (0.0022 + 0.0065 * r2);
    float rCh = sampleDisplay(clampedUv + caOffset).r;
    float gCh = sampleDisplay(clampedUv).g;
    float bCh = sampleDisplay(clampedUv - caOffset).b;
    vec3 col = vec3(rCh, gCh, bCh);

    // Subtle warm phosphor bloom halo
    vec2 texel = 1.0 / max(uResolution, vec2(1.0));
    vec3 glow = (
      sampleDisplay(clampedUv + vec2( texel.x * 2.2, 0.0)) +
      sampleDisplay(clampedUv + vec2(-texel.x * 2.2, 0.0)) +
      sampleDisplay(clampedUv + vec2(0.0,  texel.y * 2.2)) +
      sampleDisplay(clampedUv + vec2(0.0, -texel.y * 2.2))
    ) * 0.25;
    col = mix(col, max(col, glow), 0.22);
    col *= vec3(1.02, 1.00, 0.97);

    // Crisp horizontal CRT scanlines + subtle subpixel shimmer
    float scanFreq = min(uResolution.y * 0.5, 420.0);
    float scan = 0.90 + 0.10 * sin(crtUv.y * scanFreq * 6.2831853);
    col *= scan;

    // Gentle phosphor grille + CRT vignette & soft corner mask
    float mask = 0.975 + 0.025 * sin(gl_FragCoord.x * 3.14159);
    float vig = clamp(1.0 - r2 * 0.56, 0.58, 1.0);
    float inBounds =
      step(0.0, crtUv.x) * step(crtUv.x, 1.0) *
      step(0.0, crtUv.y) * step(crtUv.y, 1.0);
    return clamp(col * mask * vig * mix(0.25, 1.0, inBounds), 0.0, 1.0);
  }

  void main() {
    vec3 finalCol;
    if (uMode == 1) {
      finalCol = renderRetroDither(vUv);
    } else if (uMode == 2) {
      finalCol = renderPocket(vUv);
    } else if (uMode == 3) {
      finalCol = renderStorybookInk(vUv);
    } else if (uMode == 4) {
      finalCol = renderGoldenFilm(vUv);
    } else if (uMode == 5) {
      finalCol = renderCrtLofi(vUv);
    } else {
      finalCol = sampleDisplay(vUv);
    }
    gl_FragColor = vec4(finalCol, 1.0);
  }
`;

/**
 * Single-pass full-screen WebGLRenderTarget post-processing pipeline with lazy allocation.
 * In `'default'` mode, bypasses the render target completely with zero GPU or VRAM overhead.
 */
export class ShaderPipeline {
  private preset: VisualShaderId = 'default';
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private depthTexture: THREE.DepthTexture | null = null;
  private postScene: THREE.Scene | null = null;
  private postCamera: THREE.OrthographicCamera | null = null;
  private postGeo: THREE.PlaneGeometry | null = null;
  private postMat: THREE.ShaderMaterial | null = null;
  private postQuad: THREE.Mesh | null = null;

  private rtWidth = 1;
  private rtHeight = 1;
  private disposed = false;

  getPreset(): VisualShaderId {
    return this.preset;
  }

  setPreset(id: VisualShaderId): void {
    this.preset = isVisualShaderId(id) ? id : 'default';
    if (this.postMat) {
      this.postMat.uniforms.uMode.value = SHADER_MODE_INDEX[this.preset];
    }
  }

  /** Returns true when a stylized post-process pass is active (false = direct render bypass). */
  isActive(): boolean {
    return this.preset !== 'default';
  }

  private ensureResources(renderer: THREE.WebGLRenderer): void {
    if (this.renderTarget && this.postScene && this.postMat && this.postCamera) {
      return;
    }

    const dom = renderer.domElement;
    const pixelRatio = typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : 1;
    const cssW = dom?.clientWidth || 1280;
    const cssH = dom?.clientHeight || 800;
    this.rtWidth = Math.max(1, Math.floor(cssW * pixelRatio));
    this.rtHeight = Math.max(1, Math.floor(cssH * pixelRatio));

    const caps = renderer.capabilities as { isWebGL2?: boolean } | undefined;
    const exts = renderer.extensions as { has?: (name: string) => boolean } | undefined;
    const isWebGL2 = Boolean(caps?.isWebGL2);
    const supportsHalfFloat =
      isWebGL2 &&
      Boolean(exts?.has?.('EXT_color_buffer_half_float') || exts?.has?.('EXT_color_buffer_float'));
    const supportsDepthTex = isWebGL2 || Boolean(exts?.has?.('WEBGL_depth_texture'));

    this.depthTexture = supportsDepthTex
      ? new THREE.DepthTexture(this.rtWidth, this.rtHeight)
      : null;
    if (this.depthTexture) {
      this.depthTexture.minFilter = THREE.NearestFilter;
      this.depthTexture.magFilter = THREE.NearestFilter;
    }

    this.renderTarget = new THREE.WebGLRenderTarget(this.rtWidth, this.rtHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: supportsHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: this.depthTexture,
    });

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postGeo = new THREE.PlaneGeometry(2, 2);
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX_SHADER,
      fragmentShader: POST_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        tDepth: { value: this.depthTexture },
        uResolution: { value: new THREE.Vector2(this.rtWidth, this.rtHeight) },
        uTime: { value: 0 },
        uMode: { value: SHADER_MODE_INDEX[this.preset] },
        uExposure: { value: renderer.toneMappingExposure ?? 1.04 },
        uHasDepth: { value: this.depthTexture ? 1.0 : 0.0 },
      },
    });

    this.postQuad = new THREE.Mesh(this.postGeo, this.postMat);
    this.postQuad.frustumCulled = false;
    this.postScene.add(this.postQuad);
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    const nextW = Math.max(1, Math.floor(width * pixelRatio));
    const nextH = Math.max(1, Math.floor(height * pixelRatio));
    if (nextW === this.rtWidth && nextH === this.rtHeight) return;

    this.rtWidth = nextW;
    this.rtHeight = nextH;

    if (this.renderTarget) {
      this.renderTarget.setSize(nextW, nextH);
    }
    if (this.postMat) {
      (this.postMat.uniforms.uResolution.value as THREE.Vector2).set(nextW, nextH);
    }
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    elapsedTime: number,
  ): void {
    if (this.disposed || this.preset === 'default') {
      renderer.render(scene, camera);
      return;
    }

    this.ensureResources(renderer);
    if (!this.renderTarget || !this.postScene || !this.postCamera || !this.postMat) {
      renderer.render(scene, camera);
      return;
    }

    this.postMat.uniforms.uTime.value = elapsedTime;
    this.postMat.uniforms.uMode.value = SHADER_MODE_INDEX[this.preset];
    this.postMat.uniforms.uExposure.value = renderer.toneMappingExposure ?? 1.04;

    const prevTarget =
      typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
    if (typeof renderer.setRenderTarget === 'function') {
      renderer.setRenderTarget(this.renderTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prevTarget);
      renderer.render(this.postScene, this.postCamera);
    } else {
      // Headless mock fallback when setRenderTarget is unavailable
      renderer.render(scene, camera);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    if (this.depthTexture) {
      this.depthTexture.dispose();
      this.depthTexture = null;
    }
    if (this.postGeo) {
      this.postGeo.dispose();
      this.postGeo = null;
    }
    if (this.postMat) {
      this.postMat.dispose();
      this.postMat = null;
    }
    if (this.postScene && this.postQuad) {
      this.postScene.remove(this.postQuad);
    }
    this.postQuad = null;
    this.postScene = null;
    this.postCamera = null;
  }
}
