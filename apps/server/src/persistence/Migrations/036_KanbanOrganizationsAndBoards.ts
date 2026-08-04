import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS kanban_organizations (
      organization_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS kanban_organization_projects (
      project_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES kanban_organizations(organization_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_organization_projects_organization
    ON kanban_organization_projects(organization_id, project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS kanban_boards (
      board_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES kanban_organizations(organization_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('native', 'jira')),
      base_branch TEXT NOT NULL,
      jira_base_url TEXT,
      jira_email TEXT,
      jira_board_id INTEGER,
      jira_jql TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_boards_organization
    ON kanban_boards(organization_id, created_at, board_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS kanban_board_projects (
      board_id TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      PRIMARY KEY (board_id, project_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_board_projects_project
    ON kanban_board_projects(project_id, board_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS kanban_native_cards (
      card_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES kanban_boards(board_id) ON DELETE CASCADE,
      card_number INTEGER NOT NULL,
      summary TEXT NOT NULL,
      description TEXT NOT NULL,
      status_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (board_id, card_number)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_native_cards_board_status_order
    ON kanban_native_cards(board_id, status_id, sort_order, card_number)
  `;
});
