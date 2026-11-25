import {useMemo} from 'react';
import {
  formatViewBoxString,
  getAyahGlassRects,
  parseViewBox,
} from '../lib/polygonUtils';
import type {MushafPagePayload, MushafThemeConfig} from '../types/mushaf';

interface Props {
  payload: MushafPagePayload;
  surahNumber: number;
  ayahNumber: number;
  theme: MushafThemeConfig;
}

/**
 * Plain static rounded-corner glass frame over a selected Ayah.
 * Intentionally avoids Liquid Glass refraction, blur, specular sweeps, or yellow color distortion.
 */
export function AyahGlassHighlightOverlay({
  payload,
  surahNumber,
  ayahNumber,
  theme,
}: Props) {
  const geometry = useMemo(() => {
    const target = payload.ayahs.find(
      (a) => a.surahNumber === surahNumber && a.ayahNumber === ayahNumber
    );
    if (!target) return null;

    const rects = getAyahGlassRects(target.polygon);
    if (rects.length === 0) return null;

    const vb = parseViewBox(payload.svg, payload.page, payload.ayahs);
    return {
      viewBox: formatViewBoxString(vb),
      rects,
    };
  }, [payload, surahNumber, ayahNumber]);

  if (!geometry) return null;

  const fill = theme.isDark
    ? 'rgba(255, 255, 255, 0.085)'
    : 'rgba(28, 24, 18, 0.055)';
  const stroke = theme.isDark
    ? 'rgba(255, 255, 255, 0.24)'
    : 'rgba(28, 24, 18, 0.20)';

  return (
    <svg
      aria-hidden="true"
      viewBox={geometry.viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 w-full h-full block"
    >
      {geometry.rects.map((rect, idx) => (
        <rect
          key={idx}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={rect.rx}
          ry={rect.rx}
          fill={fill}
          stroke={stroke}
          strokeWidth={0.7}
        />
      ))}
    </svg>
  );
}
