import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import { buildDiffReviewComment } from "./reviewCommentContext";
import { buildPullRequestReviewComments } from "./pullRequestReview";

const [fileDiff] = parsePatchFiles(`diff --git a/src/value.ts b/src/value.ts
--- a/src/value.ts
+++ b/src/value.ts
@@ -1,2 +1,3 @@
 export const one = 1;
+export const two = 2;
 export const three = 3;
`)[0]!.files;

describe("pull request review comments", () => {
  it("converts branch diff comments to GitHub line coordinates", () => {
    expect(fileDiff).toBeDefined();
    const reviewComment = buildDiffReviewComment({
      id: "comment-1",
      sectionId: "branch",
      sectionTitle: "Branch changes",
      filePath: "src/value.ts",
      fileDiff: fileDiff!,
      range: { start: 2, end: 2, side: "additions", endSide: "additions" },
      text: "Please cover this line.",
    });

    const result = buildPullRequestReviewComments(
      [reviewComment!],
      [{ filePath: "src/value.ts", fileDiff: fileDiff! }],
    );

    expect(result.comments).toEqual([
      {
        path: "src/value.ts",
        body: "Please cover this line.",
        line: 2,
        side: "right",
      },
    ]);
    expect([...result.includedCommentIds]).toEqual(["comment-1"]);
    expect(result.skippedCount).toBe(0);
  });

  it("leaves non-branch comments for the agent composer", () => {
    const reviewComment = buildDiffReviewComment({
      id: "comment-1",
      sectionId: "turn:1",
      sectionTitle: "Turn 1",
      filePath: "src/value.ts",
      fileDiff: fileDiff!,
      range: { start: 2, end: 2, side: "additions", endSide: "additions" },
      text: "Agent-only context.",
    });

    const result = buildPullRequestReviewComments(
      [reviewComment!],
      [{ filePath: "src/value.ts", fileDiff: fileDiff! }],
    );

    expect(result.comments).toEqual([]);
    expect(result.skippedCount).toBe(0);
  });
});
