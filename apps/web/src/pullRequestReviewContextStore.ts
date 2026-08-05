import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PullRequestReviewContext, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";

export interface PullRequestReviewBrief {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repositoryNameWithOwner: string;
  readonly context: PullRequestReviewContext;
}

interface PullRequestReviewContextState {
  readonly byThreadKey: Record<string, PullRequestReviewBrief>;
  readonly set: (threadRef: ScopedThreadRef, brief: PullRequestReviewBrief) => void;
}

export const usePullRequestReviewContextStore = create<PullRequestReviewContextState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      set: (threadRef, brief) =>
        set((state) => ({
          byThreadKey: { ...state.byThreadKey, [scopedThreadKey(threadRef)]: brief },
        })),
    }),
    {
      name: "t3code:pull-request-review-context:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThreadKey: state.byThreadKey }),
    },
  ),
);

export function selectPullRequestReviewBrief(
  byThreadKey: Record<string, PullRequestReviewBrief>,
  threadRef: ScopedThreadRef | null,
): PullRequestReviewBrief | null {
  return threadRef ? (byThreadKey[scopedThreadKey(threadRef)] ?? null) : null;
}
