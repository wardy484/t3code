import type { ScopedThreadRef } from "@t3tools/contracts";

import { useDiffPanelStore } from "./diffPanelStore";
import { useRightPanelStore } from "./rightPanelStore";
import { expandPreviewPanelForReview } from "./components/preview/PreviewPanelShell";

export function openPullRequestReviewWorkspace(
  threadRef: ScopedThreadRef,
  baseRef: string | null,
): void {
  const remoteBaseRef = baseRef ? `origin/${baseRef}` : null;
  useDiffPanelStore.getState().selectBranchBaseRef(threadRef, remoteBaseRef);
  useRightPanelStore.getState().open(threadRef, "diff");
  expandPreviewPanelForReview();
}
