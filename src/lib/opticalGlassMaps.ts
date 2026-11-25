/**
 * Analytical Rounded-Rectangle Signed Distance Field (SDF) optical geometry
 * and tier calibration for After Effects-inspired Liquid Glass compositing.
 *
 * Provides:
 * 1. Exact SDF distance, inward gradient/normal, and dome height-map sampling.
 * 2. Per-tier optical calibration (pill, lens, frosted) so small droplets,
 *    floating control capsules, and large readable sheets refract distinctly.
 * 3. Lightweight fallback SVG displacement & specular PNG textures when WebGL
 *    is unavailable.
 */

export type OpticalGlassTier = 'pill' | 'lens' | 'frosted';

export interface OpticalTierConfig {
  bevelRatio: number;
  maxBevelPx: number;
  minBevelPx: number;
  refractPx: number;
  magnify: number;
  blurCenterPx: number;
  blurEdgePx: number;
  chromaticPx: number;
  frostedMix: number;
  animateSweep: boolean;
  sweepSpeedRadPerSec: number;
}

export interface OpticalGlassMaps {
  key: string;
  width: number;
  height: number;
  dispMapUrl: string;
  rimSpecularUrl: string;
}

export interface GlassSurfaceSample {
  /** Inward distance from outer rounded perimeter in px (0 at edge) */
  inwardDist: number;
  /** Normalized bevel progress: 0 on flat center plateau, 1 at outer rim */
  t: number;
  /** Smoothly eased curvature progress along bevel */
  tCurve: number;
  /** Dome height (0 at outer edge, 1 on flat plateau) */
  height: number;
  /** Outward surface normal X/Y and Z elevation */
  nx: number;
  ny: number;
  nz: number;
}

const MAX_MAP_CACHE = 24;
const opticalMapCache = new Map<string, OpticalGlassMaps>();

export function getOpticalTierConfig(
  tier: OpticalGlassTier,
  width = 360,
  height = 56
): OpticalTierConfig {
  const minSide = Math.max(24, Math.min(width, height));

  switch (tier) {
    case 'lens': {
      // Compact convex crystal droplet (tiny floating controls & status pills)
      const scaleFactor = Math.max(0.85, Math.min(1.25, minSide / 44));
      return {
        bevelRatio: 0.48,
        maxBevelPx: 24,
        minBevelPx: 14,
        refractPx: 12 * scaleFactor,
        magnify: 0.36,
        blurCenterPx: 0.0,
        blurEdgePx: 0.75,
        chromaticPx: 1.15,
        frostedMix: 0.0,
        animateSweep: true,
        sweepSpeedRadPerSec: 0.42,
      };
    }
    case 'pill': {
      // Primary floating navigation capsule (Bottom Dock, Auto-Scroll, Mic Player)
      return {
        bevelRatio: 0.46,
        maxBevelPx: 26,
        minBevelPx: 15,
        refractPx: 13.5,
        magnify: 0.28,
        blurCenterPx: 0.0,
        blurEdgePx: 0.85,
        chromaticPx: 1.2,
        frostedMix: 0.02,
        animateSweep: true,
        sweepSpeedRadPerSec: 0.34,
      };
    }
    case 'frosted': {
      // Large floating sheets (Settings, Bookmarks/Khatmah, Search, Tafsir)
      // Silky frosted readable center (via mip-pyramid soft backdrop) + smooth non-streaking curved edge refraction
      return {
        bevelRatio: 0.16,
        maxBevelPx: 36,
        minBevelPx: 20,
        refractPx: 11.5,
        magnify: 0.075,
        blurCenterPx: 6.0,
        blurEdgePx: 1.8,
        chromaticPx: 0.35,
        frostedMix: 1.0,
        animateSweep: false,
        sweepSpeedRadPerSec: 0,
      };
    }
  }
}

/**
 * Signed distance inside a rounded box centered at (0,0) with half-extents (hx, hy)
 * and corner radius r. Returns positive distance inward from the outer boundary (0 at rim)
 * and the outward boundary normal (nx, ny).
 */
export function roundedBoxInwardDistance(
  px: number,
  py: number,
  hx: number,
  hy: number,
  r: number
): {dist: number; nx: number; ny: number} {
  const ax = Math.abs(px);
  const ay = Math.abs(py);
  const ix = Math.max(0, hx - r);
  const iy = Math.max(0, hy - r);

  const qx = ax - ix;
  const qy = ay - iy;

  if (qx > 0 && qy > 0) {
    const len = Math.hypot(qx, qy);
    const dist = r - len;
    const inv = len > 1e-5 ? 1 / len : 0;
    const nx = (px >= 0 ? 1 : -1) * qx * inv;
    const ny = (py >= 0 ? 1 : -1) * qy * inv;
    return {dist, nx, ny};
  }

  const dx = hx - ax;
  const dy = hy - ay;
  if (dx < dy) {
    return {dist: dx, nx: px >= 0 ? 1 : -1, ny: 0};
  }
  return {dist: dy, nx: 0, ny: py >= 0 ? 1 : -1};
}

/**
 * Evaluates exact Height Map & 3D Surface Normal at a given local point inside
 * a glass surface (center-flat plateau transitioning smoothly into curved edges).
 */
export function computeGlassSurfaceSample(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
  bevelPx: number;
}): GlassSurfaceSample {
  const hx = params.width / 2;
  const hy = params.height / 2;
  const r = Math.min(Math.min(hx, hy), Math.max(1, params.cornerRadius));
  const {dist, nx: bnx, ny: bny} = roundedBoxInwardDistance(
    params.x - hx,
    params.y - hy,
    hx,
    hy,
    r
  );

  const inwardDist = Math.max(0, dist);
  const bevel = Math.max(1, params.bevelPx);
  if (inwardDist >= bevel) {
    return {
      inwardDist,
      t: 0,
      tCurve: 0,
      height: 1,
      nx: 0,
      ny: 0,
      nz: 1,
    };
  }

  const t = Math.max(0, Math.min(1, 1 - inwardDist / bevel));
  const tCurve = t * t * (3 - 2 * t);
  const height = Math.sqrt(Math.max(0, 1 - t * t));
  const slope = Math.pow(tCurve, 0.78) * 0.94;
  const nx = bnx * slope;
  const ny = bny * slope;
  const nz = Math.sqrt(Math.max(0.04, 1 - slope * slope));

  return {inwardDist, t, tCurve, height, nx, ny, nz};
}

// Primary upper-left light half-vector & secondary lower-right counter bounce
const H1_LEN = Math.hypot(-0.48, -0.72, 1.5);
const H1_X = -0.48 / H1_LEN;
const H1_Y = -0.72 / H1_LEN;
const H1_Z = 1.5 / H1_LEN;

const H2_LEN = Math.hypot(0.42, 0.78, 1.45);
const H2_X = 0.42 / H2_LEN;
const H2_Y = 0.78 / H2_LEN;
const H2_Z = 1.45 / H2_LEN;

/**
 * Fallback CPU raster maps used only when WebGL optical compositing is unavailable.
 */
export function getOpticalGlassMaps(params: {
  width: number;
  height: number;
  cornerRadius: number;
  tier: OpticalGlassTier;
}): OpticalGlassMaps {
  const safeW = Math.max(24, Math.round(params.width));
  const safeH = Math.max(24, Math.round(params.height));
  const maxR = Math.min(safeW, safeH) / 2;
  const r = Math.max(4, Math.min(maxR, Math.round(params.cornerRadius)));

  const qW = Math.max(24, Math.round(safeW / 8) * 8);
  const qH = Math.max(24, Math.round(safeH / 8) * 8);
  const qR = Math.min(Math.min(qW, qH) / 2, Math.max(4, Math.round(r / 4) * 4));
  const key = `${params.tier}:${qW}x${qH}:r${qR}`;

  const hit = opticalMapCache.get(key);
  if (hit) {
    opticalMapCache.delete(key);
    opticalMapCache.set(key, hit);
    return hit;
  }

  if (typeof document === 'undefined') {
    return {
      key,
      width: qW,
      height: qH,
      dispMapUrl: '',
      rimSpecularUrl: '',
    };
  }

  const maxDim = 128;
  const scale = Math.min(1, maxDim / Math.max(qW, qH));
  const cw = Math.max(24, Math.round(qW * scale));
  const ch = Math.max(24, Math.round(qH * scale));

  const tierCfg = getOpticalTierConfig(params.tier, qW, qH);
  const bevel = Math.max(
    tierCfg.minBevelPx,
    Math.min(tierCfg.maxBevelPx, Math.min(qW, qH) * tierCfg.bevelRatio)
  );

  const rimCanvas = document.createElement('canvas');
  rimCanvas.width = cw;
  rimCanvas.height = ch;
  const rimCtx = rimCanvas.getContext('2d');
  if (!rimCtx) {
    return {key, width: qW, height: qH, dispMapUrl: '', rimSpecularUrl: ''};
  }
  const rimImg = rimCtx.createImageData(cw, ch);
  const rData = rimImg.data;

  const needDispMap = params.tier !== 'frosted';
  let dispCanvas: HTMLCanvasElement | null = null;
  let dispCtx: CanvasRenderingContext2D | null = null;
  let dispImg: ImageData | null = null;
  let dData: Uint8ClampedArray | null = null;

  if (needDispMap) {
    dispCanvas = document.createElement('canvas');
    dispCanvas.width = cw;
    dispCanvas.height = ch;
    dispCtx = dispCanvas.getContext('2d');
    if (dispCtx) {
      dispImg = dispCtx.createImageData(cw, ch);
      dData = dispImg.data;
    }
  }

  for (let py = 0; py < ch; py++) {
    const worldY = ((py + 0.5) / ch) * qH;
    for (let px = 0; px < cw; px++) {
      const worldX = ((px + 0.5) / cw) * qW;
      const sample = computeGlassSurfaceSample({
        x: worldX,
        y: worldY,
        width: qW,
        height: qH,
        cornerRadius: qR,
        bevelPx: bevel,
      });
      const idx = (py * cw + px) * 4;

      if (sample.t <= 0) {
        if (dData) {
          dData[idx] = 128;
          dData[idx + 1] = 128;
          dData[idx + 2] = 128;
          dData[idx + 3] = 255;
        }
        rData[idx] = 255;
        rData[idx + 1] = 255;
        rData[idx + 2] = 255;
        rData[idx + 3] = 0;
      } else {
        if (dData) {
          const mag = Math.pow(sample.tCurve, 1.75);
          dData[idx] = Math.max(0, Math.min(255, Math.round(128 + 124 * mag * sample.nx)));
          dData[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + 124 * mag * sample.ny)));
          dData[idx + 2] = 128;
          dData[idx + 3] = 255;
        }

        const dot1 = Math.max(0, sample.nx * H1_X + sample.ny * H1_Y + sample.nz * H1_Z);
        const dot2 = Math.max(0, sample.nx * H2_X + sample.ny * H2_Y + sample.nz * H2_Z);
        const specPrimary = Math.pow(dot1, 22) * Math.pow(sample.tCurve, 0.72);
        const specCounter = Math.pow(dot2, 18) * Math.pow(sample.tCurve, 0.85) * 0.44;
        const fresnel = Math.pow(1 - sample.nz, 2.8) * 0.22;
        const specTotal = Math.min(1, specPrimary * 0.85 + specCounter + fresnel);

        rData[idx] = 255;
        rData[idx + 1] = 255;
        rData[idx + 2] = 255;
        rData[idx + 3] = Math.round(255 * specTotal);
      }
    }
  }

  rimCtx.putImageData(rimImg, 0, 0);
  const rimSpecularUrl = rimCanvas.toDataURL('image/png');

  let dispMapUrl = '';
  if (dispCtx && dispImg && dispCanvas) {
    dispCtx.putImageData(dispImg, 0, 0);
    dispMapUrl = dispCanvas.toDataURL('image/png');
  }

  const result: OpticalGlassMaps = {
    key,
    width: qW,
    height: qH,
    dispMapUrl,
    rimSpecularUrl,
  };

  opticalMapCache.set(key, result);
  if (opticalMapCache.size > MAX_MAP_CACHE) {
    const oldest = opticalMapCache.keys().next().value;
    if (oldest) opticalMapCache.delete(oldest);
  }
  return result;
}
