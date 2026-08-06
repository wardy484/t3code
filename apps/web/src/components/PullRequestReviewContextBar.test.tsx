import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PullRequestReviewContextBar } from "./PullRequestReviewContextBar";

describe("PullRequestReviewContextBar", () => {
  it("keeps the PR description and existing discussion available beside the diff", () => {
    const markup = renderToStaticMarkup(
      <PullRequestReviewContextBar
        brief={{
          number: 42,
          title: "Keep review context visible",
          url: "https://github.com/t3tools/t3code/pull/42",
          repositoryNameWithOwner: "t3tools/t3code",
          context: {
            body: "This explains the change.",
            files: [{ path: "apps/web/src/review.tsx", additions: 12, deletions: 3 }],
            comments: [
              {
                id: "comment-1",
                kind: "issue",
                authorLogin: "reviewer",
                body: "Please keep this context.",
                createdAt: null,
                url: null,
                path: null,
                line: null,
                state: null,
              },
            ],
          },
        }}
      />,
    );

    expect(markup).toContain('aria-label="Pull request context"');
    expect(markup).toContain("Keep review context visible");
    expect(markup).toContain("This explains the change.");
    expect(markup).toContain("Discussion (1)");
    expect(markup).toContain("Please keep this context.");
  });
});
