import * as NodeBuffer from "node:buffer";

import {
  PositiveInt,
  TrimmedNonEmptyString,
  TrimmedString,
  type JiraAssignIssueInput,
  type JiraAssignIssueResult,
  type JiraAvailableBoard,
  type JiraBoard,
  type JiraBoardColumn,
  type JiraBoardDiscoveryResult,
  type JiraBoardIssue,
  type JiraDisconnectResult,
  type JiraDiscoverBoardsInput,
  type JiraIntegrationConfiguration,
  type JiraIntegrationStatus,
  type JiraLookupIssuesInput,
  type JiraLookupIssuesResult,
  type JiraSaveConfigurationInput,
  type JiraTransitionIssueInput,
  type JiraTransitionIssueResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";

const JiraConfigFile = Schema.Struct({
  baseUrl: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  boardId: PositiveInt,
  jql: TrimmedString,
  projectPath: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
});
type JiraConfig = typeof JiraConfigFile.Type & { readonly apiToken: string };

const JiraAdfNode = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const decodeJiraAdfNode = Schema.decodeUnknownOption(JiraAdfNode);
const decodeJiraConfigFile = Schema.decodeEffect(Schema.fromJsonString(JiraConfigFile));
const encodeJiraConfigFile = Schema.encodeEffect(Schema.fromJsonString(JiraConfigFile));

const JiraUser = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
  avatarUrls: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const JiraParent = Schema.Struct({
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    issuetype: Schema.optionalKey(
      Schema.Struct({
        name: Schema.String,
      }),
    ),
  }),
});

const JiraIssue = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  fields: Schema.Struct({
    summary: Schema.String,
    description: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, JiraAdfNode]))),
    status: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
    issuetype: Schema.Struct({
      name: Schema.String,
    }),
    priority: Schema.optionalKey(
      Schema.NullOr(
        Schema.Struct({
          name: Schema.String,
        }),
      ),
    ),
    assignee: Schema.optionalKey(Schema.NullOr(JiraUser)),
    parent: Schema.optionalKey(Schema.NullOr(JiraParent)),
    updated: Schema.String,
  }),
});

const JiraSearchResponse = Schema.Struct({
  issues: Schema.Array(JiraIssue),
  nextPageToken: Schema.optionalKey(Schema.String),
});

const JiraBoardLocation = Schema.Struct({
  displayName: Schema.optionalKey(Schema.String),
  projectKey: Schema.optionalKey(Schema.String),
  projectName: Schema.optionalKey(Schema.String),
});

const JiraBoardDetailsResponse = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  type: Schema.String,
  location: Schema.optionalKey(Schema.NullOr(JiraBoardLocation)),
});

const JiraSprintsResponse = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      name: Schema.String,
      state: Schema.String,
    }),
  ),
});

const JiraBoardConfigResponse = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  filter: Schema.optionalKey(
    Schema.Struct({
      id: Schema.Union([Schema.Int, Schema.String]),
    }),
  ),
  columnConfig: Schema.Struct({
    columns: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        statuses: Schema.Array(
          Schema.Struct({
            id: Schema.String,
          }),
        ),
      }),
    ),
  }),
});

const JiraMyselfResponse = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
});

const JiraBoardsResponse = Schema.Struct({
  startAt: Schema.Int,
  maxResults: Schema.Int,
  total: Schema.Int,
  values: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      name: Schema.String,
      type: Schema.String,
      location: Schema.optionalKey(Schema.NullOr(JiraBoardLocation)),
    }),
  ),
});

const JiraTransitionsResponse = Schema.Struct({
  transitions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      to: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
      }),
    }),
  ),
});

export class JiraServiceError extends Schema.TaggedErrorClass<JiraServiceError>()(
  "JiraServiceError",
  {
    operation: Schema.Literals([
      "check-config",
      "read-config",
      "decode-config",
      "load-board",
      "load-issues",
      "load-user",
      "load-transitions",
      "transition-issue",
      "assign-issue",
      "resolve-transition",
      "read-secret",
      "write-secret",
      "remove-secret",
      "write-config",
      "remove-config",
      "discover-boards",
    ]),
    cause: Schema.Defect(),
  },
) {}

export class JiraService extends Context.Service<
  JiraService,
  {
    readonly getStatus: Effect.Effect<JiraIntegrationStatus, JiraServiceError>;
    readonly discoverBoards: (
      input: JiraDiscoverBoardsInput,
    ) => Effect.Effect<JiraBoardDiscoveryResult, JiraServiceError>;
    readonly saveConfiguration: (
      input: JiraSaveConfigurationInput,
    ) => Effect.Effect<JiraIntegrationStatus, JiraServiceError>;
    readonly disconnect: Effect.Effect<JiraDisconnectResult, JiraServiceError>;
    readonly getBoard: Effect.Effect<JiraBoard, JiraServiceError>;
    readonly transitionIssue: (
      input: JiraTransitionIssueInput,
    ) => Effect.Effect<JiraTransitionIssueResult, JiraServiceError>;
    readonly assignIssue: (
      input: JiraAssignIssueInput,
    ) => Effect.Effect<JiraAssignIssueResult, JiraServiceError>;
    readonly lookupIssues: (
      input: JiraLookupIssuesInput,
    ) => Effect.Effect<JiraLookupIssuesResult, JiraServiceError>;
  }
>()("t3/jira/JiraService") {}

const SEARCH_FIELDS = [
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "parent",
  "updated",
] as const;

const requestError = (operation: JiraServiceError["operation"], cause: unknown): JiraServiceError =>
  new JiraServiceError({ operation, cause });

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function jiraClient(client: HttpClient.HttpClient, config: JiraCredentials): HttpClient.HttpClient {
  const authorization = `Basic ${NodeBuffer.Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
  return client.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.setHeader("authorization", authorization),
        HttpClientRequest.acceptJson,
      ),
    ),
    HttpClient.filterStatusOk,
  );
}

function adfNodeText(value: unknown): string {
  const decoded = decodeJiraAdfNode(value);
  if (decoded._tag === "None") {
    return "";
  }
  const node = decoded.value;
  if (node.type === "hardBreak") {
    return "\n";
  }
  const children = node.content?.map(adfNodeText).join("") ?? "";
  const suffix =
    node.type === "paragraph" ||
    node.type === "heading" ||
    node.type === "listItem" ||
    node.type === "blockquote"
      ? "\n"
      : "";
  return `${node.text ?? ""}${children}${suffix}`;
}

export function jiraDescriptionText(
  description: (typeof JiraIssue.Type)["fields"]["description"],
): string {
  if (typeof description === "string") {
    return description.trim();
  }
  if (!description) {
    return "";
  }
  return adfNodeText(description)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function jiraBranchName(issueKey: string, summary: string): string {
  const slug = summary
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug.length > 0 ? `${issueKey}-${slug}` : issueKey;
}

function boardColumns(config: typeof JiraBoardConfigResponse.Type): ReadonlyArray<JiraBoardColumn> {
  return config.columnConfig.columns.map((column, index) => ({
    id: `column-${index}`,
    name: column.name,
    statusIds: column.statuses.map((status) => status.id),
  }));
}

function boardIssue(baseUrl: string, issue: typeof JiraIssue.Type): JiraBoardIssue {
  const branchName = jiraBranchName(issue.key, issue.fields.summary);
  const assignee = issue.fields.assignee ?? null;
  const parent = issue.fields.parent ?? null;
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields.summary,
    description: jiraDescriptionText(issue.fields.description),
    statusId: issue.fields.status.id,
    statusName: issue.fields.status.name,
    issueType: issue.fields.issuetype.name,
    priority: issue.fields.priority?.name ?? null,
    assignee: assignee
      ? {
          accountId: assignee.accountId,
          displayName: assignee.displayName,
          avatarUrl: assignee.avatarUrls?.["24x24"] ?? null,
        }
      : null,
    epic:
      parent?.fields.issuetype?.name === "Epic"
        ? {
            key: parent.key,
            summary: parent.fields.summary,
          }
        : null,
    updatedAt: issue.fields.updated,
    url: `${baseUrl}/browse/${encodeURIComponent(issue.key)}`,
    branchName,
    pullRequestTitle: `[${issue.key}] ${issue.fields.summary}`,
  };
}

const JIRA_API_TOKEN_SECRET = "jira-api-token";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type JiraCredentials = Pick<JiraConfig, "baseUrl" | "email" | "apiToken">;

export const layer = Layer.effect(
  JiraService,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const serverConfig = yield* ServerConfig.ServerConfig;
    const secretStore = yield* ServerSecretStore.ServerSecretStore;
    const client = yield* HttpClient.HttpClient;

    const loadStoredToken = Effect.fn("JiraService.loadStoredToken")(function* () {
      const stored = yield* secretStore
        .get(JIRA_API_TOKEN_SECRET)
        .pipe(Effect.mapError((cause) => requestError("read-secret", cause)));
      return Option.match(stored, {
        onNone: () => undefined,
        onSome: (value) => textDecoder.decode(value).trim() || undefined,
      });
    });

    const resolveApiToken = Effect.fn("JiraService.resolveApiToken")(function* (
      explicitToken?: string,
    ) {
      const apiToken =
        explicitToken?.trim() ||
        (yield* loadStoredToken()) ||
        process.env.T3CODE_JIRA_API_TOKEN?.trim();
      if (!apiToken) {
        return yield* requestError(
          "decode-config",
          new Error("A Jira API token has not been configured."),
        );
      }
      return apiToken;
    });

    const readConfigFile = Effect.fn("JiraService.readConfigFile")(function* () {
      const raw = yield* fileSystem
        .readFileString(serverConfig.jiraConfigPath)
        .pipe(Effect.mapError((cause) => requestError("read-config", cause)));
      return yield* decodeJiraConfigFile(raw).pipe(
        Effect.mapError((cause) => requestError("decode-config", cause)),
      );
    });

    const getStatus = Effect.fn("JiraService.getStatus")(function* () {
      const [configExists, storedToken] = yield* Effect.all([
        fileSystem
          .exists(serverConfig.jiraConfigPath)
          .pipe(Effect.mapError((cause) => requestError("check-config", cause))),
        loadStoredToken(),
      ]);
      const hasApiToken = Boolean(storedToken || process.env.T3CODE_JIRA_API_TOKEN?.trim());
      const config = configExists ? yield* readConfigFile() : null;
      const configuration: JiraIntegrationConfiguration | null = config
        ? { ...config, hasApiToken }
        : null;
      return {
        configured: config !== null && hasApiToken,
        configPath: serverConfig.jiraConfigPath,
        configuration,
      } satisfies JiraIntegrationStatus;
    });

    const loadConfig = Effect.fn("JiraService.loadConfig")(function* () {
      const config = yield* readConfigFile();
      const apiToken = yield* resolveApiToken();
      return { ...config, apiToken } satisfies JiraConfig;
    });

    const loadBoardConfiguration = Effect.fn("JiraService.loadBoardConfiguration")(function* (
      config: JiraConfig,
    ) {
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      return yield* jiraClient(client, config)
        .get(`${baseUrl}/rest/agile/1.0/board/${config.boardId}/configuration`)
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(JiraBoardConfigResponse)),
          Effect.mapError((cause) => requestError("load-board", cause)),
        );
    });

    const loadBoardDetails = Effect.fn("JiraService.loadBoardDetails")(function* (
      config: JiraConfig,
    ) {
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      return yield* jiraClient(client, config)
        .get(`${baseUrl}/rest/agile/1.0/board/${config.boardId}`)
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(JiraBoardDetailsResponse)),
          Effect.mapError((cause) => requestError("load-board", cause)),
        );
    });

    const loadCurrentUser = Effect.fn("JiraService.loadCurrentUser")(function* (
      config: JiraCredentials,
    ) {
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      return yield* jiraClient(client, config)
        .get(`${baseUrl}/rest/api/3/myself`)
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(JiraMyselfResponse)),
          Effect.mapError((cause) => requestError("load-user", cause)),
        );
    });

    const loadIssues = Effect.fn("JiraService.loadIssues")(function* (
      config: JiraConfig,
      jql: string,
    ) {
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      const configuredClient = jiraClient(client, config);
      const issues: Array<typeof JiraIssue.Type> = [];
      let nextPageToken: string | undefined;

      do {
        const response = yield* HttpClientRequest.post(`${baseUrl}/rest/api/3/search/jql`).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            jql,
            fields: SEARCH_FIELDS,
            fieldsByKeys: true,
            maxResults: 100,
            ...(nextPageToken ? { nextPageToken } : {}),
          }),
          configuredClient.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(JiraSearchResponse)),
          Effect.mapError((cause) => requestError("load-issues", cause)),
        );
        issues.push(...response.issues);
        nextPageToken = response.nextPageToken;
      } while (nextPageToken && issues.length < 500);

      return issues;
    });

    const loadActiveSprintIssues = Effect.fn("JiraService.loadActiveSprintIssues")(function* (
      config: JiraConfig,
    ) {
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      const configuredClient = jiraClient(client, config);
      const sprintsUrl = new URL(`${baseUrl}/rest/agile/1.0/board/${config.boardId}/sprint`);
      sprintsUrl.searchParams.set("state", "active");
      sprintsUrl.searchParams.set("maxResults", "50");
      const sprints = yield* configuredClient.get(sprintsUrl.href).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(JiraSprintsResponse)),
        Effect.map((response) => response.values),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (sprints === null || sprints.length === 0) return null;

      const issues: Array<typeof JiraIssue.Type> = [];
      for (const sprint of sprints) {
        let nextPageToken: string | undefined;
        do {
          const issuesUrl = new URL(
            `${baseUrl}/rest/agile/1.0/board/${config.boardId}/sprint/${sprint.id}/issue`,
          );
          issuesUrl.searchParams.set("maxResults", "100");
          issuesUrl.searchParams.set("fields", SEARCH_FIELDS.join(","));
          if (nextPageToken) issuesUrl.searchParams.set("nextPageToken", nextPageToken);
          const response = yield* configuredClient.get(issuesUrl.href).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(JiraSearchResponse)),
            Effect.mapError((cause) => requestError("load-issues", cause)),
          );
          issues.push(...response.issues);
          nextPageToken = response.nextPageToken;
        } while (nextPageToken && issues.length < 500);
      }

      return issues;
    });

    const loadAvailableBoards = Effect.fn("JiraService.loadAvailableBoards")(function* (
      config: JiraCredentials,
    ) {
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      const configuredClient = jiraClient(client, config);
      const boards: JiraAvailableBoard[] = [];
      let startAt = 0;
      let total = 1;

      while (startAt < total && boards.length < 500) {
        const url = new URL(`${baseUrl}/rest/agile/1.0/board`);
        url.searchParams.set("startAt", String(startAt));
        url.searchParams.set("maxResults", "50");
        const response = yield* configuredClient.get(url.href).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(JiraBoardsResponse)),
          Effect.mapError((cause) => requestError("discover-boards", cause)),
        );
        boards.push(...response.values);
        total = response.total;
        if (response.values.length === 0) break;
        startAt = response.startAt + response.values.length;
      }

      return boards;
    });

    const discoverBoards = Effect.fn("JiraService.discoverBoards")(function* (
      input: JiraDiscoverBoardsInput,
    ) {
      const config = {
        baseUrl: normalizedBaseUrl(input.baseUrl),
        email: input.email,
        apiToken: yield* resolveApiToken(input.apiToken),
      } satisfies JiraCredentials;
      const [account, boards] = yield* Effect.all(
        [loadCurrentUser(config), loadAvailableBoards(config)],
        { concurrency: "unbounded" },
      );
      return {
        accountDisplayName: account.displayName?.trim() || input.email,
        boards,
      } satisfies JiraBoardDiscoveryResult;
    });

    const saveConfiguration = Effect.fn("JiraService.saveConfiguration")(function* (
      input: JiraSaveConfigurationInput,
    ) {
      const discovery = yield* discoverBoards({
        baseUrl: input.baseUrl,
        email: input.email,
        ...(input.apiToken ? { apiToken: input.apiToken } : {}),
      });
      if (!discovery.boards.some((board) => board.id === input.boardId)) {
        return yield* requestError(
          "discover-boards",
          new Error("The selected Jira board is not available to this account."),
        );
      }

      const config: typeof JiraConfigFile.Type = {
        baseUrl: normalizedBaseUrl(input.baseUrl),
        email: input.email,
        boardId: input.boardId,
        jql: input.jql,
        projectPath: input.projectPath,
        baseBranch: input.baseBranch,
      };
      if (input.apiToken) {
        yield* secretStore
          .set(JIRA_API_TOKEN_SECRET, textEncoder.encode(input.apiToken))
          .pipe(Effect.mapError((cause) => requestError("write-secret", cause)));
      }
      const encodedConfig = yield* encodeJiraConfigFile(config).pipe(
        Effect.mapError((cause) => requestError("write-config", cause)),
      );
      yield* writeFileStringAtomically({
        filePath: serverConfig.jiraConfigPath,
        contents: `${encodedConfig}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
        Effect.mapError((cause) => requestError("write-config", cause)),
      );
      return yield* getStatus();
    });

    const disconnect = Effect.fn("JiraService.disconnect")(function* () {
      const configExists = yield* fileSystem
        .exists(serverConfig.jiraConfigPath)
        .pipe(Effect.mapError((cause) => requestError("check-config", cause)));
      if (configExists) {
        yield* fileSystem
          .remove(serverConfig.jiraConfigPath)
          .pipe(Effect.mapError((cause) => requestError("remove-config", cause)));
      }
      yield* secretStore
        .remove(JIRA_API_TOKEN_SECRET)
        .pipe(Effect.mapError((cause) => requestError("remove-secret", cause)));
      return { disconnected: true } satisfies JiraDisconnectResult;
    });

    const getBoard = Effect.fn("JiraService.getBoard")(function* () {
      const config = yield* loadConfig();
      const [jiraBoard, boardDetails, currentUser] = yield* Effect.all(
        [loadBoardConfiguration(config), loadBoardDetails(config), loadCurrentUser(config)],
        { concurrency: "unbounded" },
      );
      let issues: ReadonlyArray<typeof JiraIssue.Type>;
      if (config.jql) {
        issues = yield* loadIssues(config, config.jql);
      } else {
        const activeSprintIssues = yield* loadActiveSprintIssues(config);
        if (activeSprintIssues !== null) {
          issues = activeSprintIssues;
        } else if (jiraBoard.filter) {
          issues = yield* loadIssues(
            config,
            `filter = ${String(jiraBoard.filter.id)} ORDER BY Rank ASC`,
          );
        } else {
          return yield* requestError(
            "load-issues",
            new Error("Configure JQL because this Jira board does not expose its saved filter."),
          );
        }
      }
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      const columns = boardColumns(jiraBoard);
      const boardStatusIds = new Set(columns.flatMap((column) => column.statusIds));
      return {
        id: String(jiraBoard.id),
        name:
          boardDetails.location?.projectName ??
          boardDetails.location?.displayName ??
          boardDetails.name,
        url: `${baseUrl}/secure/RapidBoard.jspa?rapidView=${jiraBoard.id}`,
        projectPath: config.projectPath,
        baseBranch: config.baseBranch,
        columns,
        issues: issues
          .filter((issue) => boardStatusIds.has(issue.fields.status.id))
          .map((issue) => boardIssue(baseUrl, issue)),
        currentUserAccountId: currentUser.accountId,
      } satisfies JiraBoard;
    });

    const transitionIssue = Effect.fn("JiraService.transitionIssue")(function* (
      input: JiraTransitionIssueInput,
    ) {
      const config = yield* loadConfig();
      const jiraBoard = yield* loadBoardConfiguration(config);
      const columns = boardColumns(jiraBoard);
      const targetColumn = columns.find((column) => column.id === input.targetColumnId);
      if (!targetColumn) {
        return yield* requestError("resolve-transition", new Error("Unknown Jira board column."));
      }

      const baseUrl = normalizedBaseUrl(config.baseUrl);
      const configuredClient = jiraClient(client, config);
      const transitions = yield* configuredClient
        .get(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/transitions`)
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(JiraTransitionsResponse)),
          Effect.mapError((cause) => requestError("load-transitions", cause)),
        );
      const transition = transitions.transitions.find((candidate) =>
        targetColumn.statusIds.includes(candidate.to.id),
      );
      if (!transition) {
        return yield* requestError(
          "resolve-transition",
          new Error(`No available transition moves ${input.issueKey} to ${targetColumn.name}.`),
        );
      }

      yield* HttpClientRequest.post(
        `${baseUrl}/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/transitions`,
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({ transition: { id: transition.id } }),
        configuredClient.execute,
        Effect.asVoid,
        Effect.mapError((cause) => requestError("transition-issue", cause)),
      );
      return {
        issueKey: input.issueKey,
        statusId: transition.to.id,
        statusName: transition.to.name,
      } satisfies JiraTransitionIssueResult;
    });

    const assignIssue = Effect.fn("JiraService.assignIssue")(function* (
      input: JiraAssignIssueInput,
    ) {
      const config = yield* loadConfig();
      const currentUser = yield* loadCurrentUser(config);
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      const configuredClient = jiraClient(client, config);

      yield* HttpClientRequest.put(
        `${baseUrl}/rest/api/3/issue/${encodeURIComponent(input.issueKey)}/assignee`,
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({ accountId: currentUser.accountId }),
        configuredClient.execute,
        Effect.asVoid,
        Effect.mapError((cause) => requestError("assign-issue", cause)),
      );

      return {
        issueKey: input.issueKey,
        assignee: {
          accountId: currentUser.accountId,
          displayName: currentUser.displayName ?? config.email,
          avatarUrl: null,
        },
      } satisfies JiraAssignIssueResult;
    });

    const lookupIssues = Effect.fn("JiraService.lookupIssues")(function* (
      input: JiraLookupIssuesInput,
    ) {
      const config = yield* loadConfig();
      const issueKeys = [...new Set(input.issueKeys.map((key) => key.trim().toUpperCase()))];
      const jqlKeys = issueKeys.map((key) => `"${key.replaceAll('"', '\\"')}"`).join(", ");
      const issues = yield* loadIssues(config, `key in (${jqlKeys}) ORDER BY updated DESC`);
      const baseUrl = normalizedBaseUrl(config.baseUrl);
      return {
        issues: issues.map((issue) => boardIssue(baseUrl, issue)),
      } satisfies JiraLookupIssuesResult;
    });

    return JiraService.of({
      getStatus: getStatus(),
      discoverBoards,
      saveConfiguration,
      disconnect: disconnect(),
      getBoard: getBoard(),
      transitionIssue,
      assignIssue,
      lookupIssues,
    });
  }),
);
