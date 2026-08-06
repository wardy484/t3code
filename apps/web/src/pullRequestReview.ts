import type { FileDiffMetadata } from "@pierre/diffs";
import type { ChangeRequestReviewComment } from "@t3tools/contracts";

import { restoreDiffReviewCommentRange, type ReviewCommentContext } from "./reviewCommentContext";

export interface PullRequestReviewDiffFile {
  readonly filePath: string;
  readonly fileDiff: FileDiffMetadata;
}

export interface PullRequestReviewComments {
  readonly comments: ChangeRequestReviewComment[];
  readonly includedCommentIds: ReadonlySet<string>;
  readonly skippedCount: number;
}

export function matchesPullRequestBaseRef(
  selectedBaseRef: string | null | undefined,
  pullRequestBaseRef: string,
): boolean {
  if (!selectedBaseRef) return false;
  return (
    selectedBaseRef === pullRequestBaseRef || selectedBaseRef === `origin/${pullRequestBaseRef}`
  );
}

export function buildPullRequestReviewComments(
  reviewComments: ReadonlyArray<ReviewCommentContext>,
  files: ReadonlyArray<PullRequestReviewDiffFile>,
): PullRequestReviewComments {
  const filesByPath = new Map(files.map((file) => [file.filePath, file.fileDiff]));
  const comments: ChangeRequestReviewComment[] = [];
  const includedCommentIds = new Set<string>();
  let skippedCount = 0;

  for (const reviewComment of reviewComments) {
    if (reviewComment.sectionId !== "branch" || !reviewComment.text.trim()) continue;
    const fileDiff = filesByPath.get(reviewComment.filePath);
    const range = fileDiff ? restoreDiffReviewCommentRange(fileDiff, reviewComment) : null;
    if (!range) {
      skippedCount += 1;
      continue;
    }

    const startSide = range.side === "deletions" ? "left" : "right";
    const endSide = (range.endSide ?? range.side) === "deletions" ? "left" : "right";
    const isRange = range.start !== range.end || startSide !== endSide;
    if (isRange && startSide !== endSide) {
      skippedCount += 1;
      continue;
    }

    comments.push({
      path: reviewComment.filePath,
      body: reviewComment.text.trim(),
      line: range.end,
      side: endSide,
      ...(isRange ? { startLine: range.start, startSide } : {}),
    });
    includedCommentIds.add(reviewComment.id);
  }

  return { comments, includedCommentIds, skippedCount };
}
