import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getCachedMushafSnapshot,
  renderMushafSnapshot,
} from '../lib/mushafBackdropCache';
import {sharedOpticalCompositor} from '../lib/opticalWebGLCompositor';
import type {PerformanceProfile} from '../lib/performanceProfile';
import type {MushafPagePayload, MushafThemeConfig} from '../types/mushaf';

export interface BackdropWorldSlot {
  key: string;
  page: number;
  payload: MushafPagePayload;
  /** World-space coordinates (before applying liveOffset) */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LiveBackdropScene {
  theme: MushafThemeConfig;
  viewport: {width: number; height: number};
  slots: BackdropWorldSlot[];
}

export interface BackdropOffset {
  x: number;
  y: number;
}

interface MushafBackdropContextValue {
  enabled: boolean;
  theme: MushafThemeConfig;
  viewport: {width: number; height: number};
  slots: BackdropWorldSlot[];
  snapshots: Record<string, string>;
  getOffset: () => BackdropOffset;
  subscribeOffset: (listener: (offset: BackdropOffset) => void) => () => void;
  setScene: (scene: LiveBackdropScene) => void;
  setLiveOffset: (offset: BackdropOffset) => void;
  /** Syncs the shared WebGL backdrop texture only if scene/snapshots/offset changed */
  syncCompositorScene: () => void;
}

const MushafBackdropContext = createContext<MushafBackdropContextValue | null>(null);

export function MushafBackdropProvider({
  theme,
  performanceProfile,
  children,
}: {
  theme: MushafThemeConfig;
  performanceProfile: PerformanceProfile;
  children: ReactNode;
}) {
  const enabled = performanceProfile === 'performance';
  const [scene, setSceneState] = useState<LiveBackdropScene>(() => ({
    theme,
    viewport: {
      width: typeof window !== 'undefined' ? window.innerWidth : 390,
      height: typeof window !== 'undefined' ? window.innerHeight : 844,
    },
    slots: [],
  }));
  const [snapshots, setSnapshots] = useState<Record<string, string>>({});

  const offsetRef = useRef<BackdropOffset>({x: 0, y: 0});
  const lastEmittedRef = useRef<BackdropOffset>({x: 0, y: 0});
  const rafIdRef = useRef<number | null>(null);
  const listenersRef = useRef<Set<(offset: BackdropOffset) => void>>(new Set());

  const sceneRef = useRef(scene);
  const snapshotsRef = useRef(snapshots);
  const enabledRef = useRef(enabled);
  sceneRef.current = scene;
  snapshotsRef.current = snapshots;
  enabledRef.current = enabled;

  // Keep scene theme synchronized immediately even if no stage has published slots yet
  useEffect(() => {
    setSceneState((prev) =>
      prev.theme.id === theme.id ? prev : {...prev, theme}
    );
  }, [theme]);

  const emitListeners = useCallback((offset: BackdropOffset) => {
    listenersRef.current.forEach((fn) => fn(offset));
  }, []);

  const syncCompositorScene = useCallback(() => {
    if (!enabledRef.current) return;
    const curScene = sceneRef.current;
    sharedOpticalCompositor.syncSceneTexture({
      viewport: curScene.viewport,
      theme: curScene.theme,
      slots: curScene.slots,
      snapshots: snapshotsRef.current,
      offset: offsetRef.current,
      onAsyncImageReady: () => {
        // Re-sync texture once async PNG blob decodes and notify active glass surfaces
        sharedOpticalCompositor.syncSceneTexture({
          viewport: sceneRef.current.viewport,
          theme: sceneRef.current.theme,
          slots: sceneRef.current.slots,
          snapshots: snapshotsRef.current,
          offset: offsetRef.current,
          onAsyncImageReady: () => {},
        });
        emitListeners(offsetRef.current);
      },
    });
  }, [emitListeners]);

  const subscribeOffset = useCallback((listener: (offset: BackdropOffset) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getOffset = useCallback(() => offsetRef.current, []);

  // Coalesce high-frequency scroll/drag updates cleanly to 1 VSync rAF flush per frame
  const setLiveOffset = useCallback(
    (offset: BackdropOffset) => {
      const prev = offsetRef.current;
      if (Math.abs(prev.x - offset.x) < 0.75 && Math.abs(prev.y - offset.y) < 0.75) {
        return;
      }
      offsetRef.current = offset;
      if (rafIdRef.current !== null) return;

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const latest = offsetRef.current;
        const last = lastEmittedRef.current;
        if (Math.abs(latest.x - last.x) < 0.75 && Math.abs(latest.y - last.y) < 0.75) {
          return;
        }
        lastEmittedRef.current = latest;
        syncCompositorScene();
        emitListeners(latest);
      });
    },
    [syncCompositorScene, emitListeners]
  );

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  const setScene = useCallback((nextScene: LiveBackdropScene) => {
    setSceneState((prev) => {
      if (
        prev.theme.id === nextScene.theme.id &&
        Math.abs(prev.viewport.width - nextScene.viewport.width) < 1 &&
        Math.abs(prev.viewport.height - nextScene.viewport.height) < 1 &&
        prev.slots.length === nextScene.slots.length &&
        prev.slots.every((s, idx) => {
          const n = nextScene.slots[idx];
          return (
            s.key === n.key &&
            s.page === n.page &&
            Math.abs(s.x - n.x) < 0.25 &&
            Math.abs(s.y - n.y) < 0.25 &&
            Math.abs(s.width - n.width) < 0.25 &&
            Math.abs(s.height - n.height) < 0.25
          );
        })
      ) {
        return prev;
      }
      return nextScene;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    for (const slot of scene.slots) {
      const cacheKey = `${slot.page}:${scene.theme.id}`;
      const memHit = getCachedMushafSnapshot(slot.page, scene.theme.id);
      if (memHit) {
        setSnapshots((prev) =>
          prev[cacheKey] === memHit.dataUrl ? prev : {...prev, [cacheKey]: memHit.dataUrl}
        );
        continue;
      }

      void renderMushafSnapshot(slot.payload, scene.theme).then((snap) => {
        if (!active || !snap) return;
        setSnapshots((prev) =>
          prev[snap.key] === snap.dataUrl ? prev : {...prev, [snap.key]: snap.dataUrl}
        );
      });
    }

    return () => {
      active = false;
    };
  }, [enabled, scene]);

  // Sync shared WebGL scene texture & notify surfaces whenever scene or decoded snapshots update
  useEffect(() => {
    if (!enabled) return;
    syncCompositorScene();
    emitListeners(offsetRef.current);
  }, [enabled, scene, snapshots, syncCompositorScene, emitListeners]);

  return (
    <MushafBackdropContext.Provider
      value={{
        enabled,
        theme: scene.theme ?? theme,
        viewport: scene.viewport,
        slots: scene.slots,
        snapshots,
        getOffset,
        subscribeOffset,
        setScene,
        setLiveOffset,
        syncCompositorScene,
      }}
    >
      {children}
    </MushafBackdropContext.Provider>
  );
}

export function useMushafBackdrop() {
  return useContext(MushafBackdropContext);
}
