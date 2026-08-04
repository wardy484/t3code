import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { RelevantChangeRequest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildPullRequestThreadPrompt,
  filterProjectPullRequests,
  hasShowMeSkill,
  mergeProjectPullRequests,
  selectPullRequestSourceProjects,
} from "./pullRequests";

function project(input: {
  id: string;
  workspaceRoot: string;
  environmentId?: string;
  canonicalKey?: string;
  rootPath?: string;
}): EnvironmentProject {
  return {
    id: input.id,
    environmentId: input.environmentId ?? "env-1",
    title: input.id,
    workspaceRoot: input.workspaceRoot,
    repositoryIdentity: input.canonicalKey
      ? {
          canonicalKey: input.canonicalKey,
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: input.canonicalKey,
          },
          rootPath: input.rootPath,
        }
      : null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    deletedAt: null,
  } as unknown as EnvironmentProject;
}

const pullRequest: RelevantChangeRequest = {
  provider: "github",
  number: 42,
  title: "Add pull request inbox",
  url: "https://github.com/pingdotgg/t3code/pull/42",
  repositoryNameWithOwner: "pingdotgg/t3code",
  baseRefName: "main",
  headRefName: "feature/pr-inbox",
  authorLogin: "kim",
  isDraft: false,
  updatedAt: "2026-08-04T00:00:00.000Z",
  authoredByViewer: false,
  reviewRequestedFromViewer: true,
};

describe("pull request inbox", () => {
  it("queries one project per repository and prefers the repository root", () => {
    const root = project({
      id: "root",
      workspaceRoot: "/repo",
      canonicalKey: "github.com/pingdotgg/t3code",
      rootPath: "/repo",
    });
    const nested = project({
      id: "nested",
      workspaceRoot: "/repo/apps/web",
      canonicalKey: "github.com/pingdotgg/t3code",
      rootPath: "/repo",
    });

    expect(selectPullRequestSourceProjects([nested, root])).toEqual([root]);
  });

  it("deduplicates PRs and applies repository and ownership filters", () => {
    const sourceProject = project({ id: "repo", workspaceRoot: "/repo" });
    const items = mergeProjectPullRequests(
      [
        { project: sourceProject, pullRequests: [pullRequest] },
        { project: sourceProject, pullRequests: [pullRequest] },
      ],
      [sourceProject],
    );

    expect(items).toHaveLength(1);
    expect(
      filterProjectPullRequests(items, {
        ownership: "mine",
        repository: "all",
      }),
    ).toEqual([]);
    expect(
      filterProjectPullRequests(items, {
        ownership: "relevant",
        repository: "pingdotgg/t3code",
      }),
    ).toEqual(items);
  });

  it("maps global PRs to matching local projects and leaves other repositories read-only", () => {
    const forkProject = project({
      id: "t3code",
      workspaceRoot: "/t3code",
      canonicalKey: "github.com/wardy484/t3code",
    });
    const otherProject = project({
      id: "other",
      workspaceRoot: "/other",
      canonicalKey: "github.com/example/other",
    });
    const unrelatedPullRequest = {
      ...pullRequest,
      url: "https://github.com/TutoraUK/tutora/pull/1",
      repositoryNameWithOwner: "TutoraUK/tutora",
    };

    const items = mergeProjectPullRequests(
      [
        {
          project: forkProject,
          pullRequests: [pullRequest, unrelatedPullRequest],
        },
      ],
      [forkProject, otherProject],
    );

    expect(items.find((item) => item.pullRequest.url === pullRequest.url)?.project).toBe(
      forkProject,
    );
    expect(items.find((item) => item.pullRequest.url === unrelatedPullRequest.url)?.project).toBe(
      null,
    );
  });

  it("maps a PR to the matching project in the environment that returned it", () => {
    const localProject = project({
      id: "tutora-local",
      environmentId: "env-local",
      workspaceRoot: "/Users/kim/code/tutora",
      canonicalKey: "github.com/TutoraUK/tutora",
    });
    const remoteProject = project({
      id: "tutora-remote",
      environmentId: "env-remote",
      workspaceRoot: "/root/code/tutorful/tutora",
      canonicalKey: "github.com/TutoraUK/tutora",
    });
    const tutoraPullRequest = {
      ...pullRequest,
      url: "https://github.com/TutoraUK/tutora/pull/10677",
      repositoryNameWithOwner: "TutoraUK/tutora",
    };

    const [item] = mergeProjectPullRequests(
      [{ project: remoteProject, pullRequests: [tutoraPullRequest] }],
      [localProject, remoteProject],
    );

    expect(item?.project).toBe(remoteProject);
  });

  it("uses the show-me skill when available and a plain prompt otherwise", () => {
    const withSkill = buildPullRequestThreadPrompt(pullRequest, {
      showMe: true,
      showMeSkillAvailable: true,
    });
    const withoutSkill = buildPullRequestThreadPrompt(pullRequest, {
      showMe: true,
      showMeSkillAvailable: false,
    });

    expect(withSkill).toMatch(/^\$show-me /);
    expect(withoutSkill).not.toContain("$show-me");
    expect(withoutSkill).toContain("Run the changed product");
    expect(withSkill).toContain("<!-- t3-source-pull-request:");
  });

  it("recognizes enabled show-me skill variants", () => {
    expect(hasShowMeSkill([{ enabled: true, skills: [{ name: "show-me", enabled: true }] }])).toBe(
      true,
    );
    expect(hasShowMeSkill([{ enabled: true, skills: [{ name: "other", enabled: true }] }])).toBe(
      false,
    );
  });
});
