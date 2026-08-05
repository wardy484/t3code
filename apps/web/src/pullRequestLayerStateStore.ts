import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PullRequestRailMode } from "./components/PullRequestLayerRail";
import { resolveStorage } from "./lib/storage";

interface PullRequestLayerThreadState {
  readonly mode: PullRequestRailMode;
  readonly selectedLayerId: string | null;
  readonly viewedLayerIds: ReadonlyArray<string>;
}

interface PullRequestLayerStateStore {
  readonly byThreadKey: Record<string, PullRequestLayerThreadState>;
  readonly setMode: (ref: ScopedThreadRef, mode: PullRequestRailMode) => void;
  readonly selectLayer: (ref: ScopedThreadRef, layerId: string) => void;
  readonly toggleViewed: (ref: ScopedThreadRef, layerId: string) => void;
}

const DEFAULT_STATE: PullRequestLayerThreadState = {
  mode: "layers",
  selectedLayerId: null,
  viewedLayerIds: [],
};

export const usePullRequestLayerStateStore = create<PullRequestLayerStateStore>()(
  persist(
    (set) => ({
      byThreadKey: {},
      setMode: (ref, mode) =>
        set((state) => {
          const key = scopedThreadKey(ref);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [key]: { ...(state.byThreadKey[key] ?? DEFAULT_STATE), mode },
            },
          };
        }),
      selectLayer: (ref, selectedLayerId) =>
        set((state) => {
          const key = scopedThreadKey(ref);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [key]: { ...(state.byThreadKey[key] ?? DEFAULT_STATE), selectedLayerId },
            },
          };
        }),
      toggleViewed: (ref, layerId) =>
        set((state) => {
          const key = scopedThreadKey(ref);
          const current = state.byThreadKey[key] ?? DEFAULT_STATE;
          const viewed = new Set(current.viewedLayerIds);
          if (viewed.has(layerId)) viewed.delete(layerId);
          else viewed.add(layerId);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [key]: { ...current, viewedLayerIds: [...viewed] },
            },
          };
        }),
    }),
    {
      name: "t3code:pull-request-layer-state:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
    },
  ),
);

export function selectPullRequestLayerThreadState(
  byThreadKey: Record<string, PullRequestLayerThreadState>,
  ref: ScopedThreadRef | null,
): PullRequestLayerThreadState {
  return ref ? (byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_STATE) : DEFAULT_STATE;
}
