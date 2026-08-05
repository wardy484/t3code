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

const MAX_STORED_REVIEWS = 3;
const MAX_STORED_COMMENTS = 50;
const MAX_STORED_FILES = 500;
const MAX_STORED_BODY_LENGTH = 20_000;
const MAX_STORED_COMMENT_LENGTH = 2_000;

function boundedBrief(brief: PullRequestReviewBrief): PullRequestReviewBrief {
  return {
    ...brief,
    context: {
      body: brief.context.body.slice(0, MAX_STORED_BODY_LENGTH),
      comments: brief.context.comments.slice(0, MAX_STORED_COMMENTS).map((comment) => ({
        ...comment,
        body: comment.body.slice(0, MAX_STORED_COMMENT_LENGTH),
      })),
      files: brief.context.files.slice(0, MAX_STORED_FILES),
    },
  };
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
      name: "t3code:pull-request-review-context:v2",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.sessionStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: Object.fromEntries(
          Object.entries(state.byThreadKey)
            .slice(-MAX_STORED_REVIEWS)
            .map(([key, brief]) => [key, boundedBrief(brief)]),
        ),
      }),
    },
  ),
);

export function selectPullRequestReviewBrief(
  byThreadKey: Record<string, PullRequestReviewBrief>,
  threadRef: ScopedThreadRef | null,
): PullRequestReviewBrief | null {
  return threadRef ? (byThreadKey[scopedThreadKey(threadRef)] ?? null) : null;
}
