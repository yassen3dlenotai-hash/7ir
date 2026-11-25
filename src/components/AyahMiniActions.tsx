import {BookmarkPlus, BookOpenText} from 'lucide-react';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {LiquidGlassSurface} from './LiquidGlassSurface';

interface Props {
  xPct: number;
  yPct: number;
  performanceProfile: PerformanceProfile;
  onSaveBookmark: () => void;
  onOpenTafsir: () => void;
}

/**
 * Ultra-compact floating micro-icons beside a long-pressed Ayah.
 * Clear optical crystal droplet refracting the surrounding Mushaf script.
 */
export function AyahMiniActions({
  xPct,
  yPct,
  performanceProfile,
  onSaveBookmark,
  onOpenTafsir,
}: Props) {
  const flipBelow = yPct < 0.14;

  return (
    <div
      dir="rtl"
      data-ayah-menu="true"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        color: LIQUID_GLASS.textPrimary,
        left: `${Math.max(12, Math.min(88, xPct * 100))}%`,
        top: `${yPct * 100}%`,
        transform: flipBelow
          ? 'translate(-50%, 8px)'
          : 'translate(-50%, -100%) translateY(-6px)',
      }}
      className="liquid-glass-lens absolute z-30 rounded-full border p-[3px] inline-flex items-center gap-[3px] overflow-hidden transition-all duration-150"
    >
      <LiquidGlassSurface
        performanceProfile={performanceProfile}
        tier="lens"
        cornerRadius="pill"
      />

      <button
        type="button"
        title="حفظ موضع التقدم"
        aria-label="حفظ موضع التقدم"
        onClick={(e) => {
          e.stopPropagation();
          onSaveBookmark();
        }}
        style={{color: LIQUID_GLASS.textPrimary}}
        className="liquid-glass-interactive relative z-10 w-[28px] h-[28px] rounded-full flex items-center justify-center"
      >
        <BookmarkPlus className="w-[14px] h-[14px]" strokeWidth={1.85} />
      </button>

      <span
        aria-hidden="true"
        className="relative z-10 w-px h-3.5 shrink-0"
        style={{backgroundColor: LIQUID_GLASS.divider}}
      />

      <button
        type="button"
        title="التفسير الميسر"
        aria-label="التفسير الميسر"
        onClick={(e) => {
          e.stopPropagation();
          onOpenTafsir();
        }}
        style={{color: LIQUID_GLASS.textPrimary}}
        className="liquid-glass-interactive relative z-10 w-[28px] h-[28px] rounded-full flex items-center justify-center"
      >
        <BookOpenText className="w-[14px] h-[14px]" strokeWidth={1.85} />
      </button>
    </div>
  );
}
