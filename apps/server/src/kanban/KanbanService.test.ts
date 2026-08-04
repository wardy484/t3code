import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { FetchHttpClient } from "effect/unstable/http";
import { describe } from "vite-plus/test";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as JiraService from "../jira/JiraService.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { KanbanService, layer } from "./KanbanService.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(layer),
  Layer.provideMerge(JiraService.layer),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-kanban-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const addProject = Effect.fn("KanbanServiceTest.addProject")(function* (
  projectId: ProjectId,
  workspaceRoot: string,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_projects (
      project_id, title, workspace_root, default_model_selection_json, scripts_json,
      created_at, updated_at, deleted_at
    ) VALUES (
      ${projectId}, ${projectId}, ${workspaceRoot}, NULL, '[]',
      '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', NULL
    )
  `;
});

describe("KanbanService", () => {
  it.layer(TestLayer)("organization and native board persistence", (it) => {
    it.effect("isolates boards by project and supports the native card lifecycle", () =>
      Effect.gen(function* () {
        const projectA = ProjectId.make("project-kanban-a");
        const projectB = ProjectId.make("project-kanban-b");
        yield* addProject(projectA, "/code/t3code");
        yield* addProject(projectB, "/code/tutora");
        const kanban = yield* KanbanService;

        const t3 = yield* kanban.createOrganization({ name: "T3 Code" });
        const tutorful = yield* kanban.createOrganization({ name: "Tutorful" });
        yield* kanban.updateOrganization({
          organizationId: t3.id,
          name: t3.name,
          projectIds: [projectA],
        });
        yield* kanban.updateOrganization({
          organizationId: tutorful.id,
          name: tutorful.name,
          projectIds: [projectB],
        });

        const t3Board = yield* kanban.createNativeBoard({
          organizationId: t3.id,
          name: "Roadmap",
          projectIds: [projectA],
          baseBranch: "main",
        });
        const tutorfulBoard = yield* kanban.createNativeBoard({
          organizationId: tutorful.id,
          name: "Delivery",
          projectIds: [projectB],
          baseBranch: "master",
        });

        const aBoards = yield* kanban.getProjectBoards({ projectId: projectA });
        assert.deepEqual(
          aBoards.boards.map((board) => board.id),
          [t3Board.id],
        );
        assert.equal(aBoards.organization?.name, "T3 Code");
        const bBoards = yield* kanban.getProjectBoards({ projectId: projectB });
        assert.deepEqual(
          bBoards.boards.map((board) => board.id),
          [tutorfulBoard.id],
        );

        const created = yield* kanban.createCard({
          boardId: t3Board.id,
          summary: "Keep boards scoped",
          description: "Never show Tutorful cards in T3 Code.",
        });
        yield* kanban.createCard({
          boardId: tutorfulBoard.id,
          summary: "Tutorful-only card",
          description: "This has the same board-local key.",
        });
        assert.equal(created.statusId, "todo");
        const moved = yield* kanban.moveCard({
          boardId: t3Board.id,
          cardId: created.id,
          targetColumnId: "in-progress",
        });
        assert.equal(moved.statusName, "In Progress");
        const updated = yield* kanban.updateCard({
          boardId: t3Board.id,
          cardId: created.id,
          summary: "Keep every board scoped",
          description: created.description,
        });
        assert.equal(updated.summary, "Keep every board scoped");

        const board = yield* kanban.getBoard({ boardId: t3Board.id });
        assert.equal(board.source, "native");
        assert.equal(board.cards[0]?.statusId, "in-progress");
        assert.deepEqual(board.projectIds, [projectA]);

        const lookup = yield* kanban.lookupProjectCards({
          projectId: projectA,
          issueKeys: ["T3-1"],
        });
        assert.equal(lookup.matches.length, 1);
        assert.equal(lookup.matches[0]?.board.id, t3Board.id);
        assert.equal(lookup.matches[0]?.card.summary, "Keep every board scoped");

        yield* kanban.deleteCard({ boardId: t3Board.id, cardId: created.id });
        assert.isEmpty((yield* kanban.getBoard({ boardId: t3Board.id })).cards);
      }),
    );

    it.effect("removes old board links when a project moves organizations", () =>
      Effect.gen(function* () {
        const project = ProjectId.make("project-kanban-move");
        yield* addProject(project, "/code/move");
        const kanban = yield* KanbanService;
        const first = yield* kanban.createOrganization({ name: "First" });
        const second = yield* kanban.createOrganization({ name: "Second" });
        yield* kanban.updateOrganization({
          organizationId: first.id,
          name: first.name,
          projectIds: [project],
        });
        const oldBoard = yield* kanban.createNativeBoard({
          organizationId: first.id,
          name: "Old board",
          projectIds: [project],
          baseBranch: "main",
        });

        yield* kanban.updateOrganization({
          organizationId: second.id,
          name: second.name,
          projectIds: [project],
        });
        const result = yield* kanban.getProjectBoards({ projectId: project });
        assert.equal(result.organization?.id, second.id);
        assert.isEmpty(result.boards);
        assert.isEmpty((yield* kanban.getBoard({ boardId: oldBoard.id })).projectIds);
      }),
    );
  });

  it.layer(TestLayer)("legacy Jira import", (it) => {
    it.effect("imports the existing single-board configuration without contacting Jira", () =>
      Effect.gen(function* () {
        const project = ProjectId.make("project-kanban-legacy");
        yield* addProject(project, "/code/legacy");
        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const legacyConfiguration = yield* Schema.encodeUnknownEffect(Schema.UnknownFromJsonString)(
          {
            baseUrl: "https://tutorful.atlassian.net",
            email: "kim@example.com",
            boardId: 123,
            jql: "project = KG",
            projectPath: "/code/legacy",
            baseBranch: "master",
          },
        );
        yield* fileSystem.writeFileString(config.jiraConfigPath, legacyConfiguration);
        yield* (yield* ServerSecretStore.ServerSecretStore).set(
          "jira-api-token",
          new TextEncoder().encode("legacy-token"),
        );

        const catalog = yield* (yield* KanbanService).catalog;
        assert.equal(catalog.organizations[0]?.name, "Tutorful");
        assert.equal(catalog.boards[0]?.source, "jira");
        assert.deepEqual(catalog.boards[0]?.projectIds, [project]);
      }),
    );
  });
});
