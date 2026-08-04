import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("037_ProjectionThreadParent", (it) => {
  it.effect("adds and backfills delegated parent ids from generic and legacy Jira events", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 36 });

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          settled_override,
          settled_at,
          snoozed_until,
          snoozed_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at
        )
        VALUES
          ('thread-parent', 'project-1', 'Parent', '{"instanceId":"codex","model":"gpt-5.6"}', 'full-access', 'default', NULL, NULL, NULL, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, NULL),
          ('thread-generic', 'project-1', 'Generic child', '{"instanceId":"codex","model":"gpt-5.6"}', 'full-access', 'default', NULL, NULL, NULL, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, NULL),
          ('thread-jira', 'project-1', 'Jira child', '{"instanceId":"codex","model":"gpt-5.6"}', 'full-access', 'default', NULL, NULL, NULL, '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, NULL)
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES
          ('event-generic', 'thread', 'thread-parent', 1, 'thread.activity-appended', '2026-08-04T00:00:00.000Z', 'command-generic', NULL, 'command-generic', 'server', '{"threadId":"thread-parent","activity":{"kind":"delegated-work.started","payload":{"sourceThreadId":"thread-parent","workThreadId":"thread-generic"}}}', '{}'),
          ('event-jira', 'thread', 'thread-parent', 2, 'thread.activity-appended', '2026-08-04T00:01:00.000Z', 'command-jira', NULL, 'command-jira', 'server', '{"threadId":"thread-parent","activity":{"kind":"jira.ticket.work-started","payload":{"sourceThreadId":"thread-parent","workThreadId":"thread-jira"}}}', '{}')
      `;

      yield* runMigrations({ toMigrationInclusive: 37 });

      const rows = yield* sql<{
        readonly threadId: string;
        readonly parentThreadId: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          parent_thread_id AS "parentThreadId"
        FROM projection_threads
        ORDER BY thread_id ASC
      `;
      assert.deepEqual(rows, [
        { threadId: "thread-generic", parentThreadId: "thread-parent" },
        { threadId: "thread-jira", parentThreadId: "thread-parent" },
        { threadId: "thread-parent", parentThreadId: null },
      ]);
    }),
  );
});
