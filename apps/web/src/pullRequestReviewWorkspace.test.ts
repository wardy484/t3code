import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "./diffPanelStore";
import { openPullRequestReviewWorkspace } from "./pullRequestReviewWorkspace";
import { selectThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

const THREAD_REF = scopeThreadRef(
  EnvironmentId.make("environment-local"),
  ThreadId.make("thread-review"),
);

describe("pull request review workspace", () => {
  beforeEach(() => {
    useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} });
    useRightPanelStore.setState({ byThreadKey: {} });
  });

  it("opens the pull request branch diff against its base", () => {
    openPullRequestReviewWorkspace(THREAD_REF, "main");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/main" });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, THREAD_REF),
    ).toMatchObject({ isOpen: true, activeSurfaceId: "diff" });
  });

  it("uses the remote ref when the base branch name contains a slash", () => {
    openPullRequestReviewWorkspace(THREAD_REF, "release/next");

    expect(
      selectThreadDiffPanelSelection(useDiffPanelStore.getState().byThreadKey, THREAD_REF),
    ).toEqual({ kind: "branch", baseRef: "origin/release/next" });
  });
});
