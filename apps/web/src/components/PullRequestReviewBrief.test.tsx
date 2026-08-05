import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { PullRequestReviewBrief } from "./PullRequestReviewBrief";

describe("PullRequestReviewBrief", () => {
  it("presents the PR description, existing discussion, and changed files before the diff", () => {
    const html = renderToStaticMarkup(
      <PullRequestReviewBrief
        brief={{
          number: 42,
          title: "Make review easier",
          url: "https://github.com/t3tools/t3code/pull/42",
          repositoryNameWithOwner: "t3tools/t3code",
          context: {
            body: "Why this changed",
            comments: [
              {
                id: "comment-1",
                kind: "inline",
                authorLogin: "reviewer",
                body: "What handles null?",
                createdAt: "2026-08-03T00:00:00Z",
                url: null,
                path: "src/review.ts",
                line: 42,
                state: null,
              },
            ],
            files: [{ path: "src/review.ts", additions: 12, deletions: 3 }],
          },
        }}
      />,
    );

    expect(html).toContain("PR description");
    expect(html).toContain("Why this changed");
    expect(html).toContain("Existing discussion (1)");
    expect(html).toContain("What handles null?");
    expect(html).toContain("src/review.ts");
    expect(html).toContain("max-h-[45%]");
  });
});
