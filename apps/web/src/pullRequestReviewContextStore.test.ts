import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  selectPullRequestReviewBrief,
  usePullRequestReviewContextStore,
} from "./pullRequestReviewContextStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

function brief(number: number) {
  return {
    number,
    title: `Review ${number}`,
    url: `https://github.com/t3tools/t3code/pull/${number}`,
    repositoryNameWithOwner: "t3tools/t3code",
    context: { body: "Why this changed", comments: [], files: [] },
  };
}

describe("pull request review context store", () => {
  beforeEach(() => usePullRequestReviewContextStore.setState({ byThreadKey: {} }));

  it("keeps structured GitHub context with the review thread", () => {
    usePullRequestReviewContextStore.getState().set(THREAD_REF, {
      number: 42,
      title: "Make review easier",
      url: "https://github.com/t3tools/t3code/pull/42",
      repositoryNameWithOwner: "t3tools/t3code",
      context: {
        body: "Why this changed",
        comments: [],
        files: [{ path: "src/review.ts", additions: 10, deletions: 2 }],
      },
    });

    expect(
      selectPullRequestReviewBrief(
        usePullRequestReviewContextStore.getState().byThreadKey,
        THREAD_REF,
      ),
    ).toMatchObject({ number: 42, context: { body: "Why this changed" } });
  });

  it("bounds persisted review data to the latest 20 threads", () => {
    for (let index = 1; index <= 21; index += 1) {
      usePullRequestReviewContextStore
        .getState()
        .set(
          scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make(`thread-${index}`)),
          brief(index),
        );
    }

    const contexts = usePullRequestReviewContextStore.getState().byThreadKey;
    expect(Object.keys(contexts)).toHaveLength(20);
    expect(selectPullRequestReviewBrief(contexts, THREAD_REF)).toBeNull();
  });
});
