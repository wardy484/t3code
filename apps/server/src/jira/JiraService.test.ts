import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { JiraService, jiraBranchName, jiraDescriptionText, layer } from "./JiraService.ts";

const requests: Array<HttpClientRequest.HttpClientRequest> = [];
const decodeUnknownJsonString = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

const httpClientLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) => {
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === "/rest/agile/1.0/board") {
      const secondPage = url.searchParams.get("startAt") === "1";
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          jsonResponse({
            startAt: secondPage ? 1 : 0,
            maxResults: 50,
            total: 2,
            values: secondPage
              ? [{ id: 124, name: "Support", type: "scrum" }]
              : [
                  {
                    id: 123,
                    name: "Delivery",
                    type: "kanban",
                    location: {
                      displayName: "Tutora",
                      projectKey: "KG",
                      projectName: "Tutora Product",
                    },
                  },
                ],
          }),
        ),
      );
    }
    if (url.pathname.endsWith("/configuration")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          jsonResponse({
            id: 123,
            name: "Delivery",
            filter: { id: "10023" },
            columnConfig: {
              columns: [
                { name: "To do", statuses: [{ id: "1" }] },
                { name: "In progress", statuses: [{ id: "2" }] },
              ],
            },
          }),
        ),
      );
    }
    if (url.pathname === "/rest/agile/1.0/board/123") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          jsonResponse({
            id: 123,
            name: "Delivery",
            type: "scrum",
            location: {
              displayName: "Tutora Product (KG)",
              projectKey: "KG",
              projectName: "Tutora Product",
            },
          }),
        ),
      );
    }
    if (url.pathname === "/rest/agile/1.0/board/123/sprint") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          jsonResponse({
            startAt: 0,
            maxResults: 50,
            total: 1,
            values: [{ id: 900, name: "Current sprint", state: "active" }],
          }),
        ),
      );
    }
    if (url.pathname === "/rest/agile/1.0/board/123/sprint/900/issue") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          jsonResponse({
            issues: [
              {
                id: "10002",
                key: "KG-3420",
                fields: {
                  summary: "Current sprint ticket",
                  description: null,
                  status: { id: "1", name: "To do" },
                  issuetype: { name: "Task" },
                  priority: null,
                  assignee: null,
                  parent: null,
                  updated: "2026-08-04T01:00:00.000Z",
                },
              },
            ],
          }),
        ),
      );
    }
    if (url.pathname.endsWith("/myself")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          jsonResponse({ accountId: "account-1", displayName: "Kim" }),
        ),
      );
    }
    if (url.pathname.endsWith("/search/jql")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          jsonResponse({
            issues: [
              {
                id: "10001",
                key: "KG-3345",
                fields: {
                  summary: "Title of ticket",
                  description: {
                    type: "doc",
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: "Ticket body" }] },
                    ],
                  },
                  status: { id: "1", name: "To do" },
                  issuetype: { name: "Story" },
                  priority: { name: "High" },
                  assignee: {
                    accountId: "account-1",
                    displayName: "Kim",
                    avatarUrls: { "24x24": "https://avatar.example/kim.png" },
                  },
                  parent: {
                    key: "KG-3300",
                    fields: { summary: "Delivery epic", issuetype: { name: "Epic" } },
                  },
                  updated: "2026-08-04T00:00:00.000Z",
                },
              },
            ],
          }),
        ),
      );
    }
    if (url.pathname.endsWith("/transitions") && request.method === "GET") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          jsonResponse({ transitions: [{ id: "21", to: { id: "2", name: "In progress" } }] }),
        ),
      );
    }
    if (url.pathname.endsWith("/transitions") && request.method === "POST") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })),
      );
    }
    if (url.pathname.endsWith("/assignee") && request.method === "PUT") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })),
      );
    }
    return Effect.die(new Error(`Unexpected Jira request: ${request.method} ${request.url}`));
  }),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(layer),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(httpClientLayer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-jira-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

describe("JiraService", () => {
  it("builds the configured ticket branch convention", () => {
    expect(jiraBranchName("KG-3345", "Title of Ticket")).toBe("KG-3345-title-of-ticket");
    expect(jiraBranchName("KG-9", "  Fix résumé sync!  ")).toBe("KG-9-fix-resume-sync");
  });

  it("turns Jira document descriptions into readable agent context", () => {
    expect(
      jiraDescriptionText({
        type: "doc",
        content: [
          { type: "heading", content: [{ type: "text", text: "Acceptance criteria" }] },
          { type: "paragraph", content: [{ type: "text", text: "The board refreshes." }] },
        ],
      }),
    ).toBe("Acceptance criteria\nThe board refreshes.");
  });

  it.layer(TestLayer)("loads a configured board and performs a column transition", (it) => {
    it.effect("discovers boards, securely saves configuration, and disconnects", () =>
      Effect.gen(function* () {
        requests.length = 0;
        const jira = yield* JiraService;

        const discovery = yield* jira.discoverBoards({
          baseUrl: "https://example.atlassian.net",
          email: "kim@example.com",
          apiToken: "managed-secret-token",
        });
        assert.equal(discovery.accountDisplayName, "Kim");
        assert.deepEqual(discovery.boards, [
          {
            id: 123,
            name: "Delivery",
            type: "kanban",
            location: {
              displayName: "Tutora",
              projectKey: "KG",
              projectName: "Tutora Product",
            },
          },
          { id: 124, name: "Support", type: "scrum" },
        ]);

        const saved = yield* jira.saveConfiguration({
          baseUrl: "https://example.atlassian.net/",
          email: "kim@example.com",
          apiToken: "managed-secret-token",
          boardId: 123,
          jql: "",
          projectPath: "/code/tutora",
          baseBranch: "master",
        });
        assert.isTrue(saved.configured);
        assert.isTrue(saved.configuration?.hasApiToken);
        assert.equal(saved.configuration?.baseUrl, "https://example.atlassian.net");

        const board = yield* jira.getBoard;
        assert.equal(board.name, "Tutora Product");
        assert.equal(board.issues[0]?.key, "KG-3420");

        const rediscovered = yield* jira.discoverBoards({
          baseUrl: "https://example.atlassian.net",
          email: "kim@example.com",
        });
        assert.equal(rediscovered.boards[0]?.name, "Delivery");

        const disconnected = yield* jira.disconnect;
        assert.isTrue(disconnected.disconnected);
        const status = yield* jira.getStatus;
        assert.isFalse(status.configured);
        assert.isNull(status.configuration);
      }),
    );

    it.effect("maps Jira responses to the client contract", () =>
      Effect.gen(function* () {
        requests.length = 0;
        const previousToken = process.env.T3CODE_JIRA_API_TOKEN;
        process.env.T3CODE_JIRA_API_TOKEN = "secret-token";
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previousToken === undefined) delete process.env.T3CODE_JIRA_API_TOKEN;
            else process.env.T3CODE_JIRA_API_TOKEN = previousToken;
          }),
        );

        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.writeFileString(
          config.jiraConfigPath,
          `{
            "baseUrl": "https://example.atlassian.net",
            "email": "kim@example.com",
            "boardId": 123,
            "jql": "project = KG ORDER BY Rank ASC",
            "projectPath": "/code/tutora",
            "baseBranch": "master"
          }`,
        );

        const jira = yield* JiraService;
        const board = yield* jira.getBoard;
        assert.equal(board.name, "Tutora Product");
        assert.equal(board.issues[0]?.branchName, "KG-3345-title-of-ticket");
        assert.equal(board.issues[0]?.epic?.key, "KG-3300");
        assert.equal(board.currentUserAccountId, "account-1");

        const lookup = yield* jira.lookupIssues({ issueKeys: ["KG-3345"] });
        assert.equal(lookup.issues[0]?.key, "KG-3345");
        assert.equal(lookup.issues[0]?.statusName, "To do");

        const result = yield* jira.transitionIssue({
          issueKey: "KG-3345",
          targetColumnId: "column-1",
        });
        assert.deepEqual(result, {
          issueKey: "KG-3345",
          statusId: "2",
          statusName: "In progress",
        });
        assert.isTrue(
          requests.some(
            (request) => request.method === "POST" && request.url.endsWith("/transitions"),
          ),
        );

        const assignment = yield* jira.assignIssue({ issueKey: "KG-3420" });
        assert.deepEqual(assignment, {
          issueKey: "KG-3420",
          assignee: {
            accountId: "account-1",
            displayName: "Kim",
            avatarUrl: null,
          },
        });
        const assignmentRequest = requests.find(
          (request) => request.method === "PUT" && request.url.endsWith("/assignee"),
        );
        assert.equal(assignmentRequest?.body._tag, "Uint8Array");
        const assignmentBody =
          assignmentRequest?.body._tag === "Uint8Array"
            ? yield* decodeUnknownJsonString(new TextDecoder().decode(assignmentRequest.body.body))
            : null;
        assert.deepEqual(assignmentBody, { accountId: "account-1" });
      }),
    );
  });
});
