export type PullRequestLayerRisk = "high" | "medium" | "low";

export interface PullRequestLayerFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly commentCount: number;
}

export interface PullRequestLayer {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly reviewFocus: string;
  readonly whyTogether: string;
  readonly suggestedCommit: string;
  readonly risk: PullRequestLayerRisk;
  readonly files: ReadonlyArray<PullRequestLayerFile>;
  readonly additions: number;
  readonly deletions: number;
  readonly commentCount: number;
}

interface LayerDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly reviewFocus: string;
  readonly whyTogether: string;
  readonly suggestedCommit: string;
  readonly risk: PullRequestLayerRisk;
  readonly matches: (path: string) => boolean;
}

const isTestPath = (path: string) =>
  /(?:^|\/)(?:tests?|specs?|__tests__|cypress|playwright)(?:\/|$)/iu.test(path) ||
  /(?:\.test|\.spec)\.[^/]+$/iu.test(path);

const DEFINITIONS: ReadonlyArray<LayerDefinition> = [
  {
    id: "domain",
    title: "Domain rules",
    description:
      "This slice defines the concepts and business rules the rest of the change depends on. Read it first so later workflow code has a clear meaning.",
    reviewFocus:
      "Check that the new states and eligibility rules match the product behaviour, especially edge cases that make a sanction apply or stop applying.",
    whyTogether:
      "These files jointly define and persist one business decision. Separating them would make the rule harder to understand in isolation.",
    suggestedCommit: "feat: define the sanction domain rules",
    risk: "high",
    matches: (path) =>
      !isTestPath(path) &&
      (/(?:^|\/)(?:domain|domains|models?|enums?|valueobjects?|data-transfer-objects)(?:\/|$)/iu.test(
        path,
      ) ||
        /(?:mapper|policy|rule|enum|valueobject)/iu.test(path)),
  },
  {
    id: "data",
    title: "Data and schema",
    description:
      "This slice changes how the feature is represented or retrieved from storage. It establishes the data contract used by the application flow.",
    reviewFocus:
      "Check compatibility with existing data, query semantics, indexes, and whether rollback or partial deployment could leave an invalid state.",
    whyTogether:
      "The migration, repository, and schema changes form one persistence decision and should be reviewed as a unit.",
    suggestedCommit: "feat: add persistence for sanction outcomes",
    risk: "high",
    matches: (path) =>
      /(?:^|\/)(?:database|migrations?|schema|persistence|repositories)(?:\/|$)/iu.test(path),
  },
  {
    id: "tests",
    title: "Tests",
    description:
      "This slice proves the new behaviour from focused rules through the integrated workflow. Use it as a checklist against the claims made by the implementation.",
    reviewFocus:
      "Look for missing failure paths, timing boundaries, state transitions, and assertions that could pass without proving the intended outcome.",
    whyTogether:
      "These tests describe the same behaviour at different seams and reveal whether the implementation is safely covered end to end.",
    suggestedCommit: "test: cover the sanction outcome workflow",
    risk: "low",
    matches: isTestPath,
  },
  {
    id: "supporting",
    title: "Supporting changes",
    description:
      "This slice updates the configuration, documentation, or tooling needed to support the feature. It should not silently introduce product behaviour.",
    reviewFocus:
      "Check that operational defaults are safe, documentation matches the implementation, and unrelated cleanup has not leaked into the PR.",
    whyTogether:
      "These files support the main behaviour but can be understood and, if necessary, shipped independently.",
    suggestedCommit: "chore: update supporting configuration and docs",
    risk: "low",
    matches: (path) =>
      /(?:^|\/)(?:docs?|config|scripts?|\.github)(?:\/|$)/iu.test(path) ||
      /(?:readme|changelog|\.md$|\.ya?ml$|\.json$)/iu.test(path),
  },
];

function layerFrom(definition: Omit<LayerDefinition, "matches">, files: PullRequestLayerFile[]) {
  return {
    ...definition,
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    commentCount: files.reduce((total, file) => total + file.commentCount, 0),
  } satisfies PullRequestLayer;
}

export function buildPullRequestLayers(
  files: ReadonlyArray<PullRequestLayerFile>,
): PullRequestLayer[] {
  const unmatched = new Set(files.map((file) => file.path));
  const layers: PullRequestLayer[] = [];

  for (const definition of DEFINITIONS) {
    const matching = files.filter(
      (file) => unmatched.has(file.path) && definition.matches(file.path),
    );
    if (matching.length === 0) continue;
    matching.forEach((file) => unmatched.delete(file.path));
    layers.push(layerFrom(definition, matching));
  }

  const workflowFiles = files.filter((file) => unmatched.has(file.path));
  if (workflowFiles.length > 0) {
    const workflow = layerFrom(
      {
        id: "workflow",
        title: "Workflow wiring",
        description:
          "This slice carries the domain decision through the application flow. It connects handlers, jobs, services, and events so the behaviour actually runs.",
        reviewFocus:
          "Trace the happy path and the stop conditions. Pay particular attention to ordering, retries, delayed execution, and whether eligibility is recalculated at the right time.",
        whyTogether:
          "These files form one execution path: each hands responsibility to the next. Reviewing them separately would hide control-flow gaps.",
        suggestedCommit: "feat: wire the sanction execution workflow",
        risk: "medium",
      },
      workflowFiles,
    );
    const testsIndex = layers.findIndex((layer) => layer.id === "tests");
    if (testsIndex === -1) layers.push(workflow);
    else layers.splice(testsIndex, 0, workflow);
  }

  const domainIndex = layers.findIndex((layer) => layer.id === "domain");
  const dataIndex = layers.findIndex((layer) => layer.id === "data");
  if (domainIndex !== -1 && dataIndex !== -1) {
    const domain = layers[domainIndex];
    const data = layers[dataIndex];
    if (domain && data) {
      layers[domainIndex] = layerFrom(
        {
          id: domain.id,
          title: domain.title,
          description: domain.description,
          reviewFocus: domain.reviewFocus,
          whyTogether: domain.whyTogether,
          suggestedCommit: domain.suggestedCommit,
          risk: domain.risk,
        },
        [...domain.files, ...data.files],
      );
      layers.splice(dataIndex, 1);
    }
  }

  return layers;
}
