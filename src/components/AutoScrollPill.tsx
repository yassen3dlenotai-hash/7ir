import {Pause, Play, X} from 'lucide-react';
import {useEffect, useRef} from 'react';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {LiquidGlassSurface} from './LiquidGlassSurface';

export type AutoScrollSpeed = 0.5 | 1 | 2 | 3;

export const AUTO_SCROLL_SPEED_OPTIONS: Array<{
  level: AutoScrollSpeed;
  label: string;
  pxPerSec: number;
  ariaLabel: string;
}> = [
  {level: 0.5, label: '0.5×', pxPerSec: 7.5, ariaLabel: 'سرعة التمرير البطيئة 0.5'},
  {level: 1, label: '1×', pxPerSec: 14, ariaLabel: 'سرعة التمرير 1'},
  {level: 2, label: '2×', pxPerSec: 26, ariaLabel: 'سرعة التمرير 2'},
  {level: 3, label: '3×', pxPerSec: 42, ariaLabel: 'سرعة التمرير 3'},
];

export function getAutoScrollPxPerSec(speed: AutoScrollSpeed): number {
  return (
    AUTO_SCROLL_SPEED_OPTIONS.find((opt) => opt.level === speed)?.pxPerSec ?? 14
  );
}

interface Props {
  active: boolean;
  running: boolean;
  speedLevel: AutoScrollSpeed;
  canScrollVertically: boolean;
  bottomOffsetClass?: string;
  performanceProfile: PerformanceProfile;
  onStepVerticalScroll: (deltaPx: number) => boolean; // returns false when reached bottom
  onToggleRunning: () => void;
  onChangeSpeed: (level: AutoScrollSpeed) => void;
  onClose: () => void;
}

export function AutoScrollPill({
  active,
  running,
  speedLevel,
  canScrollVertically,
  bottomOffsetClass = 'bottom-[70px]',
  performanceProfile,
  onStepVerticalScroll,
  onToggleRunning,
  onChangeSpeed,
  onClose,
}: Props) {
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const fracCarryRef = useRef<number>(0);

  // Store mutable refs so changing speed never restarts rAF or resets position
  const speedRef = useRef<AutoScrollSpeed>(speedLevel);
  const stepCallbackRef = useRef(onStepVerticalScroll);
  speedRef.current = speedLevel;
  stepCallbackRef.current = onStepVerticalScroll;

  useEffect(() => {
    if (!active || !running) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
      return;
    }

    const step = (ts: number) => {
      if (lastTsRef.current !== null) {
        const dt = Math.min(0.1, (ts - lastTsRef.current) / 1000);
        const pxPerSec = getAutoScrollPxPerSec(speedRef.current);
        const delta = pxPerSec * dt + fracCarryRef.current;
        const whole = Math.trunc(delta * 100) / 100;
        fracCarryRef.current = delta - whole;
        if (whole > 0) {
          stepCallbackRef.current(whole);
        }
      }
      lastTsRef.current = ts;
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [active, running]);

  if (!active) return null;

  return (
    <div
      style={{color: LIQUID_GLASS.textPrimary}}
      className={`liquid-glass-pill glass-panel-enter fixed ${bottomOffsetClass} left-1/2 -translate-x-1/2 z-40 rounded-full border overflow-hidden transition-all duration-200`}
    >
      <LiquidGlassSurface
        performanceProfile={performanceProfile}
        tier="pill"
        cornerRadius="pill"
      />

      <div className="relative z-10 px-2 py-1.5 flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onToggleRunning}
          aria-label={running ? 'إيقاف التمرير التلقائي' : 'استكمال التمرير التلقائي'}
          style={{
            color: LIQUID_GLASS.textPrimary,
          }}
          className={`liquid-glass-interactive w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${
            running ? 'liquid-glass-pill-active' : 'liquid-glass-nested'
          }`}
        >
          {running ? (
            <Pause className="w-3.5 h-3.5" strokeWidth={2} />
          ) : (
            <Play className="w-3.5 h-3.5" strokeWidth={2} />
          )}
        </button>

        <div
          dir="ltr"
          className="liquid-glass-nested flex items-center gap-0.5 p-0.5 rounded-full border"
          title={!canScrollVertically ? 'الصفحة ظاهرة بالكامل' : undefined}
        >
          {AUTO_SCROLL_SPEED_OPTIONS.map((opt) => {
            const isSelected = speedLevel === opt.level;
            return (
              <button
                key={opt.level}
                type="button"
                onClick={() => onChangeSpeed(opt.level)}
                aria-label={opt.ariaLabel}
                aria-pressed={isSelected}
                style={{
                  color: isSelected ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textMuted,
                }}
                className={`liquid-glass-interactive min-w-[36px] h-7 px-2 rounded-full border text-[11px] font-semibold tabular-nums ${
                  isSelected ? 'liquid-glass-pill-active' : 'border-transparent'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق التمرير التلقائي"
          style={{color: LIQUID_GLASS.textMuted}}
          className="liquid-glass-interactive w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.85} />
        </button>
      </div>
    </div>
  );
}
