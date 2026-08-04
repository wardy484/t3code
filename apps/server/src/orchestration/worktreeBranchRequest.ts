const WORKTREE_BRANCH_REQUEST_PATTERN =
  /<!-- t3-worktree-branch:([A-Za-z0-9][A-Za-z0-9._/-]{0,127}) -->/;

export function resolveRequestedWorktreeBranchName(message: string): string | null {
  const branch = WORKTREE_BRANCH_REQUEST_PATTERN.exec(message)?.[1];
  if (
    !branch ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith(".") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock")
  ) {
    return null;
  }
  return branch;
}
