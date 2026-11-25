/**
 * Shared Single-Context WebGL Optical Compositor for Liquid Glass UI.
 *
 * Implements a 9-stage After Effects-inspired compositing pipeline in GLSL ES 1.00:
 *   1. Real Mushaf scene texture capture (cached & dirtied only on scene/offset changes)
 *   2. Exact Rounded-Rectangle SDF geometry + analytical Height/Normal maps (CC Glass)
 *   3. Transform + localized edge-weighted optical magnification (CC Lens)
 *   4. Normal-driven Snell inward refraction + micro-dispersion (Displacement Map)
 *   5. Controlled edge-weighted Gaussian optical softening (Gaussian Blur)
 *   6. Dual Blinn-Phong + Fresnel surface reflections from Normal Map
 *   7. Curved directional edge sheen & slow sweeping highlight (CC Light Sweep)
 *   8. Physical inner rim thickness / ambient occlusion shading
 *   9. Analytical SDF anti-aliased clipping (Track Mattes)
 */

import type {BackdropOffset, BackdropWorldSlot} from '../contexts/MushafBackdropContext';
import type {MushafThemeConfig} from '../types/mushaf';
import {getOpticalTierConfig, type OpticalGlassTier} from './opticalGlassMaps';

const VERTEX_SHADER_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `
precision highp float;

varying vec2 v_uv;

uniform sampler2D u_backdropTex;
uniform sampler2D u_backdropSoftTex;
uniform vec2 u_viewportSize;
uniform vec4 u_boxRect;
uniform float u_radius;
uniform float u_bevel;
uniform float u_refractPx;
uniform float u_magnify;
uniform float u_blurCenter;
uniform float u_blurEdge;
uniform float u_chromatic;
uniform float u_sweepPhase;
uniform float u_isDark;
uniform float u_frostedMix;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - (b - vec2(r));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec2 sdRoundedBoxGrad(vec2 p, vec2 b, float r) {
  vec2 s = vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  vec2 q = abs(p) - (b - vec2(r));
  if (q.x > 0.0 && q.y > 0.0) {
    float len = max(0.0001, length(q));
    return s * (q / len);
  }
  if (q.x >= q.y) {
    return vec2(s.x, 0.0);
  }
  return vec2(0.0, s.y);
}

vec3 sampleBlurredScene(vec2 uv, float blurPx) {
  vec2 pxToUv = 1.0 / max(vec2(1.0), u_viewportSize);
  vec2 safeUv = clamp(uv, vec2(0.001), vec2(0.999));

  if (blurPx <= 0.12) {
    return texture2D(u_backdropTex, safeUv).rgb;
  }

  // Smooth 3x3 tent-Gaussian for tiny subpixel optical softening (< 0.9px) -> 0 ring echoes
  if (blurPx < 0.9) {
    vec2 s = pxToUv * (blurPx * 0.72);
    vec3 c = texture2D(u_backdropTex, safeUv).rgb * 0.25;
    c += texture2D(u_backdropTex, clamp(safeUv + vec2( s.x,  0.0), vec2(0.001), vec2(0.999))).rgb * 0.125;
    c += texture2D(u_backdropTex, clamp(safeUv + vec2(-s.x,  0.0), vec2(0.001), vec2(0.999))).rgb * 0.125;
    c += texture2D(u_backdropTex, clamp(safeUv + vec2( 0.0,  s.y), vec2(0.001), vec2(0.999))).rgb * 0.125;
    c += texture2D(u_backdropTex, clamp(safeUv + vec2( 0.0, -s.y), vec2(0.001), vec2(0.999))).rgb * 0.125;
    c += texture2D(u_backdropTex, clamp(safeUv + vec2( s.x,  s.y), vec2(0.001), vec2(0.999))).rgb * 0.0625;
    c += texture2D(u_backdropTex, clamp(safeUv + vec2(-s.x,  s.y), vec2(0.001), vec2(0.999))).rgb * 0.0625;
    c += texture2D(u_backdropTex, clamp(safeUv + vec2( s.x, -s.y), vec2(0.001), vec2(0.999))).rgb * 0.0625;
    c += texture2D(u_backdropTex, clamp(safeUv + vec2(-s.x, -s.y), vec2(0.001), vec2(0.999))).rgb * 0.0625;
    return c;
  }

  // True dense 5x5 Gaussian kernel (sub-pixel step <= 0.9px) -> silky edge blur with zero ghosting
  vec2 stepUv = pxToUv * (blurPx * 0.42);
  vec3 sum = vec3(0.0);
  float wSum = 0.0;
  for (int iy = -2; iy <= 2; iy++) {
    float fy = float(iy);
    float wy = exp(-0.32 * fy * fy);
    for (int ix = -2; ix <= 2; ix++) {
      float fx = float(ix);
      float w = wy * exp(-0.32 * fx * fx);
      vec2 tapUv = clamp(safeUv + vec2(fx, fy) * stepUv, vec2(0.001), vec2(0.999));
      sum += texture2D(u_backdropTex, tapUv).rgb * w;
      wSum += w;
    }
  }
  return sum / max(0.001, wSum);
}

void main() {
  vec2 boxSize = max(vec2(1.0), u_boxRect.zw);
  vec2 localPx = v_uv * boxSize;
  vec2 halfSize = boxSize * 0.5;
  vec2 p = localPx - halfSize;

  float radius = min(min(halfSize.x, halfSize.y), max(1.0, u_radius));
  float sd = sdRoundedBox(p, halfSize, radius);

  // Stage 8: Analytical Track Matte anti-aliased isolation
  float matte = 1.0 - smoothstep(-0.75, 0.75, sd);
  if (matte <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 grad2D = sdRoundedBoxGrad(p, halfSize, radius);
  float inwardDist = max(0.0, -sd);
  float bevel = max(2.0, u_bevel);
  float t = clamp(1.0 - inwardDist / bevel, 0.0, 1.0);
  float tCurve = t * t * (3.0 - 2.0 * t);

  // Stage 2: CC Glass Height & Normal Map (center flat, curved perimeter bevel)
  float safeTCurve = max(0.0001, tCurve);
  float safeT = max(0.0001, t);
  float slope = pow(safeTCurve, 0.72) * 0.96;
  float nz = sqrt(max(0.03, 1.0 - slope * slope));
  vec3 N = normalize(vec3(grad2D * slope, nz));

  // Stage 3: Scale-Invariant CC Lens Convex Magnification
  // Uses normalized radial coordinates so tall/wide panels never develop derivative inversion streaks
  vec2 screenPx = u_boxRect.xy + localPx;
  vec2 boxCenter = u_boxRect.xy + halfSize;
  vec2 normPos = p / max(vec2(1.0), halfSize);
  float radialSq = clamp(dot(normPos, normPos), 0.0, 1.0);
  float lensZoom = u_magnify * (0.45 + 0.55 * radialSq);
  vec2 lensOffset = -(screenPx - boxCenter) * (lensZoom / (1.0 + lensZoom));

  // Stage 4: Smooth Non-Inverting Anisotropic Displacement Map Refraction
  // Monotonic edge-stretch curve (pow 1.55 with R <= 0.42 * bevel) prevents pixel smearing / barcode stripes
  float safeRefractPx = min(u_refractPx, bevel * 0.42);
  float edgeDirWeight = 1.0 + 0.16 * grad2D.y + 0.08 * grad2D.x;
  vec2 refractOffset = -grad2D * (safeRefractPx * edgeDirWeight * pow(safeT, 1.55));

  vec2 sampleScreenPx = screenPx + lensOffset + refractOffset;
  vec2 baseUv = sampleScreenPx / max(vec2(1.0), u_viewportSize);

  // Stage 5: Dual-Layer Controlled Optical Softening
  // Compact pills/lenses use crisp local optical sampling; large frosted sheets transition from
  // a silky mip-pyramid soft backdrop in the center to crisp refracted glass along the curved edge
  float edgeBlurPx = mix(u_blurCenter * (1.0 - u_frostedMix), u_blurEdge, pow(safeTCurve, 1.15));
  vec3 refractedBg = sampleBlurredScene(baseUv, min(1.85, edgeBlurPx));

  if (u_chromatic > 0.05 && tCurve > 0.30) {
    vec2 prismUv = grad2D * (u_chromatic * pow(safeTCurve, 2.0)) / max(vec2(1.0), u_viewportSize);
    float rCh = sampleBlurredScene(baseUv - prismUv, min(1.4, edgeBlurPx * 0.70)).r;
    float bCh = sampleBlurredScene(baseUv + prismUv, min(1.4, edgeBlurPx * 0.70)).b;
    refractedBg = vec3(
      mix(refractedBg.r, rCh, 0.72),
      refractedBg.g,
      mix(refractedBg.b, bCh, 0.72)
    );
  }

  if (u_frostedMix > 0.01) {
    vec3 softBg = texture2D(u_backdropSoftTex, clamp(baseUv, vec2(0.002), vec2(0.998))).rgb;
    float softBlend = mix(0.94, 0.44, pow(safeTCurve, 0.9));
    refractedBg = mix(refractedBg, softBg, softBlend * u_frostedMix);
  }

  // Neutral Clear Glass vs Silky Frosted Large Sheet contrast balance
  vec3 neutralTint = u_isDark > 0.5 ? vec3(0.072, 0.068, 0.060) : vec3(0.992, 0.985, 0.964);
  float pillWash = u_isDark > 0.5 ? 0.10 : 0.06;
  float sheetCenterWash = u_isDark > 0.5 ? 0.66 : 0.62;
  float sheetEdgeWash = u_isDark > 0.5 ? 0.24 : 0.18;
  float sheetWash = mix(sheetCenterWash, sheetEdgeWash, pow(safeTCurve, 0.9) * 0.88);
  float baseWash = mix(pillWash, sheetWash, u_frostedMix);
  vec3 glassColor = mix(refractedBg, neutralTint, baseWash);

  // Stage 6: Internal Glass Thickness & Refractive Depth Shading along curved edge
  float bevelMidMask = pow(safeTCurve, 1.15) * (1.0 - smoothstep(0.88, 1.0, tCurve) * 0.45);
  float dirDepthBias = 0.64 + 0.36 * max(0.0, dot(grad2D, normalize(vec2(0.32, 0.95))));
  float innerRimShadow = bevelMidMask * dirDepthBias * (u_isDark > 0.5 ? 0.40 : 0.18);
  glassColor *= (1.0 - innerRimShadow);

  // Subtle internal caustic bounce tucked inside the lower glass curvature
  float causticDelta = (inwardDist - bevel * 0.34) / max(3.0, bevel * 0.24);
  float causticBand = exp(-(causticDelta * causticDelta));
  float bottomArcMask = smoothstep(-0.1, 0.92, dot(grad2D, normalize(vec2(0.35, 0.94))));
  glassColor += vec3(causticBand * bottomArcMask * (u_isDark > 0.5 ? 0.055 : 0.032));

  // Stage 7: Thin, Localized, Irregular Specular Edge Reflections (zero thick uniform white rim)
  vec3 L1 = normalize(vec3(-0.46, -0.78, 0.42));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H1 = normalize(L1 + V);

  vec3 L2 = normalize(vec3(0.44, 0.80, 0.38));
  vec3 H2 = normalize(L2 + V);

  float outerThinMask = pow(safeT, 8.5);
  float microLip = smoothstep(max(0.0, 1.8), 0.0, inwardDist);

  float specPrimary = pow(max(0.0001, dot(N, H1)), 42.0) * outerThinMask;
  float specCounter = pow(max(0.0001, dot(N, H2)), 36.0) * outerThinMask;

  float maxHalf = max(1.0, max(halfSize.x, halfSize.y));
  float sweepCoord = dot(p / maxHalf, vec2(0.86, 0.51));
  float sweepPos = sin(u_sweepPhase) * 0.72;
  float sweepDelta = (sweepCoord - sweepPos) * 2.2;
  float sweepWave = exp(-(sweepDelta * sweepDelta));

  // Organic non-uniform reflection modulation along perimeter (breaks uniform plastic stroke)
  float rimIrregularity = 0.64 + 0.36 * (0.5 + 0.5 * sin(p.x * 0.024 - p.y * 0.019));
  float topLeftArc = smoothstep(-0.18, -0.94, dot(grad2D, normalize(vec2(-0.62, -0.78))));
  float bottomRightArc = smoothstep(0.14, 0.94, dot(grad2D, normalize(vec2(0.55, 0.84))));

  float sweepEnergy =
    microLip * rimIrregularity * (
      topLeftArc * (0.30 + 0.52 * sweepWave) +
      bottomRightArc * (0.14 + 0.24 * (1.0 - sweepWave))
    );

  float specGain = u_isDark > 0.5 ? 0.34 : 0.20;
  float rimGain = u_isDark > 0.5 ? 0.22 : 0.13;
  float lightEnergy =
    (specPrimary + specCounter * 0.40) * specGain +
    sweepEnergy * rimGain;

  vec3 specularColor = u_isDark > 0.5 ? vec3(0.98, 0.96, 0.92) : vec3(1.0, 0.998, 0.99);
  vec3 finalRgb = clamp(glassColor + specularColor * lightEnergy, 0.0, 1.0);

  gl_FragColor = vec4(finalRgb * matte, matte);
}
`;

export interface RenderGlassSurfaceParams {
  targetCanvas: HTMLCanvasElement;
  dpr: number;
  box: {left: number; top: number; width: number; height: number};
  cornerRadius: number;
  tier: OpticalGlassTier;
  isDark: boolean;
  sweepPhase: number;
}

export interface SyncSceneParams {
  viewport: {width: number; height: number};
  theme: MushafThemeConfig;
  slots: BackdropWorldSlot[];
  snapshots: Record<string, string>;
  offset: BackdropOffset;
  onAsyncImageReady: () => void;
}

const MAX_DECODED_IMAGES = 16;

class OpticalWebGLCompositor {
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private backdropTex: WebGLTexture | null = null;
  private backdropSoftTex: WebGLTexture | null = null;
  private sceneCanvas: HTMLCanvasElement | null = null;
  private sceneCtx: CanvasRenderingContext2D | null = null;
  private midCanvas: HTMLCanvasElement | null = null;
  private midCtx: CanvasRenderingContext2D | null = null;
  private softCanvas: HTMLCanvasElement | null = null;
  private softCtx: CanvasRenderingContext2D | null = null;
  private initialized = false;
  private supported = false;
  private lastSceneSignature = '';
  private decodedCount = 0;

  private uniforms: {
    backdropTex: WebGLUniformLocation | null;
    backdropSoftTex: WebGLUniformLocation | null;
    viewportSize: WebGLUniformLocation | null;
    boxRect: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    bevel: WebGLUniformLocation | null;
    refractPx: WebGLUniformLocation | null;
    magnify: WebGLUniformLocation | null;
    blurCenter: WebGLUniformLocation | null;
    blurEdge: WebGLUniformLocation | null;
    chromatic: WebGLUniformLocation | null;
    sweepPhase: WebGLUniformLocation | null;
    isDark: WebGLUniformLocation | null;
    frostedMix: WebGLUniformLocation | null;
  } | null = null;

  private imageCache = new Map<string, HTMLImageElement>();

  private ensureInit(): boolean {
    if (this.initialized) return this.supported;
    this.initialized = true;

    if (typeof document === 'undefined') {
      this.supported = false;
      return false;
    }

    try {
      const glCanvas = document.createElement('canvas');
      glCanvas.width = 64;
      glCanvas.height = 64;
      const opts: WebGLContextAttributes = {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      };
      const gl =
        (glCanvas.getContext('webgl2', opts) as WebGLRenderingContext | null) ??
        (glCanvas.getContext('webgl', opts) as WebGLRenderingContext | null);

      if (!gl) {
        this.supported = false;
        return false;
      }

      const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
      const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
      if (!vs || !fs) {
        this.supported = false;
        return false;
      }

      const prog = gl.createProgram();
      if (!prog) {
        this.supported = false;
        return false;
      }
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        this.supported = false;
        return false;
      }

      gl.useProgram(prog);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      const posLoc = gl.getAttribLocation(prog, 'a_pos');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      const softTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, softTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      const sceneCanvas = document.createElement('canvas');
      sceneCanvas.width = 64;
      sceneCanvas.height = 64;
      const sceneCtx = sceneCanvas.getContext('2d', {alpha: false});

      const midCanvas = document.createElement('canvas');
      midCanvas.width = 32;
      midCanvas.height = 32;
      const midCtx = midCanvas.getContext('2d', {alpha: false});

      const softCanvas = document.createElement('canvas');
      softCanvas.width = 16;
      softCanvas.height = 16;
      const softCtx = softCanvas.getContext('2d', {alpha: false});

      if (!sceneCtx || !midCtx || !softCtx || !tex || !softTex) {
        this.supported = false;
        return false;
      }

      this.glCanvas = glCanvas;
      this.gl = gl;
      this.program = prog;
      this.backdropTex = tex;
      this.backdropSoftTex = softTex;
      this.sceneCanvas = sceneCanvas;
      this.sceneCtx = sceneCtx;
      this.midCanvas = midCanvas;
      this.midCtx = midCtx;
      this.softCanvas = softCanvas;
      this.softCtx = softCtx;

      this.uniforms = {
        backdropTex: gl.getUniformLocation(prog, 'u_backdropTex'),
        backdropSoftTex: gl.getUniformLocation(prog, 'u_backdropSoftTex'),
        viewportSize: gl.getUniformLocation(prog, 'u_viewportSize'),
        boxRect: gl.getUniformLocation(prog, 'u_boxRect'),
        radius: gl.getUniformLocation(prog, 'u_radius'),
        bevel: gl.getUniformLocation(prog, 'u_bevel'),
        refractPx: gl.getUniformLocation(prog, 'u_refractPx'),
        magnify: gl.getUniformLocation(prog, 'u_magnify'),
        blurCenter: gl.getUniformLocation(prog, 'u_blurCenter'),
        blurEdge: gl.getUniformLocation(prog, 'u_blurEdge'),
        chromatic: gl.getUniformLocation(prog, 'u_chromatic'),
        sweepPhase: gl.getUniformLocation(prog, 'u_sweepPhase'),
        isDark: gl.getUniformLocation(prog, 'u_isDark'),
        frostedMix: gl.getUniformLocation(prog, 'u_frostedMix'),
      };

      this.supported = true;
      return true;
    } catch {
      this.supported = false;
      return false;
    }
  }

  private compileShader(
    gl: WebGLRenderingContext,
    type: number,
    src: string
  ): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  public isSupported(): boolean {
    return this.ensureInit();
  }

  private getOrLoadImage(url: string, onReady: () => void): HTMLImageElement | null {
    const existing = this.imageCache.get(url);
    if (existing) {
      this.imageCache.delete(url);
      this.imageCache.set(url, existing);
      return existing.complete && existing.naturalWidth > 0 ? existing : null;
    }

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.decodedCount += 1;
      onReady();
    };
    img.src = url;

    this.imageCache.set(url, img);
    if (this.imageCache.size > MAX_DECODED_IMAGES) {
      const oldestKey = this.imageCache.keys().next().value;
      if (oldestKey) this.imageCache.delete(oldestKey);
    }

    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /**
   * Re-renders & uploads the offscreen viewport backdrop ONLY when scene geometry,
   * active Mushaf snapshots, theme, or scroll/pan offset actually changes.
   */
  public syncSceneTexture(params: SyncSceneParams): boolean {
    if (
      !this.ensureInit() ||
      !this.gl ||
      !this.sceneCanvas ||
      !this.sceneCtx ||
      !this.midCanvas ||
      !this.midCtx ||
      !this.softCanvas ||
      !this.softCtx ||
      !this.backdropTex ||
      !this.backdropSoftTex
    ) {
      return false;
    }

    const vw = Math.max(64, Math.round(params.viewport.width));
    const vh = Math.max(64, Math.round(params.viewport.height));
    const ox = Math.round(params.offset.x * 2) / 2;
    const oy = Math.round(params.offset.y * 2) / 2;

    const slotSig = params.slots
      .map((s) => {
        const snapUrl = params.snapshots[`${s.page}:${params.theme.id}`] ?? '';
        return `${s.key}:${Math.round(s.x)}:${Math.round(s.y)}:${Math.round(s.width)}:${Math.round(s.height)}:${snapUrl.slice(-16)}`;
      })
      .join('|');

    const sig = `${params.theme.id}:${vw}x${vh}:${ox},${oy}:${this.decodedCount}:${slotSig}`;
    if (sig === this.lastSceneSignature) {
      return false;
    }
    this.lastSceneSignature = sig;

    // Draw scene at 1x CSS viewport scale (compact & crisp for optical sampling)
    if (this.sceneCanvas.width !== vw || this.sceneCanvas.height !== vh) {
      this.sceneCanvas.width = vw;
      this.sceneCanvas.height = vh;
    }

    const ctx = this.sceneCtx;
    ctx.fillStyle = params.theme.bg;
    ctx.fillRect(0, 0, vw, vh);

    if (params.theme.isDark) {
      const rg = ctx.createRadialGradient(
        vw * 0.5,
        vh * 0.42,
        0,
        vw * 0.5,
        vh * 0.42,
        Math.max(vw, vh) * 0.65
      );
      rg.addColorStop(0, '#1D1C19');
      rg.addColorStop(0.58, '#141412');
      rg.addColorStop(1, '#0E0E0C');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, vw, vh);
    } else {
      const lg = ctx.createLinearGradient(0, 0, 0, vh);
      lg.addColorStop(0, '#FDF9EE');
      lg.addColorStop(1, '#F8F1DF');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, vw, vh);
    }

    for (const slot of params.slots) {
      const sx = slot.x + ox;
      const sy = slot.y + oy;
      if (sx + slot.width < -20 || sy + slot.height < -20 || sx > vw + 20 || sy > vh + 20) {
        continue;
      }

      if (slot.key.startsWith('spread-')) {
        ctx.fillStyle = params.theme.surface;
        ctx.fillRect(sx - 6, sy - 16, slot.width + 12, slot.height + 32);
      }

      const snapUrl = params.snapshots[`${slot.page}:${params.theme.id}`];
      if (!snapUrl) continue;
      const img = this.getOrLoadImage(snapUrl, params.onAsyncImageReady);
      if (!img) continue;

      // Preserve aspect ratio cleanly ("xMidYMid meet") matching <svg> layout
      const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
      const slotRatio = slot.width / Math.max(1, slot.height);
      let drawW = slot.width;
      let drawH = slot.height;
      let drawX = sx;
      let drawY = sy;

      if (imgRatio > slotRatio) {
        drawH = slot.width / imgRatio;
        drawY = sy + (slot.height - drawH) / 2;
      } else {
        drawW = slot.height * imgRatio;
        drawX = sx + (slot.width - drawW) / 2;
      }

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    }

    // Build silky-smooth artifact-free mip-pyramid blur texture for large frosted sheets
    const mw = Math.max(32, Math.round(vw / 4));
    const mh = Math.max(32, Math.round(vh / 4));
    if (this.midCanvas.width !== mw || this.midCanvas.height !== mh) {
      this.midCanvas.width = mw;
      this.midCanvas.height = mh;
    }
    const sw = Math.max(16, Math.round(vw / 8));
    const sh = Math.max(16, Math.round(vh / 8));
    if (this.softCanvas.width !== sw || this.softCanvas.height !== sh) {
      this.softCanvas.width = sw;
      this.softCanvas.height = sh;
    }

    const mCtx = this.midCtx;
    const sCtx = this.softCtx;
    mCtx.imageSmoothingEnabled = true;
    mCtx.imageSmoothingQuality = 'high';
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';

    if (typeof mCtx.filter === 'string') {
      mCtx.filter = 'blur(2.5px)';
      mCtx.drawImage(this.sceneCanvas, 0, 0, mw, mh);
      mCtx.filter = 'none';
    } else {
      mCtx.drawImage(this.sceneCanvas, 0, 0, mw, mh);
    }
    sCtx.drawImage(this.midCanvas, 0, 0, sw, sh);
    mCtx.drawImage(this.softCanvas, 0, 0, mw, mh);

    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sceneCanvas);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropSoftTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.midCanvas);

    return true;
  }

  public renderSurfaceToCanvas(params: RenderGlassSurfaceParams): boolean {
    if (
      !this.ensureInit() ||
      !this.gl ||
      !this.glCanvas ||
      !this.program ||
      !this.uniforms ||
      !this.backdropTex ||
      !this.backdropSoftTex
    ) {
      return false;
    }

    const w = Math.max(16, params.box.width);
    const h = Math.max(16, params.box.height);
    const scale = Math.max(1, Math.min(2, params.dpr));
    const pxW = Math.max(16, Math.round(w * scale));
    const pxH = Math.max(16, Math.round(h * scale));

    if (this.glCanvas.width !== pxW || this.glCanvas.height !== pxH) {
      this.glCanvas.width = pxW;
      this.glCanvas.height = pxH;
    }

    if (params.targetCanvas.width !== pxW || params.targetCanvas.height !== pxH) {
      params.targetCanvas.width = pxW;
      params.targetCanvas.height = pxH;
    }

    const cfg = getOpticalTierConfig(params.tier, w, h);
    const bevel = Math.max(
      cfg.minBevelPx,
      Math.min(cfg.maxBevelPx, Math.min(w, h) * cfg.bevelRatio)
    );

    const vw = Math.max(64, this.sceneCanvas?.width ?? 390);
    const vh = Math.max(64, this.sceneCanvas?.height ?? 844);

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.viewport(0, 0, pxW, pxH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTex);
    gl.uniform1i(this.uniforms.backdropTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropSoftTex);
    gl.uniform1i(this.uniforms.backdropSoftTex, 1);

    gl.uniform2f(this.uniforms.viewportSize, vw, vh);
    gl.uniform4f(this.uniforms.boxRect, params.box.left, params.box.top, w, h);
    gl.uniform1f(this.uniforms.radius, params.cornerRadius);
    gl.uniform1f(this.uniforms.bevel, bevel);
    gl.uniform1f(this.uniforms.refractPx, cfg.refractPx);
    gl.uniform1f(this.uniforms.magnify, cfg.magnify);
    gl.uniform1f(this.uniforms.blurCenter, cfg.blurCenterPx);
    gl.uniform1f(this.uniforms.blurEdge, cfg.blurEdgePx);
    gl.uniform1f(this.uniforms.chromatic, cfg.chromaticPx);
    gl.uniform1f(this.uniforms.sweepPhase, params.sweepPhase);
    gl.uniform1f(this.uniforms.isDark, params.isDark ? 1.0 : 0.0);
    gl.uniform1f(this.uniforms.frostedMix, cfg.frostedMix);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const targetCtx = params.targetCanvas.getContext('2d');
    if (!targetCtx) return false;
    targetCtx.clearRect(0, 0, pxW, pxH);
    targetCtx.drawImage(this.glCanvas, 0, 0, pxW, pxH, 0, 0, pxW, pxH);
    return true;
  }
}

export const sharedOpticalCompositor = new OpticalWebGLCompositor();
