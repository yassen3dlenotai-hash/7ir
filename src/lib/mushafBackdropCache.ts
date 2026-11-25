import {applyViewBoxToSvg, parseViewBox} from './polygonUtils';
import type {MushafPagePayload, MushafThemeConfig} from '../types/mushaf';

export interface MushafSnapshot {
  key: string;
  dataUrl: string;
  aspectRatio: number;
}

const MAX_SNAPSHOT_ENTRIES = 12;
const snapshotCache = new Map<string, MushafSnapshot>();
const pendingRenders = new Map<string, Promise<MushafSnapshot | null>>();

function getSnapshotKey(page: number, themeId: string): string {
  return `${page}:${themeId}`;
}

function revokeSnapshotUrl(snap: MushafSnapshot | undefined): void {
  if (snap && snap.dataUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(snap.dataUrl);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function injectThemeStylesIntoSvg(
  rawSvg: string,
  page: number,
  payload: MushafPagePayload,
  theme: MushafThemeConfig
): {svgMarkup: string; width: number; height: number; aspectRatio: number} {
  const framed = applyViewBoxToSvg(rawSvg, page, payload.ayahs);
  const vb = parseViewBox(framed, page, payload.ayahs);
  const aspectRatio = vb.width > 0 && vb.height > 0 ? vb.width / vb.height : 345 / 550;

  // 512px backdrop raster preserves crisp Arabic calligraphy under CC Lens edge magnification
  const targetW = 512;
  const targetH = Math.round(targetW / aspectRatio);

  const styleBlock = `<style><![CDATA[
    path:not(.ayahPolygon) { fill: ${theme.ink} !important; }
    .ayah_markers .ayah-mark-ornament,
    .ayah_markers .ayah-mark-ornament path,
    .ayah-mark-ornament,
    .ayah-mark-ornament path { fill: ${theme.ornament} !important; }
    .ayahPolygon { fill: transparent !important; fill-opacity: 0 !important; stroke: none !important; }
  ]]></style>`;

  let svgWithSize = framed;
  if (/\bwidth="[^"]*"/.test(svgWithSize)) {
    svgWithSize = svgWithSize.replace(/\bwidth="[^"]*"/, `width="${targetW}"`);
  } else {
    svgWithSize = svgWithSize.replace(/<svg\b/, `<svg width="${targetW}"`);
  }
  if (/\bheight="[^"]*"/.test(svgWithSize)) {
    svgWithSize = svgWithSize.replace(/\bheight="[^"]*"/, `height="${targetH}"`);
  } else {
    svgWithSize = svgWithSize.replace(/<svg\b/, `<svg height="${targetH}"`);
  }

  if (!/xmlns=/.test(svgWithSize)) {
    svgWithSize = svgWithSize.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  svgWithSize = svgWithSize.replace(/(<svg\b[^>]*>)/, `$1${styleBlock}`);

  return {
    svgMarkup: svgWithSize,
    width: targetW,
    height: targetH,
    aspectRatio,
  };
}

export function getCachedMushafSnapshot(page: number, themeId: string): MushafSnapshot | null {
  const key = getSnapshotKey(page, themeId);
  const hit = snapshotCache.get(key) ?? null;
  if (hit) {
    snapshotCache.delete(key);
    snapshotCache.set(key, hit);
  }
  return hit;
}

export function renderMushafSnapshot(
  payload: MushafPagePayload,
  theme: MushafThemeConfig
): Promise<MushafSnapshot | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(null);
  }

  const key = getSnapshotKey(payload.page, theme.id);
  const cached = getCachedMushafSnapshot(payload.page, theme.id);
  if (cached) return Promise.resolve(cached);

  const existingPromise = pendingRenders.get(key);
  if (existingPromise) return existingPromise;

  const task = new Promise<MushafSnapshot | null>((resolve) => {
    try {
      const {svgMarkup, width, height, aspectRatio} = injectThemeStylesIntoSvg(
        payload.svg,
        payload.page,
        payload,
        theme
      );

      const svgBlob = new Blob([svgMarkup], {type: 'image/svg+xml;charset=utf-8'});
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.decoding = 'async';

      const storeAndResolve = (url: string) => {
        const snap: MushafSnapshot = {key, dataUrl: url, aspectRatio};
        snapshotCache.set(key, snap);
        if (snapshotCache.size > MAX_SNAPSHOT_ENTRIES) {
          const oldestKey = snapshotCache.keys().next().value;
          if (oldestKey) {
            const oldestSnap = snapshotCache.get(oldestKey);
            snapshotCache.delete(oldestKey);
            revokeSnapshotUrl(oldestSnap);
          }
        }
        resolve(snap);
      };

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(svgUrl);
            resolve(null);
            return;
          }
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(svgUrl);

          if (typeof canvas.toBlob === 'function') {
            canvas.toBlob((pngBlob) => {
              if (pngBlob) {
                storeAndResolve(URL.createObjectURL(pngBlob));
              } else {
                try {
                  storeAndResolve(canvas.toDataURL('image/png'));
                } catch {
                  resolve(null);
                }
              }
            }, 'image/png');
          } else {
            storeAndResolve(canvas.toDataURL('image/png'));
          }
        } catch {
          URL.revokeObjectURL(svgUrl);
          resolve(null);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        resolve(null);
      };

      img.src = svgUrl;
    } catch {
      resolve(null);
    }
  }).finally(() => {
    pendingRenders.delete(key);
  });

  pendingRenders.set(key, task);
  return task;
}
