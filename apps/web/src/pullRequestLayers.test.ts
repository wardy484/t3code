import { describe, expect, it } from "vite-plus/test";
import { buildPullRequestLayers } from "./pullRequestLayers";

describe("pull request layers", () => {
  it("turns a mixed PR into ordered reviewer decisions", () => {
    const layers = buildPullRequestLayers([
      { path: "app/Enums/SanctionOutcome.php", additions: 12, deletions: 1, commentCount: 1 },
      { path: "app/Support/SanctionMapper.php", additions: 40, deletions: 2, commentCount: 0 },
      { path: "app/Jobs/ApplySanction.php", additions: 20, deletions: 3, commentCount: 2 },
      { path: "tests/Unit/SanctionMapperTest.php", additions: 60, deletions: 0, commentCount: 0 },
    ]);

    expect(layers.map((layer) => layer.title)).toEqual([
      "Domain rules",
      "Workflow wiring",
      "Tests",
    ]);
    expect(layers[0]).toMatchObject({ additions: 52, deletions: 3, commentCount: 1 });
    expect(layers[1]?.files.map((file) => file.path)).toEqual(["app/Jobs/ApplySanction.php"]);
  });

  it("keeps configuration separate from application behavior", () => {
    const layers = buildPullRequestLayers([
      { path: "config/services.php", additions: 4, deletions: 1, commentCount: 0 },
      { path: "app/Service.php", additions: 8, deletions: 0, commentCount: 0 },
    ]);

    expect(layers.map((layer) => layer.id)).toEqual(["supporting", "workflow"]);
  });

  it("keeps schema changes with domain rules when they form one reviewer decision", () => {
    const layers = buildPullRequestLayers([
      { path: "app/Domain/Invite.php", additions: 8, deletions: 0, commentCount: 0 },
      {
        path: "database/migrations/create_invites.php",
        additions: 14,
        deletions: 0,
        commentCount: 0,
      },
      { path: "app/InviteService.php", additions: 20, deletions: 2, commentCount: 0 },
    ]);

    expect(layers.map((layer) => layer.id)).toEqual(["domain", "workflow"]);
    expect(layers[0]?.files).toHaveLength(2);
  });
});
