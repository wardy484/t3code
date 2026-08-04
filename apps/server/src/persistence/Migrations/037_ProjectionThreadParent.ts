import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "parent_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN parent_thread_id TEXT
    `;
  }

  yield* sql`
    UPDATE projection_threads
    SET parent_thread_id = (
      SELECT json_extract(event.payload_json, '$.activity.payload.sourceThreadId')
      FROM orchestration_events AS event
      WHERE event.event_type = 'thread.activity-appended'
        AND json_extract(event.payload_json, '$.activity.kind') IN (
          'delegated-work.started',
          'jira.ticket.work-started'
        )
        AND json_extract(event.payload_json, '$.activity.payload.workThreadId') =
          projection_threads.thread_id
      ORDER BY event.sequence DESC
      LIMIT 1
    )
    WHERE parent_thread_id IS NULL
  `;
});
