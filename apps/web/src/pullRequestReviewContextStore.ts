import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PullRequestReviewContext, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

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

export const usePullRequestReviewContextStore = create<PullRequestReviewContextState>()((set) => ({
  byThreadKey: {},
  set: (threadRef, brief) =>
    set((state) => ({
      byThreadKey: { ...state.byThreadKey, [scopedThreadKey(threadRef)]: brief },
    })),
}));

export function selectPullRequestReviewBrief(
  byThreadKey: Record<string, PullRequestReviewBrief>,
  threadRef: ScopedThreadRef | null,
): PullRequestReviewBrief | null {
  return threadRef ? (byThreadKey[scopedThreadKey(threadRef)] ?? null) : null;
}
