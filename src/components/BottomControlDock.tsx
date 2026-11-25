import {
  ArrowDownToLine,
  Bookmark,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {toArabicIndic} from '../types/mushaf';
import {LiquidGlassSurface} from './LiquidGlassSurface';

export type DockAction = 'bookmarks' | 'autoscroll' | 'search' | 'settings';

interface Props {
  visible: boolean;
  bookmarksOpen: boolean;
  bookmarkCount: number;
  khatmahPending?: boolean;
  autoScrollActive: boolean;
  searchOpen: boolean;
  settingsOpen: boolean;
  performanceProfile: PerformanceProfile;
  onSelectAction: (action: DockAction) => void;
}

const DOCK_ITEMS: Array<{
  id: DockAction;
  label: string;
  icon: typeof Bookmark;
}> = [
  {id: 'bookmarks', label: 'المواضع', icon: Bookmark},
  {id: 'autoscroll', label: 'التمرير', icon: ArrowDownToLine},
  {id: 'search', label: 'البحث', icon: Search},
  {id: 'settings', label: 'الإعدادات', icon: SlidersHorizontal},
];

export function BottomControlDock({
  visible,
  bookmarksOpen,
  bookmarkCount,
  khatmahPending = false,
  autoScrollActive,
  searchOpen,
  settingsOpen,
  performanceProfile,
  onSelectAction,
}: Props) {
  const isItemActive = (id: DockAction): boolean => {
    switch (id) {
      case 'bookmarks':
        return bookmarksOpen;
      case 'autoscroll':
        return autoScrollActive;
      case 'search':
        return searchOpen;
      case 'settings':
        return settingsOpen;
    }
  };

  return (
    <nav
      aria-label="لوحة التحكم السفلية"
      style={{color: LIQUID_GLASS.textPrimary}}
      className={`liquid-glass-pill fixed bottom-2.5 sm:bottom-3.5 left-1/2 -translate-x-1/2 z-40 w-[calc(100vw-28px)] max-w-[360px] sm:w-auto sm:min-w-[392px] sm:max-w-[436px] rounded-full border overflow-hidden transition-all duration-200 ease-out ${
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      <LiquidGlassSurface
        performanceProfile={performanceProfile}
        tier="pill"
        cornerRadius="pill"
        active={visible}
      />

      <div className="relative z-10 grid grid-cols-4 items-center gap-0.5 p-1">
        {DOCK_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item.id);

          return (
            <button
              key={item.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectAction(item.id);
              }}
              aria-pressed={active}
              style={{
                color: active ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textSecondary,
              }}
              className={`liquid-glass-interactive relative min-h-[44px] px-2 py-1 rounded-full flex flex-col items-center justify-center gap-[3px] whitespace-nowrap ${
                active
                  ? 'liquid-glass-pill-active border'
                  : 'border border-transparent hover:opacity-100 opacity-88'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={active ? 2.0 : 1.6} />
                {item.id === 'bookmarks' && bookmarkCount > 0 && (
                  <span
                    aria-label={`${bookmarkCount} مواضع محفوظة`}
                    style={{color: active ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textMuted}}
                    className="absolute -top-1 -left-3 text-[9.5px] font-bold leading-none tabular-nums"
                  >
                    {toArabicIndic(bookmarkCount)}
                  </span>
                )}
                {item.id === 'bookmarks' && khatmahPending && (
                  <span
                    aria-label="ورد التختيم اليومي متاح"
                    className="absolute -top-0.5 -right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500"
                  />
                )}
              </div>
              <span
                className="text-[10px] font-semibold leading-none whitespace-nowrap"
                style={{
                  color: active ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textMuted,
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
