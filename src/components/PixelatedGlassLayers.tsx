import type {PerformanceProfile} from '../lib/performanceProfile';
import {LiquidGlassSurface} from './LiquidGlassSurface';

interface Props {
  performanceProfile?: PerformanceProfile;
  tier?: 'lens' | 'pill' | 'frosted';
  cornerRadius?: number | 'pill';
}

/**
 * Unified optical Liquid Glass backdrop wrapper.
 * Strictly disabled in Light Mode for lightweight static rendering.
 */
export function LiquidGlassLayers({
  performanceProfile,
  tier = 'lens',
  cornerRadius,
}: Props) {
  const resolvedRadius =
    cornerRadius !== undefined ? cornerRadius : tier === 'frosted' ? 28 : 'pill';

  return (
    <LiquidGlassSurface
      performanceProfile={performanceProfile}
      tier={tier}
      cornerRadius={resolvedRadius}
    />
  );
}

export const PixelatedGlassLayers = LiquidGlassLayers;
