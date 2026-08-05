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
    description: "Data models and business rules",
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
    description: "Migrations, persistence, and stored data",
    risk: "high",
    matches: (path) =>
      /(?:^|\/)(?:database|migrations?|schema|persistence|repositories)(?:\/|$)/iu.test(path),
  },
  {
    id: "tests",
    title: "Tests",
    description: "Unit, integration, and browser coverage",
    risk: "low",
    matches: isTestPath,
  },
  {
    id: "supporting",
    title: "Supporting changes",
    description: "Configuration, documentation, and tooling",
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
        description: "Application flow and service integration",
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
          risk: domain.risk,
        },
        [...domain.files, ...data.files],
      );
      layers.splice(dataIndex, 1);
    }
  }

  return layers;
}
