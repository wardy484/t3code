import {
  KanbanBoardId,
  KanbanCardId,
  OrganizationId,
  ProjectId,
  type KanbanAssignCardInput,
  type KanbanBoard,
  type KanbanBoardInput,
  type KanbanBoardSummary,
  type KanbanCard,
  type KanbanCatalog,
  type KanbanCreateCardInput,
  type KanbanCreateJiraBoardInput,
  type KanbanCreateNativeBoardInput,
  type KanbanCreateOrganizationInput,
  type KanbanDeleteCardInput,
  type KanbanDeleteOrganizationInput,
  type KanbanDeleteResult,
  type KanbanMoveCardInput,
  type KanbanLookupProjectCardsInput,
  type KanbanLookupProjectCardsResult,
  type KanbanOrganization,
  type KanbanProjectBoards,
  type KanbanProjectBoardsInput,
  type KanbanUpdateBoardInput,
  type KanbanUpdateCardInput,
  type KanbanUpdateOrganizationInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { JiraService, jiraBranchName, type JiraRuntimeConfig } from "../jira/JiraService.ts";

const NATIVE_COLUMNS = [
  { id: "todo", name: "Todo", statusIds: ["todo"] },
  { id: "in-progress", name: "In Progress", statusIds: ["in-progress"] },
  { id: "done", name: "Done", statusIds: ["done"] },
] as const;

type OrganizationRow = {
  readonly organizationId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type BoardRow = {
  readonly boardId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly source: "native" | "jira";
  readonly baseBranch: string;
  readonly jiraBaseUrl: string | null;
  readonly jiraEmail: string | null;
  readonly jiraBoardId: number | null;
  readonly jiraJql: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type NativeCardRow = {
  readonly cardId: string;
  readonly boardId: string;
  readonly cardNumber: number;
  readonly summary: string;
  readonly description: string;
  readonly statusId: string;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export class KanbanServiceError extends Schema.TaggedErrorClass<KanbanServiceError>()(
  "KanbanServiceError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : `Kanban ${this.operation} failed.`;
  }
}

type ServiceEffect<A> = Effect.Effect<A, KanbanServiceError>;

export class KanbanService extends Context.Service<
  KanbanService,
  {
    readonly catalog: ServiceEffect<KanbanCatalog>;
    readonly createOrganization: (
      input: KanbanCreateOrganizationInput,
    ) => ServiceEffect<KanbanOrganization>;
    readonly updateOrganization: (
      input: KanbanUpdateOrganizationInput,
    ) => ServiceEffect<KanbanOrganization>;
    readonly deleteOrganization: (
      input: KanbanDeleteOrganizationInput,
    ) => ServiceEffect<KanbanDeleteResult>;
    readonly createNativeBoard: (
      input: KanbanCreateNativeBoardInput,
    ) => ServiceEffect<KanbanBoardSummary>;
    readonly createJiraBoard: (
      input: KanbanCreateJiraBoardInput,
    ) => ServiceEffect<KanbanBoardSummary>;
    readonly updateBoard: (input: KanbanUpdateBoardInput) => ServiceEffect<KanbanBoardSummary>;
    readonly deleteBoard: (input: KanbanBoardInput) => ServiceEffect<KanbanDeleteResult>;
    readonly getBoard: (input: KanbanBoardInput) => ServiceEffect<KanbanBoard>;
    readonly getProjectBoards: (
      input: KanbanProjectBoardsInput,
    ) => ServiceEffect<KanbanProjectBoards>;
    readonly lookupProjectCards: (
      input: KanbanLookupProjectCardsInput,
    ) => ServiceEffect<KanbanLookupProjectCardsResult>;
    readonly createCard: (input: KanbanCreateCardInput) => ServiceEffect<KanbanCard>;
    readonly updateCard: (input: KanbanUpdateCardInput) => ServiceEffect<KanbanCard>;
    readonly moveCard: (input: KanbanMoveCardInput) => ServiceEffect<KanbanCard>;
    readonly assignCard: (input: KanbanAssignCardInput) => ServiceEffect<KanbanCard>;
    readonly deleteCard: (input: KanbanDeleteCardInput) => ServiceEffect<KanbanDeleteResult>;
  }
>()("t3/kanban/KanbanService") {}

const serviceError = (operation: string, cause: unknown) =>
  new KanbanServiceError({ operation, cause });

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const jiraSecretName = (organizationId: string) => `jira-api-token-${organizationId}`;

function legacyOrganizationName(baseUrl: string): string {
  try {
    const site = new URL(baseUrl).hostname.split(".")[0];
    return site ? site.charAt(0).toUpperCase() + site.slice(1) : "Jira";
  } catch {
    return "Jira";
  }
}

export const layer = Layer.effect(
  KanbanService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const secretStore = yield* ServerSecretStore.ServerSecretStore;
    const jira = yield* JiraService;

    const db = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => serviceError(operation, cause)));

    const randomId = Effect.fn("KanbanService.randomId")(function* (prefix: string) {
      const id = yield* crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) => serviceError("generate-id", cause)),
      );
      return `${prefix}-${id}`;
    });

    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

    const projectIdsForOrganization = Effect.fn("KanbanService.projectIdsForOrganization")(
      function* (organizationId: string) {
        const rows = yield* db(
          "list-organization-projects",
          sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId"
          FROM kanban_organization_projects
          WHERE organization_id = ${organizationId}
          ORDER BY project_id ASC
        `,
        );
        return rows.map((row) => ProjectId.make(row.projectId));
      },
    );

    const projectIdsForBoard = Effect.fn("KanbanService.projectIdsForBoard")(function* (
      boardId: string,
    ) {
      const rows = yield* db(
        "list-board-projects",
        sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId"
          FROM kanban_board_projects
          WHERE board_id = ${boardId}
          ORDER BY project_id ASC
        `,
      );
      return rows.map((row) => ProjectId.make(row.projectId));
    });

    const organizationFromRow = Effect.fn("KanbanService.organizationFromRow")(function* (
      row: OrganizationRow,
    ) {
      return {
        id: OrganizationId.make(row.organizationId),
        name: row.name,
        projectIds: yield* projectIdsForOrganization(row.organizationId),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } satisfies KanbanOrganization;
    });

    const boardSummaryFromRow = Effect.fn("KanbanService.boardSummaryFromRow")(function* (
      row: BoardRow,
    ) {
      return {
        id: KanbanBoardId.make(row.boardId),
        organizationId: OrganizationId.make(row.organizationId),
        name: row.name,
        source: row.source,
        projectIds: yield* projectIdsForBoard(row.boardId),
        baseBranch: row.baseBranch,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } satisfies KanbanBoardSummary;
    });

    const listOrganizationRows = () =>
      db(
        "list-organizations",
        sql<OrganizationRow>`
          SELECT
            organization_id AS "organizationId",
            name,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM kanban_organizations
          ORDER BY name COLLATE NOCASE ASC, organization_id ASC
        `,
      );

    const listBoardRows = () =>
      db(
        "list-boards",
        sql<BoardRow>`
          SELECT
            board_id AS "boardId",
            organization_id AS "organizationId",
            name,
            source,
            base_branch AS "baseBranch",
            jira_base_url AS "jiraBaseUrl",
            jira_email AS "jiraEmail",
            jira_board_id AS "jiraBoardId",
            jira_jql AS "jiraJql",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM kanban_boards
          ORDER BY created_at ASC, board_id ASC
        `,
      );

    const findOrganizationRow = Effect.fn("KanbanService.findOrganizationRow")(function* (
      organizationId: string,
    ) {
      const rows = yield* db(
        "get-organization",
        sql<OrganizationRow>`
          SELECT
            organization_id AS "organizationId",
            name,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM kanban_organizations
          WHERE organization_id = ${organizationId}
        `,
      );
      const row = rows[0];
      if (!row)
        return yield* serviceError("get-organization", new Error("Organization not found."));
      return row;
    });

    const findBoardRow = Effect.fn("KanbanService.findBoardRow")(function* (boardId: string) {
      const rows = yield* db(
        "get-board",
        sql<BoardRow>`
          SELECT
            board_id AS "boardId",
            organization_id AS "organizationId",
            name,
            source,
            base_branch AS "baseBranch",
            jira_base_url AS "jiraBaseUrl",
            jira_email AS "jiraEmail",
            jira_board_id AS "jiraBoardId",
            jira_jql AS "jiraJql",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM kanban_boards
          WHERE board_id = ${boardId}
        `,
      );
      const row = rows[0];
      if (!row) return yield* serviceError("get-board", new Error("Board not found."));
      return row;
    });

    const assertActiveProjects = Effect.fn("KanbanService.assertActiveProjects")(function* (
      projectIds: ReadonlyArray<ProjectId>,
    ) {
      if (projectIds.length === 0) return;
      const rows = yield* db(
        "list-active-projects",
        sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId"
          FROM projection_projects
          WHERE deleted_at IS NULL
        `,
      );
      const active = new Set(rows.map((row) => row.projectId));
      const missing = projectIds.find((projectId) => !active.has(projectId));
      if (missing) {
        return yield* serviceError(
          "validate-projects",
          new Error(`Project '${missing}' does not exist on this environment.`),
        );
      }
    });

    const assertProjectsBelongToOrganization = Effect.fn(
      "KanbanService.assertProjectsBelongToOrganization",
    )(function* (organizationId: OrganizationId, projectIds: ReadonlyArray<ProjectId>) {
      const assigned = new Set(yield* projectIdsForOrganization(organizationId));
      const foreign = projectIds.find((projectId) => !assigned.has(projectId));
      if (foreign) {
        return yield* serviceError(
          "validate-board-projects",
          new Error(`Project '${foreign}' is not assigned to this organization.`),
        );
      }
    });

    const replaceBoardProjects = Effect.fn("KanbanService.replaceBoardProjects")(function* (
      boardId: KanbanBoardId,
      organizationId: OrganizationId,
      projectIds: ReadonlyArray<ProjectId>,
    ) {
      yield* assertProjectsBelongToOrganization(organizationId, projectIds);
      yield* db(
        "replace-board-projects",
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`DELETE FROM kanban_board_projects WHERE board_id = ${boardId}`;
            for (const projectId of new Set(projectIds)) {
              yield* sql`
                INSERT INTO kanban_board_projects (board_id, project_id)
                VALUES (${boardId}, ${projectId})
              `;
            }
          }),
        ),
      );
    });

    const importLegacyJira = Effect.fn("KanbanService.importLegacyJira")(function* () {
      const status = yield* jira.getStatus.pipe(
        Effect.mapError((cause) => serviceError("read-legacy-jira", cause)),
      );
      const config = status.configuration;
      if (!status.configured || !config) return;

      const projectRows = yield* db(
        "find-legacy-project",
        sql<{ readonly projectId: string }>`
          SELECT project_id AS "projectId"
          FROM projection_projects
          WHERE workspace_root = ${config.projectPath} AND deleted_at IS NULL
          LIMIT 1
        `,
      );
      const organizationId = OrganizationId.make(yield* randomId("org"));
      const boardId = KanbanBoardId.make(yield* randomId("board"));
      const timestamp = yield* nowIso;
      const organizationName = legacyOrganizationName(config.baseUrl);
      yield* db(
        "import-legacy-jira",
        sql.withTransaction(
          Effect.gen(function* () {
            const counts = yield* sql<{ readonly count: number }>`
              SELECT COUNT(*) AS count FROM kanban_boards
            `;
            if ((counts[0]?.count ?? 0) > 0) return;
            yield* sql`
              INSERT INTO kanban_organizations (organization_id, name, created_at, updated_at)
              VALUES (${organizationId}, ${organizationName}, ${timestamp}, ${timestamp})
            `;
            const projectId = projectRows[0]?.projectId;
            if (projectId) {
              yield* sql`
                INSERT INTO kanban_organization_projects (project_id, organization_id)
                VALUES (${projectId}, ${organizationId})
              `;
            }
            yield* sql`
              INSERT INTO kanban_boards (
                board_id, organization_id, name, source, base_branch,
                jira_base_url, jira_email, jira_board_id, jira_jql, created_at, updated_at
              ) VALUES (
                ${boardId}, ${organizationId}, ${`Jira board ${config.boardId}`}, 'jira',
                ${config.baseBranch}, ${config.baseUrl}, ${config.email}, ${config.boardId},
                ${config.jql}, ${timestamp}, ${timestamp}
              )
            `;
            if (projectId) {
              yield* sql`
                INSERT INTO kanban_board_projects (board_id, project_id)
                VALUES (${boardId}, ${projectId})
              `;
            }
          }),
        ),
      );
    });

    const catalog = Effect.fn("KanbanService.catalog")(function* () {
      yield* importLegacyJira();
      const [organizationRows, boardRows] = yield* Effect.all([
        listOrganizationRows(),
        listBoardRows(),
      ]);
      return {
        organizations: yield* Effect.forEach(organizationRows, organizationFromRow),
        boards: yield* Effect.forEach(boardRows, boardSummaryFromRow),
      } satisfies KanbanCatalog;
    });

    const createOrganization = Effect.fn("KanbanService.createOrganization")(function* (
      input: KanbanCreateOrganizationInput,
    ) {
      const organizationId = OrganizationId.make(yield* randomId("org"));
      const timestamp = yield* nowIso;
      yield* db(
        "create-organization",
        sql`
          INSERT INTO kanban_organizations (organization_id, name, created_at, updated_at)
          VALUES (${organizationId}, ${input.name}, ${timestamp}, ${timestamp})
        `,
      );
      return yield* organizationFromRow({
        organizationId,
        name: input.name,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const updateOrganization = Effect.fn("KanbanService.updateOrganization")(function* (
      input: KanbanUpdateOrganizationInput,
    ) {
      const row = yield* findOrganizationRow(input.organizationId);
      yield* assertActiveProjects(input.projectIds);
      const timestamp = yield* nowIso;
      const selected = new Set(input.projectIds);
      yield* db(
        "update-organization",
        sql.withTransaction(
          Effect.gen(function* () {
            const current = yield* sql<{ readonly projectId: string }>`
              SELECT project_id AS "projectId"
              FROM kanban_organization_projects
              WHERE organization_id = ${input.organizationId}
            `;
            for (const { projectId } of current) {
              if (!selected.has(ProjectId.make(projectId))) {
                yield* sql`
                  DELETE FROM kanban_board_projects
                  WHERE project_id = ${projectId}
                    AND board_id IN (
                      SELECT board_id FROM kanban_boards
                      WHERE organization_id = ${input.organizationId}
                    )
                `;
                yield* sql`
                  DELETE FROM kanban_organization_projects
                  WHERE project_id = ${projectId}
                `;
              }
            }
            for (const projectId of selected) {
              yield* sql`
                DELETE FROM kanban_board_projects
                WHERE project_id = ${projectId}
                  AND board_id IN (
                    SELECT board_id FROM kanban_boards
                    WHERE organization_id != ${input.organizationId}
                  )
              `;
              yield* sql`
                INSERT INTO kanban_organization_projects (project_id, organization_id)
                VALUES (${projectId}, ${input.organizationId})
                ON CONFLICT (project_id) DO UPDATE SET organization_id = excluded.organization_id
              `;
            }
            yield* sql`
              UPDATE kanban_organizations
              SET name = ${input.name}, updated_at = ${timestamp}
              WHERE organization_id = ${input.organizationId}
            `;
          }),
        ),
      );
      return yield* organizationFromRow({ ...row, name: input.name, updatedAt: timestamp });
    });

    const deleteOrganization = Effect.fn("KanbanService.deleteOrganization")(function* (
      input: KanbanDeleteOrganizationInput,
    ) {
      yield* findOrganizationRow(input.organizationId);
      const boards = yield* db(
        "check-organization-boards",
        sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM kanban_boards
          WHERE organization_id = ${input.organizationId}
        `,
      );
      if ((boards[0]?.count ?? 0) > 0) {
        return yield* serviceError(
          "delete-organization",
          new Error("Delete this organization's boards before deleting the organization."),
        );
      }
      yield* db(
        "delete-organization",
        sql`DELETE FROM kanban_organizations WHERE organization_id = ${input.organizationId}`,
      );
      yield* secretStore.remove(jiraSecretName(input.organizationId)).pipe(Effect.ignore);
      return { deleted: true } satisfies KanbanDeleteResult;
    });

    const createBoardRow = Effect.fn("KanbanService.createBoardRow")(function* (input: {
      readonly organizationId: OrganizationId;
      readonly name: string;
      readonly source: "native" | "jira";
      readonly projectIds: ReadonlyArray<ProjectId>;
      readonly baseBranch: string;
      readonly jiraBaseUrl?: string;
      readonly jiraEmail?: string;
      readonly jiraBoardId?: number;
      readonly jiraJql?: string;
    }) {
      yield* findOrganizationRow(input.organizationId);
      yield* assertProjectsBelongToOrganization(input.organizationId, input.projectIds);
      const boardId = KanbanBoardId.make(yield* randomId("board"));
      const timestamp = yield* nowIso;
      yield* db(
        "create-board",
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO kanban_boards (
                board_id, organization_id, name, source, base_branch,
                jira_base_url, jira_email, jira_board_id, jira_jql, created_at, updated_at
              ) VALUES (
                ${boardId}, ${input.organizationId}, ${input.name}, ${input.source},
                ${input.baseBranch}, ${input.jiraBaseUrl ?? null}, ${input.jiraEmail ?? null},
                ${input.jiraBoardId ?? null}, ${input.jiraJql ?? null}, ${timestamp}, ${timestamp}
              )
            `;
            for (const projectId of new Set(input.projectIds)) {
              yield* sql`
                INSERT INTO kanban_board_projects (board_id, project_id)
                VALUES (${boardId}, ${projectId})
              `;
            }
          }),
        ),
      );
      return yield* boardSummaryFromRow({
        boardId,
        organizationId: input.organizationId,
        name: input.name,
        source: input.source,
        baseBranch: input.baseBranch,
        jiraBaseUrl: input.jiraBaseUrl ?? null,
        jiraEmail: input.jiraEmail ?? null,
        jiraBoardId: input.jiraBoardId ?? null,
        jiraJql: input.jiraJql ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const createNativeBoard = Effect.fn("KanbanService.createNativeBoard")(function* (
      input: KanbanCreateNativeBoardInput,
    ) {
      return yield* createBoardRow({ ...input, source: "native" });
    });

    const loadJiraToken = Effect.fn("KanbanService.loadJiraToken")(function* (
      organizationId: OrganizationId,
    ) {
      const organizationToken = yield* secretStore
        .get(jiraSecretName(organizationId))
        .pipe(Effect.mapError((cause) => serviceError("read-jira-secret", cause)));
      if (Option.isSome(organizationToken)) return textDecoder.decode(organizationToken.value);
      const legacyToken = yield* secretStore
        .get("jira-api-token")
        .pipe(Effect.mapError((cause) => serviceError("read-jira-secret", cause)));
      if (Option.isSome(legacyToken)) return textDecoder.decode(legacyToken.value);
      const environmentToken = process.env.T3CODE_JIRA_API_TOKEN?.trim();
      if (environmentToken) return environmentToken;
      return yield* serviceError(
        "read-jira-secret",
        new Error("A Jira API token has not been configured for this organization."),
      );
    });

    const createJiraBoard = Effect.fn("KanbanService.createJiraBoard")(function* (
      input: KanbanCreateJiraBoardInput,
    ) {
      yield* findOrganizationRow(input.organizationId);
      yield* assertProjectsBelongToOrganization(input.organizationId, input.projectIds);
      const existingJiraBoards = yield* db(
        "check-organization-jira-connection",
        sql<Pick<BoardRow, "jiraBaseUrl" | "jiraEmail">>`
          SELECT jira_base_url AS "jiraBaseUrl", jira_email AS "jiraEmail"
          FROM kanban_boards
          WHERE organization_id = ${input.organizationId} AND source = 'jira'
          LIMIT 1
        `,
      );
      const existingJiraBoard = existingJiraBoards[0];
      const normalizedBaseUrl = input.baseUrl.replace(/\/+$/, "");
      if (
        existingJiraBoard &&
        (existingJiraBoard.jiraBaseUrl !== normalizedBaseUrl ||
          existingJiraBoard.jiraEmail !== input.email)
      ) {
        return yield* serviceError(
          "create-jira-board",
          new Error("An organisation can connect to one Jira site and account."),
        );
      }
      const apiToken = input.apiToken ?? (yield* loadJiraToken(input.organizationId));
      const discovery = yield* jira
        .discoverBoards({ baseUrl: input.baseUrl, email: input.email, apiToken })
        .pipe(Effect.mapError((cause) => serviceError("discover-jira-boards", cause)));
      const remoteBoard = discovery.boards.find((board) => board.id === input.jiraBoardId);
      if (!remoteBoard) {
        return yield* serviceError(
          "create-jira-board",
          new Error("The selected Jira board is not available to this account."),
        );
      }
      if (input.apiToken) {
        yield* secretStore
          .set(jiraSecretName(input.organizationId), textEncoder.encode(input.apiToken))
          .pipe(Effect.mapError((cause) => serviceError("write-jira-secret", cause)));
      }
      return yield* createBoardRow({
        organizationId: input.organizationId,
        name: remoteBoard.name,
        source: "jira",
        projectIds: input.projectIds,
        baseBranch: input.baseBranch,
        jiraBaseUrl: normalizedBaseUrl,
        jiraEmail: input.email,
        jiraBoardId: input.jiraBoardId,
        jiraJql: input.jql,
      });
    });

    const updateBoard = Effect.fn("KanbanService.updateBoard")(function* (
      input: KanbanUpdateBoardInput,
    ) {
      const row = yield* findBoardRow(input.boardId);
      const timestamp = yield* nowIso;
      yield* replaceBoardProjects(
        input.boardId,
        OrganizationId.make(row.organizationId),
        input.projectIds,
      );
      yield* db(
        "update-board",
        sql`
          UPDATE kanban_boards
          SET name = ${input.name}, base_branch = ${input.baseBranch}, updated_at = ${timestamp}
          WHERE board_id = ${input.boardId}
        `,
      );
      return yield* boardSummaryFromRow({
        ...row,
        name: input.name,
        baseBranch: input.baseBranch,
        updatedAt: timestamp,
      });
    });

    const deleteBoard = Effect.fn("KanbanService.deleteBoard")(function* (input: KanbanBoardInput) {
      yield* findBoardRow(input.boardId);
      yield* db("delete-board", sql`DELETE FROM kanban_boards WHERE board_id = ${input.boardId}`);
      return { deleted: true } satisfies KanbanDeleteResult;
    });

    const nativeCard = (row: NativeCardRow): KanbanCard => {
      const key = `T3-${row.cardNumber}`;
      const statusName =
        NATIVE_COLUMNS.find((column) => column.statusIds.includes(row.statusId as never))?.name ??
        row.statusId;
      return {
        id: KanbanCardId.make(row.cardId),
        key,
        summary: row.summary,
        description: row.description,
        statusId: row.statusId,
        statusName,
        issueType: "Task",
        priority: null,
        assignee: null,
        epic: null,
        updatedAt: row.updatedAt,
        url: null,
        branchName: jiraBranchName(key, row.summary),
        pullRequestTitle: `[${key}] ${row.summary}`,
      };
    };

    const listNativeCards = Effect.fn("KanbanService.listNativeCards")(function* (boardId: string) {
      const rows = yield* db(
        "list-native-cards",
        sql<NativeCardRow>`
          SELECT
            card_id AS "cardId",
            board_id AS "boardId",
            card_number AS "cardNumber",
            summary,
            description,
            status_id AS "statusId",
            sort_order AS "sortOrder",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM kanban_native_cards
          WHERE board_id = ${boardId}
          ORDER BY sort_order ASC, card_number ASC
        `,
      );
      return rows.map(nativeCard);
    });

    const jiraConfigForRow = Effect.fn("KanbanService.jiraConfigForRow")(function* (
      row: BoardRow,
    ): Effect.fn.Return<JiraRuntimeConfig, KanbanServiceError> {
      if (!row.jiraBaseUrl || !row.jiraEmail || !row.jiraBoardId) {
        return yield* serviceError(
          "load-jira-board",
          new Error("Jira board configuration is incomplete."),
        );
      }
      return {
        baseUrl: row.jiraBaseUrl,
        email: row.jiraEmail,
        apiToken: yield* loadJiraToken(OrganizationId.make(row.organizationId)),
        boardId: row.jiraBoardId,
        jql: row.jiraJql ?? "",
        projectPath: row.boardId,
        baseBranch: row.baseBranch,
      };
    });

    const getBoard = Effect.fn("KanbanService.getBoard")(function* (input: KanbanBoardInput) {
      const row = yield* findBoardRow(input.boardId);
      const projectIds = yield* projectIdsForBoard(row.boardId);
      if (row.source === "native") {
        return {
          id: KanbanBoardId.make(row.boardId),
          organizationId: OrganizationId.make(row.organizationId),
          name: row.name,
          source: "native",
          projectIds,
          baseBranch: row.baseBranch,
          url: null,
          columns: NATIVE_COLUMNS,
          cards: yield* listNativeCards(row.boardId),
          currentUserAccountId: null,
        } satisfies KanbanBoard;
      }
      const board = yield* jira
        .getBoardForConfig(yield* jiraConfigForRow(row))
        .pipe(Effect.mapError((cause) => serviceError("load-jira-board", cause)));
      return {
        id: KanbanBoardId.make(row.boardId),
        organizationId: OrganizationId.make(row.organizationId),
        name: board.name,
        source: "jira",
        projectIds,
        baseBranch: row.baseBranch,
        url: board.url,
        columns: board.columns,
        cards: board.issues.map((issue) => ({
          ...issue,
          id: KanbanCardId.make(issue.id),
        })),
        currentUserAccountId: board.currentUserAccountId,
      } satisfies KanbanBoard;
    });

    const getProjectBoards = Effect.fn("KanbanService.getProjectBoards")(function* (
      input: KanbanProjectBoardsInput,
    ) {
      const organizationRows = yield* db(
        "get-project-organization",
        sql<OrganizationRow>`
          SELECT
            organizations.organization_id AS "organizationId",
            organizations.name,
            organizations.created_at AS "createdAt",
            organizations.updated_at AS "updatedAt"
          FROM kanban_organization_projects projects
          JOIN kanban_organizations organizations
            ON organizations.organization_id = projects.organization_id
          WHERE projects.project_id = ${input.projectId}
        `,
      );
      const boardRows = yield* db(
        "get-project-boards",
        sql<BoardRow>`
          SELECT
            boards.board_id AS "boardId",
            boards.organization_id AS "organizationId",
            boards.name,
            boards.source,
            boards.base_branch AS "baseBranch",
            boards.jira_base_url AS "jiraBaseUrl",
            boards.jira_email AS "jiraEmail",
            boards.jira_board_id AS "jiraBoardId",
            boards.jira_jql AS "jiraJql",
            boards.created_at AS "createdAt",
            boards.updated_at AS "updatedAt"
          FROM kanban_board_projects projects
          JOIN kanban_boards boards ON boards.board_id = projects.board_id
          WHERE projects.project_id = ${input.projectId}
          ORDER BY boards.created_at ASC, boards.board_id ASC
        `,
      );
      return {
        organization: organizationRows[0] ? yield* organizationFromRow(organizationRows[0]) : null,
        boards: yield* Effect.forEach(boardRows, boardSummaryFromRow),
      } satisfies KanbanProjectBoards;
    });

    const lookupProjectCards = Effect.fn("KanbanService.lookupProjectCards")(function* (
      input: KanbanLookupProjectCardsInput,
    ) {
      const projectBoards = yield* getProjectBoards({ projectId: input.projectId });
      const issueKeys = new Set(input.issueKeys.map((key) => key.trim().toUpperCase()));
      const matches = yield* Effect.forEach(
        projectBoards.boards,
        Effect.fnUntraced(function* (summary) {
          const row = yield* findBoardRow(summary.id);
          if (row.source === "native") {
            const board = yield* getBoard({ boardId: summary.id });
            return board.cards
              .filter((card) => issueKeys.has(card.key.toUpperCase()))
              .map((card) => ({ board: summary, card }));
          }
          const lookup = yield* jira
            .lookupIssuesForConfig(yield* jiraConfigForRow(row), {
              issueKeys: [...issueKeys],
            })
            .pipe(Effect.mapError((cause) => serviceError("lookup-jira-cards", cause)));
          return lookup.issues.map((issue) => ({
            board: summary,
            card: { ...issue, id: KanbanCardId.make(issue.id) },
          }));
        }),
        { concurrency: 4 },
      );
      const seen = new Set<string>();
      return {
        matches: matches.flat().filter(({ board, card }) => {
          const key = `${board.id}:${card.key}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      } satisfies KanbanLookupProjectCardsResult;
    });

    const requireNativeBoard = Effect.fn("KanbanService.requireNativeBoard")(function* (
      boardId: KanbanBoardId,
    ) {
      const row = yield* findBoardRow(boardId);
      if (row.source !== "native") {
        return yield* serviceError(
          "native-card",
          new Error("This operation is only available for native boards."),
        );
      }
      return row;
    });

    const findNativeCardRow = Effect.fn("KanbanService.findNativeCardRow")(function* (
      boardId: KanbanBoardId,
      cardId: KanbanCardId,
    ) {
      const rows = yield* db(
        "get-native-card",
        sql<NativeCardRow>`
          SELECT
            card_id AS "cardId", board_id AS "boardId", card_number AS "cardNumber",
            summary, description, status_id AS "statusId", sort_order AS "sortOrder",
            created_at AS "createdAt", updated_at AS "updatedAt"
          FROM kanban_native_cards
          WHERE board_id = ${boardId} AND card_id = ${cardId}
        `,
      );
      const row = rows[0];
      if (!row) return yield* serviceError("get-native-card", new Error("Card not found."));
      return row;
    });

    const createCard = Effect.fn("KanbanService.createCard")(function* (
      input: KanbanCreateCardInput,
    ) {
      yield* requireNativeBoard(input.boardId);
      const cardId = KanbanCardId.make(yield* randomId("card"));
      const timestamp = yield* nowIso;
      const counts = yield* db(
        "next-native-card-number",
        sql<{ readonly cardNumber: number; readonly sortOrder: number }>`
          SELECT
            COALESCE(MAX(card_number), 0) + 1 AS "cardNumber",
            COALESCE(MAX(sort_order), 0) + 1 AS "sortOrder"
          FROM kanban_native_cards
          WHERE board_id = ${input.boardId}
        `,
      );
      const cardNumber = counts[0]?.cardNumber ?? 1;
      const sortOrder = counts[0]?.sortOrder ?? 1;
      yield* db(
        "create-native-card",
        sql`
          INSERT INTO kanban_native_cards (
            card_id, board_id, card_number, summary, description, status_id,
            sort_order, created_at, updated_at
          ) VALUES (
            ${cardId}, ${input.boardId}, ${cardNumber}, ${input.summary}, ${input.description},
            'todo', ${sortOrder}, ${timestamp}, ${timestamp}
          )
        `,
      );
      return nativeCard({
        cardId,
        boardId: input.boardId,
        cardNumber,
        summary: input.summary,
        description: input.description,
        statusId: "todo",
        sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const updateCard = Effect.fn("KanbanService.updateCard")(function* (
      input: KanbanUpdateCardInput,
    ) {
      yield* requireNativeBoard(input.boardId);
      const row = yield* findNativeCardRow(input.boardId, input.cardId);
      const timestamp = yield* nowIso;
      yield* db(
        "update-native-card",
        sql`
          UPDATE kanban_native_cards
          SET summary = ${input.summary}, description = ${input.description}, updated_at = ${timestamp}
          WHERE board_id = ${input.boardId} AND card_id = ${input.cardId}
        `,
      );
      return nativeCard({
        ...row,
        summary: input.summary,
        description: input.description,
        updatedAt: timestamp,
      });
    });

    const moveCard = Effect.fn("KanbanService.moveCard")(function* (input: KanbanMoveCardInput) {
      const boardRow = yield* findBoardRow(input.boardId);
      if (
        !NATIVE_COLUMNS.some((column) => column.id === input.targetColumnId) &&
        boardRow.source === "native"
      ) {
        return yield* serviceError("move-card", new Error("Unknown native board column."));
      }
      if (boardRow.source === "native") {
        const row = yield* findNativeCardRow(input.boardId, input.cardId);
        const timestamp = yield* nowIso;
        const orderRows = yield* db(
          "next-native-card-order",
          sql<{ readonly sortOrder: number }>`
            SELECT COALESCE(MAX(sort_order), 0) + 1 AS "sortOrder"
            FROM kanban_native_cards
            WHERE board_id = ${input.boardId} AND status_id = ${input.targetColumnId}
          `,
        );
        const sortOrder = orderRows[0]?.sortOrder ?? 1;
        yield* db(
          "move-native-card",
          sql`
            UPDATE kanban_native_cards
            SET status_id = ${input.targetColumnId}, sort_order = ${sortOrder}, updated_at = ${timestamp}
            WHERE board_id = ${input.boardId} AND card_id = ${input.cardId}
          `,
        );
        return nativeCard({
          ...row,
          statusId: input.targetColumnId,
          sortOrder,
          updatedAt: timestamp,
        });
      }
      const board = yield* getBoard({ boardId: input.boardId });
      const card = board.cards.find((candidate) => candidate.id === input.cardId);
      if (!card) return yield* serviceError("move-jira-card", new Error("Card not found."));
      yield* jira
        .transitionIssueForConfig(yield* jiraConfigForRow(boardRow), {
          issueKey: card.key,
          targetColumnId: input.targetColumnId,
        })
        .pipe(Effect.mapError((cause) => serviceError("move-jira-card", cause)));
      const refreshed = yield* getBoard({ boardId: input.boardId });
      const moved = refreshed.cards.find((candidate) => candidate.id === input.cardId);
      if (!moved)
        return yield* serviceError(
          "move-jira-card",
          new Error("Moved card could not be reloaded."),
        );
      return moved;
    });

    const assignCard = Effect.fn("KanbanService.assignCard")(function* (
      input: KanbanAssignCardInput,
    ) {
      const row = yield* findBoardRow(input.boardId);
      const board = yield* getBoard({ boardId: input.boardId });
      const card = board.cards.find((candidate) => candidate.id === input.cardId);
      if (!card) return yield* serviceError("assign-card", new Error("Card not found."));
      if (row.source === "native" || card.assignee !== null) return card;
      const assignment = yield* jira
        .assignIssueForConfig(yield* jiraConfigForRow(row), { issueKey: card.key })
        .pipe(Effect.mapError((cause) => serviceError("assign-jira-card", cause)));
      return { ...card, assignee: assignment.assignee };
    });

    const deleteCard = Effect.fn("KanbanService.deleteCard")(function* (
      input: KanbanDeleteCardInput,
    ) {
      yield* requireNativeBoard(input.boardId);
      yield* findNativeCardRow(input.boardId, input.cardId);
      yield* db(
        "delete-native-card",
        sql`
          DELETE FROM kanban_native_cards
          WHERE board_id = ${input.boardId} AND card_id = ${input.cardId}
        `,
      );
      return { deleted: true } satisfies KanbanDeleteResult;
    });

    return KanbanService.of({
      catalog: catalog(),
      createOrganization,
      updateOrganization,
      deleteOrganization,
      createNativeBoard,
      createJiraBoard,
      updateBoard,
      deleteBoard,
      getBoard,
      getProjectBoards,
      lookupProjectCards,
      createCard,
      updateCard,
      moveCard,
      assignCard,
      deleteCard,
    });
  }),
);
