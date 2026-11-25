import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useMushafBackdrop,
  type BackdropOffset,
} from '../contexts/MushafBackdropContext';
import {
  getOpticalGlassMaps,
  getOpticalTierConfig,
  type OpticalGlassTier,
} from '../lib/opticalGlassMaps';
import {sharedOpticalCompositor} from '../lib/opticalWebGLCompositor';
import type {PerformanceProfile} from '../lib/performanceProfile';

interface Props {
  performanceProfile?: PerformanceProfile;
  tier?: OpticalGlassTier;
  cornerRadius?: number | 'pill';
  /** Pauses animated Light Sweep & compositing when surface is visually hidden */
  active?: boolean;
  /** Optional surface tint override for readable frosted sheets */
  frostedTint?: boolean;
}

interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function LiquidGlassSurface({
  performanceProfile,
  tier = 'lens',
  cornerRadius = 'pill',
  active = true,
  frostedTint,
}: Props) {
  const backdrop = useMushafBackdrop();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneGroupRef = useRef<SVGGElement | null>(null);
  const rawId = useId();
  const safeId = rawId.replace(/:/g, '_');

  const [box, setBox] = useState<BoxRect>({left: 0, top: 0, width: 0, height: 0});
  const boxRef = useRef<BoxRect>(box);
  boxRef.current = box;

  const isEnabled = performanceProfile === 'performance' && Boolean(backdrop?.enabled);
  const effectiveTier: OpticalGlassTier = frostedTint ? 'frosted' : tier;
  const isFrostedSheet = effectiveTier === 'frosted';
  const webglSupported = useMemo(
    () => (isEnabled ? sharedOpticalCompositor.isSupported() : false),
    [isEnabled]
  );

  const measureBoxNow = useCallback((): BoxRect | null => {
    const el = hostRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const w = Math.max(0, Math.round(rect.width));
    const h = Math.max(0, Math.round(rect.height));
    const left = Math.round(rect.left * 10) / 10;
    const top = Math.round(rect.top * 10) / 10;
    return {left, top, width: w, height: h};
  }, []);

  const measureBox = useCallback(() => {
    const measured = measureBoxNow();
    if (!measured) return;

    setBox((prev) => {
      if (
        prev.width === measured.width &&
        prev.height === measured.height &&
        Math.abs(prev.left - measured.left) < 0.5 &&
        Math.abs(prev.top - measured.top) < 0.5
      ) {
        return prev;
      }
      return measured;
    });
  }, [measureBoxNow]);

  useLayoutEffect(() => {
    if (!isEnabled) return;
    measureBox();

    const el = hostRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => measureBox());
    ro.observe(el);

    const parent = el.parentElement;
    const onSettled = () => measureBox();
    parent?.addEventListener('transitionend', onSettled);
    parent?.addEventListener('animationend', onSettled);
    window.addEventListener('resize', measureBox);

    return () => {
      ro.disconnect();
      parent?.removeEventListener('transitionend', onSettled);
      parent?.removeEventListener('animationend', onSettled);
      window.removeEventListener('resize', measureBox);
    };
  }, [isEnabled, measureBox, active]);

  const effectiveRadius = useMemo(() => {
    if (box.width <= 0 || box.height <= 0) return 24;
    if (cornerRadius === 'pill') {
      return Math.min(box.width, box.height) / 2;
    }
    return Math.min(cornerRadius, Math.min(box.width, box.height) / 2);
  }, [box.width, box.height, cornerRadius]);

  // Keep latest render parameters in refs so VSync & Light Sweep updates trigger 0 React re-renders
  const isDark = backdrop?.theme.isDark ?? true;
  const sweepPhaseRef = useRef<number>(0.45);
  const renderParamsRef = useRef({
    effectiveTier,
    effectiveRadius,
    isDark,
    active,
  });
  renderParamsRef.current = {
    effectiveTier,
    effectiveRadius,
    isDark,
    active,
  };

  const compositeSurfaceNow = useCallback(
    (syncRect = false) => {
      if (!isEnabled || !webglSupported || !backdrop) return;
      const targetCanvas = canvasRef.current;
      if (!targetCanvas) return;

      const currentBox = syncRect ? measureBoxNow() ?? boxRef.current : boxRef.current;
      if (currentBox.width < 12 || currentBox.height < 12) return;
      boxRef.current = currentBox;

      backdrop.syncCompositorScene();
      const dpr =
        typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;

      sharedOpticalCompositor.renderSurfaceToCanvas({
        targetCanvas,
        dpr,
        box: currentBox,
        cornerRadius: renderParamsRef.current.effectiveRadius,
        tier: renderParamsRef.current.effectiveTier,
        isDark: renderParamsRef.current.isDark,
        sweepPhase: sweepPhaseRef.current,
      });
    },
    [isEnabled, webglSupported, backdrop, measureBoxNow]
  );

  // Re-composite immediately whenever geometry, theme, or active visibility changes
  useLayoutEffect(() => {
    if (!isEnabled || !webglSupported || !active) return;
    compositeSurfaceNow(true);
  }, [
    isEnabled,
    webglSupported,
    active,
    box.left,
    box.top,
    box.width,
    box.height,
    effectiveRadius,
    effectiveTier,
    isDark,
    compositeSurfaceNow,
  ]);

  // Synchronize live optical refraction whenever Mushaf scrolls, pans, zooms, or decodes
  useEffect(() => {
    if (!isEnabled || !webglSupported || !backdrop || !active) return;
    return backdrop.subscribeOffset(() => {
      compositeSurfaceNow(false);
    });
  }, [isEnabled, webglSupported, backdrop, active, compositeSurfaceNow]);

  // Brief ~240ms transition/enter-animation tracker + gentle capped CC Light Sweep for compact pills/lenses
  useEffect(() => {
    if (!isEnabled || !webglSupported || !active) return;

    const cfg = getOpticalTierConfig(effectiveTier, box.width, box.height);
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const shouldAnimateSweep = cfg.animateSweep && !reducedMotion;

    const mountStart = performance.now();
    let rafId: number | null = null;
    let lastRenderTs = mountStart;

    const tick = (now: number) => {
      const withinEnterAnimation = now - mountStart < 250;
      const isVisibleDoc =
        typeof document === 'undefined' || document.visibilityState === 'visible';

      if (withinEnterAnimation) {
        compositeSurfaceNow(true);
        lastRenderTs = now;
      } else if (shouldAnimateSweep && isVisibleDoc) {
        const dtMs = now - lastRenderTs;
        // Cap gentle Light Sweep update to ~24 FPS (only updates u_sweepPhase, 0 backdrop redraws)
        if (dtMs >= 42) {
          sweepPhaseRef.current =
            (sweepPhaseRef.current + (dtMs / 1000) * cfg.sweepSpeedRadPerSec) %
            (Math.PI * 2);
          lastRenderTs = now;
          compositeSurfaceNow(false);
        }
      }

      if (withinEnterAnimation || shouldAnimateSweep) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    isEnabled,
    webglSupported,
    active,
    effectiveTier,
    box.width,
    box.height,
    compositeSurfaceNow,
  ]);

  // Fallback SVG offset sync ONLY when WebGL is unavailable
  useLayoutEffect(() => {
    if (!isEnabled || webglSupported || isFrostedSheet || !backdrop) return;

    const applyTransform = (offset: BackdropOffset) => {
      const g = sceneGroupRef.current;
      if (!g) return;
      const dx = offset.x - boxRef.current.left;
      const dy = offset.y - boxRef.current.top;
      g.setAttribute('transform', `translate(${dx.toFixed(1)}, ${dy.toFixed(1)})`);
    };

    applyTransform(backdrop.getOffset());
    return backdrop.subscribeOffset(applyTransform);
  }, [isEnabled, webglSupported, isFrostedSheet, backdrop, box.left, box.top, box.width, box.height]);

  const fallbackMaps = useMemo(() => {
    if (!isEnabled || webglSupported || box.width < 12 || box.height < 12) return null;
    return getOpticalGlassMaps({
      width: box.width,
      height: box.height,
      cornerRadius: effectiveRadius,
      tier: effectiveTier,
    });
  }, [isEnabled, webglSupported, box.width, box.height, effectiveRadius, effectiveTier]);

  if (!isEnabled || !backdrop) {
    return null;
  }

  // Primary Path: Full 9-stage WebGL Optical Compositing (Track-Matted inside borderRadius)
  if (webglSupported) {
    return (
      <div
        ref={hostRef}
        aria-hidden="true"
        style={{
          borderRadius: 'inherit',
          willChange: 'transform',
          transform: 'translateZ(0)',
        }}
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          style={{borderRadius: 'inherit'}}
          className="absolute inset-0 w-full h-full block"
        />
      </div>
    );
  }

  // Graceful Fallback Path when WebGL is unavailable (e.g., restricted environments)
  const {theme, viewport, slots, snapshots} = backdrop;
  const w = box.width;
  const h = box.height;
  const apron = 20;
  const filterId = `lg_opt_${safeId}`;
  const clipId = `lg_clip_${safeId}`;
  const bgGradId = `lg_bg_${safeId}`;
  const dispScale = effectiveTier === 'pill' ? 22 : 20;

  const surfaceWash = isFrostedSheet
    ? isDark
      ? 'rgba(20, 19, 17, 0.56)'
      : 'rgba(253, 250, 243, 0.52)'
    : isDark
    ? 'rgba(24, 23, 20, 0.12)'
    : 'rgba(255, 255, 255, 0.06)';

  const initialOffset = backdrop.getOffset();
  const initDx = initialOffset.x - box.left;
  const initDy = initialOffset.y - box.top;

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{
        borderRadius: 'inherit',
        willChange: 'transform',
        transform: 'translateZ(0)',
      }}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {isFrostedSheet ? (
        <div
          style={{
            borderRadius: 'inherit',
            backgroundColor: surfaceWash,
            backdropFilter: 'blur(4px) saturate(120%)',
            WebkitBackdropFilter: 'blur(4px) saturate(120%)',
          }}
          className="absolute inset-0"
        />
      ) : (
        <>
          {w > 0 && h > 0 && fallbackMaps && fallbackMaps.dispMapUrl && (
            <svg
              width={w}
              height={h}
              viewBox={`0 0 ${w} ${h}`}
              className="absolute inset-0 block w-full h-full"
              style={{overflow: 'hidden'}}
            >
              <defs>
                <clipPath id={clipId}>
                  <rect
                    x={0}
                    y={0}
                    width={w}
                    height={h}
                    rx={effectiveRadius}
                    ry={effectiveRadius}
                  />
                </clipPath>

                {isDark ? (
                  <radialGradient id={bgGradId} cx="50%" cy="42%" r="65%">
                    <stop offset="0%" stopColor="#1D1C19" />
                    <stop offset="58%" stopColor="#141412" />
                    <stop offset="100%" stopColor="#0E0E0C" />
                  </radialGradient>
                ) : (
                  <linearGradient id={bgGradId} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#FDF9EE" />
                    <stop offset="100%" stopColor="#F8F1DF" />
                  </linearGradient>
                )}

                <filter
                  id={filterId}
                  filterUnits="userSpaceOnUse"
                  x={-apron}
                  y={-apron}
                  width={w + apron * 2}
                  height={h + apron * 2}
                  colorInterpolationFilters="sRGB"
                >
                  <feImage
                    href={fallbackMaps.dispMapUrl}
                    x={0}
                    y={0}
                    width={w}
                    height={h}
                    preserveAspectRatio="none"
                    result="dispMap"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="dispMap"
                    scale={dispScale}
                    xChannelSelector="R"
                    yChannelSelector="G"
                  />
                </filter>
              </defs>

              <g clipPath={`url(#${clipId})`}>
                <g filter={`url(#${filterId})`}>
                  <rect
                    x={-box.left - apron}
                    y={-box.top - apron}
                    width={Math.max(viewport.width, w) + apron * 2}
                    height={Math.max(viewport.height, h) + apron * 2}
                    fill={`url(#${bgGradId})`}
                  />
                  <g
                    ref={sceneGroupRef}
                    transform={`translate(${initDx.toFixed(1)}, ${initDy.toFixed(1)})`}
                  >
                    {slots.map((slot) => {
                      const snapUrl = snapshots[`${slot.page}:${theme.id}`];
                      if (!snapUrl) return null;
                      return (
                        <image
                          key={slot.key}
                          href={snapUrl}
                          x={slot.x}
                          y={slot.y}
                          width={slot.width}
                          height={slot.height}
                          preserveAspectRatio="xMidYMid meet"
                        />
                      );
                    })}
                  </g>
                </g>
              </g>
            </svg>
          )}
          <div
            style={{
              borderRadius: 'inherit',
              backgroundColor: surfaceWash,
            }}
            className="absolute inset-0"
          />
        </>
      )}

      {fallbackMaps && fallbackMaps.rimSpecularUrl && (
        <img
          src={fallbackMaps.rimSpecularUrl}
          alt=""
          draggable={false}
          style={{
            borderRadius: 'inherit',
            opacity: isDark ? (isFrostedSheet ? 0.34 : 0.48) : isFrostedSheet ? 0.56 : 0.78,
          }}
          className="absolute inset-0 w-full h-full object-fill select-none"
        />
      )}
    </div>
  );
}
