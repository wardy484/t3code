import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Tool } from "effect/unstable/ai";

import { GitWorkflowService } from "../../../git/GitWorkflowService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadTurnBootstrap } from "../../../orchestration/Services/ThreadTurnBootstrap.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { __testing } from "./handlers.ts";
import { CheckDelegatedWorkTool, DelegateWorkTool } from "./tools.ts";

const now = "2026-08-04T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const sourceThreadId = ThreadId.make("thread-source");
const workThreadId = ThreadId.make("thread-work");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6",
} as const;

const invocation = McpInvocationContext.McpInvocationContext.of({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: sourceThreadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["delegate-work"]),
  issuedAt: 1,
});

function thread(id: ThreadId, overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id,
    projectId,
    title: id === sourceThreadId ? "Parent" : "Delegated work",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: id === sourceThreadId ? "/tmp/project" : "/tmp/worktree",
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

const project: OrchestrationProjectShell = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/tmp/project",
  defaultModelSelection: modelSelection,
  scripts: [],
  createdAt: now,
  updatedAt: now,
};

it("describes delegation as mutating and status checks as read-only", () => {
  expect(DelegateWorkTool.name).toBe("delegate_work");
  expect(Context.get(DelegateWorkTool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(DelegateWorkTool.annotations, Tool.Destructive)).toBe(true);
  expect(Context.get(DelegateWorkTool.annotations, Tool.Idempotent)).toBe(false);

  expect(CheckDelegatedWorkTool.name).toBe("check_delegated_work");
  expect(Context.get(CheckDelegatedWorkTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(CheckDelegatedWorkTool.annotations, Tool.Destructive)).toBe(false);
  expect(Context.get(CheckDelegatedWorkTool.annotations, Tool.Idempotent)).toBe(true);
});

it.effect("starts delegated work in an isolated worktree and warns about uncommitted changes", () =>
  Effect.gen(function* () {
    let bootstrapCommand: Parameters<ThreadTurnBootstrap["Service"]["start"]>[0] | undefined;
    const query = ProjectionSnapshotQuery.of({
      getThreadDetailById: (threadId: ThreadId) =>
        Effect.succeed(
          threadId === sourceThreadId ? Option.some(thread(sourceThreadId)) : Option.none(),
        ),
      getProjectShellById: () => Effect.succeed(Option.some(project)),
    } as unknown as ProjectionSnapshotQuery["Service"]);
    const git = GitWorkflowService.of({
      localStatus: () =>
        Effect.succeed({
          isRepo: true,
          hasPrimaryRemote: true,
          isDefaultRef: false,
          refName: "feature/parent",
          hasWorkingTreeChanges: true,
          workingTree: { files: [], insertions: 0, deletions: 0 },
        }),
    } as unknown as GitWorkflowService["Service"]);
    const bootstrap = ThreadTurnBootstrap.of({
      start: (command) =>
        Effect.sync(() => {
          bootstrapCommand = command;
          return {
            sequence: 1,
            preparedWorktree: {
              branch: command.bootstrap?.prepareWorktree?.branch ?? "unavailable",
              worktreePath: "/tmp/delegated-worktree",
            },
          };
        }),
    });

    const result = yield* __testing
      .delegateWork({
        title: "Delegated task",
        task: "Implement the independent change.",
      })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(ProjectionSnapshotQuery, query),
        Effect.provideService(GitWorkflowService, git),
        Effect.provideService(ThreadTurnBootstrap, bootstrap),
        Effect.provide(NodeServices.layer),
      );

    expect(result.worktreePath).toBe("/tmp/delegated-worktree");
    expect(result.branch).toMatch(/^t3code\//);
    expect(result.warnings).toHaveLength(1);
    expect(bootstrapCommand?.sourceDelegatedWork).toEqual({
      sourceThreadId,
      title: "Delegated task",
    });
    expect(bootstrapCommand?.bootstrap?.prepareWorktree).toMatchObject({
      projectCwd: "/tmp/project",
      baseBranch: "feature/parent",
      branch: result.branch,
    });
    expect(bootstrapCommand?.bootstrap?.runSetupScript).toBe(true);
  }),
);

it.effect("reports completed delegated work with its latest assistant result", () =>
  Effect.gen(function* () {
    const source = thread(sourceThreadId, {
      activities: [
        {
          id: EventId.make("event-1"),
          tone: "info",
          kind: "delegated-work.started",
          summary: "Delegated work started",
          payload: {
            sourceThreadId,
            title: "Delegated task",
            workThreadId,
          },
          turnId: null,
          createdAt: now,
        },
      ],
    });
    const work = thread(workThreadId, {
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        assistantMessageId: MessageId.make("message-1"),
      },
      messages: [
        {
          id: MessageId.make("message-1"),
          role: "assistant",
          text: "Implemented and verified the change.",
          turnId: TurnId.make("turn-1"),
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const query = ProjectionSnapshotQuery.of({
      getThreadDetailById: (threadId: ThreadId) =>
        Effect.succeed(
          threadId === sourceThreadId
            ? Option.some(source)
            : threadId === workThreadId
              ? Option.some(work)
              : Option.none(),
        ),
    } as unknown as ProjectionSnapshotQuery["Service"]);

    const result = yield* __testing
      .checkDelegatedWork({})
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(ProjectionSnapshotQuery, query),
      );

    expect(result.work).toEqual([
      expect.objectContaining({
        threadId: workThreadId,
        status: "completed",
        latestResult: {
          text: "Implemented and verified the change.",
          truncated: false,
        },
      }),
    ]);
  }),
);
