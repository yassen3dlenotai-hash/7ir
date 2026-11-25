import {Feather, Zap} from 'lucide-react';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {LiquidGlassSurface} from './LiquidGlassSurface';

interface Props {
  open: boolean;
  performanceProfile?: PerformanceProfile;
  onSelect: (profile: PerformanceProfile) => void;
}

export function PerformanceSetupModal({
  open,
  performanceProfile = 'performance',
  onSelect,
}: Props) {
  if (!open) return null;

  return (
    <div
      style={{backgroundColor: LIQUID_GLASS.scrimBg}}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        style={{color: LIQUID_GLASS.textPrimary}}
        className="liquid-glass-frosted glass-panel-enter relative w-full max-w-lg p-6 sm:p-8 rounded-[28px] border overflow-hidden"
      >
        <LiquidGlassSurface
          performanceProfile={performanceProfile}
          tier="frosted"
          cornerRadius={28}
        />

        <div className="relative z-10">
          <div className="text-center mb-6">
            <h2
              className="text-xl sm:text-2xl font-bold mb-2"
              style={{
                fontFamily: "'Amiri Quran', serif",
                color: LIQUID_GLASS.textPrimary,
              }}
            >
              اختر مستوى أداء الجهاز
            </h2>
            <p className="text-sm" style={{color: LIQUID_GLASS.textMuted}}>
              حدد الوضع المناسب لموارد جهازك لضمان تجربة تلاوة وقراءة سلسة ومستقرة.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-6">
            {/* Light Mode */}
            <button
              type="button"
              onClick={() => onSelect('light')}
              className="liquid-glass-nested liquid-glass-interactive flex flex-col items-start p-5 rounded-[22px] border text-right group"
            >
              <div
                className="liquid-glass-pill-active p-3 rounded-2xl border mb-3 transition-transform group-hover:scale-105"
                style={{color: LIQUID_GLASS.textPrimary}}
              >
                <Feather className="w-5 h-5" strokeWidth={1.85} />
              </div>
              <h3 className="text-sm sm:text-base font-bold mb-1" style={{color: LIQUID_GLASS.textPrimary}}>
                جهاز ضعيف (Light Mode)
              </h3>
              <p className="text-xs leading-relaxed" style={{color: LIQUID_GLASS.textMuted}}>
                مخصص للهواتف والأجهزة المحدودة. يقلل استهلاك الذاكرة، ويفعل انتقالات فورية خفيفة دون مؤثرات ثقيلة.
              </p>
            </button>

            {/* Performance Mode */}
            <button
              type="button"
              onClick={() => onSelect('performance')}
              className="liquid-glass-nested liquid-glass-interactive flex flex-col items-start p-5 rounded-[22px] border text-right group"
            >
              <div
                className="liquid-glass-pill-active p-3 rounded-2xl border mb-3 transition-transform group-hover:scale-105"
                style={{color: LIQUID_GLASS.textPrimary}}
              >
                <Zap className="w-5 h-5" strokeWidth={1.85} />
              </div>
              <h3 className="text-sm sm:text-base font-bold mb-1" style={{color: LIQUID_GLASS.textPrimary}}>
                جهاز قوي (Performance Mode)
              </h3>
              <p className="text-xs leading-relaxed" style={{color: LIQUID_GLASS.textMuted}}>
                التجربة البصرية الكاملة بتصميم الزجاج السائل الشفاف، تقليب الصفحات ثلاثي الأبعاد، والتحميل المسبق الذكي.
              </p>
            </button>
          </div>

          <div className="text-center text-xs" style={{color: LIQUID_GLASS.textMuted}}>
            يمكنك تغيير هذا الإعداد لاحقاً في أي وقت من قائمة الإعدادات.
          </div>
        </div>
      </div>
    </div>
  );
}
