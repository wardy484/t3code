import { describe, expect, it } from "vite-plus/test";

import { resolveRequestedWorktreeBranchName } from "./worktreeBranchRequest.ts";

describe("resolveRequestedWorktreeBranchName", () => {
  it("reads the exact branch requested by an integration prompt", () => {
    expect(
      resolveRequestedWorktreeBranchName(
        "<!-- t3-worktree-branch:KG-3345-title-of-ticket -->\nWork this ticket.",
      ),
    ).toBe("KG-3345-title-of-ticket");
  });

  it("rejects unsafe git ref names", () => {
    expect(
      resolveRequestedWorktreeBranchName("<!-- t3-worktree-branch:KG-1/../main -->"),
    ).toBeNull();
    expect(resolveRequestedWorktreeBranchName("<!-- t3-worktree-branch:KG-1.lock -->")).toBeNull();
  });
});
