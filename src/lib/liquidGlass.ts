import type React from 'react';

/**
 * Neutral optical Liquid Glass design tokens powered by CSS custom properties.
 * Colorless transparent crystal material that inherits hue & luminance directly
 * from the synchronized Mushaf page behind it.
 */
export const LIQUID_GLASS = {
  // Surfaces & Structural Hairlines
  surfaceInner: 'var(--lg-nested-bg)',
  inputBg: 'var(--lg-input-bg)',
  scrimBg: 'var(--lg-scrim-bg)',
  trackBg: 'var(--lg-track-bg)',
  divider: 'var(--lg-divider)',

  // Monochrome Accents
  accent: 'var(--lg-accent)',
  accentBg: 'var(--lg-accent-bg)',
  accentBorder: 'var(--lg-accent-border)',
  borderHairline: 'var(--lg-nested-border)',

  // Typography
  textPrimary: 'var(--lg-text-primary)',
  textSecondary: 'var(--lg-text-secondary)',
  textMuted: 'var(--lg-text-muted)',
} as const;

export type LiquidGlassTier = 'lens' | 'pill' | 'frosted' | 'nested';

export function liquidGlassTierClass(tier: LiquidGlassTier = 'lens'): string {
  switch (tier) {
    case 'lens':
      return 'liquid-glass-lens';
    case 'pill':
      return 'liquid-glass-pill';
    case 'frosted':
      return 'liquid-glass-frosted';
    case 'nested':
      return 'liquid-glass-nested';
  }
}

export function liquidGlassSurfaceStyle(): React.CSSProperties {
  return {
    color: LIQUID_GLASS.textPrimary,
  };
}
