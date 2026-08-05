import { describe, expect, it } from "vite-plus/test";
import * as Result from "effect/Result";
import { decodeGitHubReviewContext } from "./gitHubReviewContext.ts";

describe("GitHub review context", () => {
  it("combines the PR body, discussion, inline comments, and files", () => {
    const result = decodeGitHubReviewContext(
      JSON.stringify({
        body: "## Why\nMake reviews easier.",
        comments: [
          {
            id: "IC_1",
            author: { login: "author" },
            body: "Context",
            createdAt: "2026-08-01T00:00:00Z",
            url: "https://example.test/1",
          },
        ],
        reviews: [
          {
            id: "R_1",
            author: { login: "reviewer" },
            body: "Please split this.",
            submittedAt: "2026-08-02T00:00:00Z",
            state: "CHANGES_REQUESTED",
          },
        ],
        files: [{ path: "src/review.ts", additions: 12, deletions: 3 }],
      }),
      JSON.stringify([
        {
          id: 3,
          user: { login: "reviewer" },
          body: "What handles null?",
          created_at: "2026-08-03T00:00:00Z",
          html_url: "https://example.test/3",
          path: "src/review.ts",
          line: 42,
        },
      ]),
    );

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isFailure(result)) return;
    expect(result.success.body).toContain("Make reviews easier");
    expect(result.success.comments.map((comment) => comment.kind)).toEqual([
      "issue",
      "review",
      "inline",
    ]);
    expect(result.success.comments[2]).toMatchObject({ path: "src/review.ts", line: 42 });
    expect(result.success.files).toEqual([{ path: "src/review.ts", additions: 12, deletions: 3 }]);
  });
});
