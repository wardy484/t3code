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
          project: matchPullRequestProject(pullRequest, projects, source.project.environmentId),
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
  sourceEnvironmentId: EnvironmentProject["environmentId"],
): EnvironmentProject | null {
  const repository = pullRequest.repositoryNameWithOwner.toLowerCase();
  const exactMatches = projects.filter((project) =>
    project.repositoryIdentity?.canonicalKey.toLowerCase().endsWith(`github.com/${repository}`),
  );
  const sourceEnvironmentExactMatches = exactMatches.filter(
    (project) => project.environmentId === sourceEnvironmentId,
  );
  if (sourceEnvironmentExactMatches.length === 1) {
    return sourceEnvironmentExactMatches[0] ?? null;
  }
  if (exactMatches.length === 1) return exactMatches[0] ?? null;

  const repositoryName = repository.split("/").at(-1);
  const nameMatches = projects.filter((project) => {
    const canonicalKey = project.repositoryIdentity?.canonicalKey.toLowerCase();
    return canonicalKey?.split("/").at(-1) === repositoryName;
  });
  const sourceEnvironmentNameMatches = nameMatches.filter(
    (project) => project.environmentId === sourceEnvironmentId,
  );
  if (sourceEnvironmentNameMatches.length === 1) {
    return sourceEnvironmentNameMatches[0] ?? null;
  }
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
      "Help me review this pull request myself; do not replace the review with only an LLM verdict.",
      "",
      "Fetch the live PR description, existing discussion, review state, and changed-file list from GitHub, then inspect the diff.",
      "",
      "Your FIRST response must be a review card of at most 180 words. Use exactly these five bullets:",
      "- What changed — one plain-English sentence.",
      "- Why — one sentence grounded in the PR description.",
      "- Start here — the single best file for me to skim first, with why.",
      "- Watch out — the highest-risk behavior or 'Nothing obvious yet'.",
      "- PR size — 'Cohesive' or 'Should be split', followed by one sentence. If split, name the concrete boundary and whether it would have been easy before submission. Describe review cost, but do not infer developer motivation.",
      "",
      "Then stop. End with: 'Choose: Guided skim · Existing comments · Risks/tests · Split assessment'. Do not include a full walkthrough, findings catalogue, long prose, or more than five bullets until I choose. Explicitly say if GitHub context could not be fetched. The code diff is open beside the conversation; guide me through one file at a time instead of summarizing the code away.",
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
