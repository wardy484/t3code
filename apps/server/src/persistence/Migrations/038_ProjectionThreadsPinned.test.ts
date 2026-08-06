import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("038_ProjectionThreadsPinned", (it) => {
  it.effect("adds pinned_at after the fork migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 37 });
      const before = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(!before.some((column) => column.name === "pinned_at"));

      yield* runMigrations({ toMigrationInclusive: 38 });
      const after = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(after.some((column) => column.name === "pinned_at"));

      const migrations = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id BETWEEN 36 AND 38
        ORDER BY migration_id ASC
      `;
      assert.deepEqual(migrations, [
        { migrationId: 36, name: "KanbanOrganizationsAndBoards" },
        { migrationId: 37, name: "ProjectionThreadParent" },
        { migrationId: 38, name: "ProjectionThreadsPinned" },
      ]);
    }),
  );
});
