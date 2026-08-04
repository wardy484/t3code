import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_KanbanOrganizationsAndBoards", (it) => {
  it.effect("creates the organization, board, assignment, and native card tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* runMigrations({ toMigrationInclusive: 36 });

      const rows = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'kanban_%'
        ORDER BY name ASC
      `;
      assert.deepEqual(
        rows.map((row) => row.name),
        [
          "kanban_board_projects",
          "kanban_boards",
          "kanban_native_cards",
          "kanban_organization_projects",
          "kanban_organizations",
        ],
      );
    }),
  );
});
