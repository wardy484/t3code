import type { RelevantChangeRequest } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";

export interface ProjectPullRequest {
  readonly project: EnvironmentProject | null;
  readonly pullRequest: RelevantChangeRequest;
}

export type PullRequestOwnershipFilter = "relevant" | "mine";

export function selectPullRequestSourceProjects(
  projects: ReadonlyArray<EnvironmentProject>,
): EnvironmentProject[] {
  const selected = new Map<string, EnvironmentProject>();
  for (const project of projects) {
    const key = project.environmentId;
    const existing = selected.get(key);
    const projectIsRepositoryRoot = project.repositoryIdentity?.rootPath === project.workspaceRoot;
    const existingIsRepositoryRoot =
      existing?.repositoryIdentity?.rootPath === existing?.workspaceRoot;
    if (!existing || (projectIsRepositoryRoot && !existingIsRepositoryRoot)) {
      selected.set(key, project);
    }
  }
  return [...selected.values()];
}

export function mergeProjectPullRequests(
  sources: ReadonlyArray<{
    readonly project: EnvironmentProject;
    readonly pullRequests: ReadonlyArray<RelevantChangeRequest>;
  }>,
  projects: ReadonlyArray<EnvironmentProject>,
): ProjectPullRequest[] {
  const merged = new Map<string, ProjectPullRequest>();
  for (const source of sources) {
    for (const pullRequest of source.pullRequests) {
      if (!merged.has(pullRequest.url)) {
        merged.set(pullRequest.url, {
          project: matchPullRequestProject(pullRequest, projects),
          pullRequest,
        });
      }
    }
  }
  return [...merged.values()].toSorted((left, right) =>
    (right.pullRequest.updatedAt ?? "").localeCompare(left.pullRequest.updatedAt ?? ""),
  );
}

function matchPullRequestProject(
  pullRequest: RelevantChangeRequest,
  projects: ReadonlyArray<EnvironmentProject>,
): EnvironmentProject | null {
  const repository = pullRequest.repositoryNameWithOwner.toLowerCase();
  const exactMatches = projects.filter((project) =>
    project.repositoryIdentity?.canonicalKey.toLowerCase().endsWith(`github.com/${repository}`),
  );
  if (exactMatches.length === 1) return exactMatches[0] ?? null;

  const repositoryName = repository.split("/").at(-1);
  const nameMatches = projects.filter((project) => {
    const canonicalKey = project.repositoryIdentity?.canonicalKey.toLowerCase();
    return canonicalKey?.split("/").at(-1) === repositoryName;
  });
  return nameMatches.length === 1 ? (nameMatches[0] ?? null) : null;
}

export function filterProjectPullRequests(
  items: ReadonlyArray<ProjectPullRequest>,
  input: {
    readonly ownership: PullRequestOwnershipFilter;
    readonly repository: string;
  },
): ProjectPullRequest[] {
  return items.filter(
    ({ pullRequest }) =>
      (input.ownership === "relevant" || pullRequest.authoredByViewer) &&
      (input.repository === "all" || pullRequest.repositoryNameWithOwner === input.repository),
  );
}

export function buildPullRequestThreadPrompt(
  pullRequest: RelevantChangeRequest,
  input: { readonly showMe: boolean; readonly showMeSkillAvailable: boolean },
): string {
  const context = [
    `<!-- t3-source-pull-request:${pullRequest.url} -->`,
    `${input.showMe ? "Demonstrate" : "Review"} this GitHub pull request: ${pullRequest.repositoryNameWithOwner}#${pullRequest.number} — ${pullRequest.title}`,
    "",
    `GitHub: ${pullRequest.url}`,
    ...(pullRequest.headRefName && pullRequest.baseRefName
      ? [`Branches: ${pullRequest.headRefName} → ${pullRequest.baseRefName}`, ""]
      : []),
    "This thread is checked out at the pull request head in a dedicated worktree.",
  ];

  if (!input.showMe) {
    return [
      ...context,
      "Inspect the pull request description and diff, run relevant verification, and report confirmed review findings with file and line references.",
    ].join("\n");
  }

  const instruction =
    "Run the changed product, exercise the behavior introduced by this pull request, and show me the result in the in-app browser. If setup or runtime behavior is broken, explain the blocker with evidence.";
  return [
    ...(input.showMeSkillAvailable ? [`$show-me ${instruction}`, ""] : []),
    ...context,
    ...(input.showMeSkillAvailable ? [] : [instruction]),
  ].join("\n");
}

export function hasShowMeSkill(
  providers: ReadonlyArray<{
    readonly enabled: boolean;
    readonly skills: ReadonlyArray<{
      readonly name: string;
      readonly enabled: boolean;
    }>;
  }> | null,
): boolean {
  return (
    providers?.some(
      (provider) =>
        provider.enabled &&
        provider.skills.some(
          (skill) => skill.enabled && /^(?:show[-_ ]?me)$/iu.test(skill.name.replace(/^\$/, "")),
        ),
    ) ?? false
  );
}
