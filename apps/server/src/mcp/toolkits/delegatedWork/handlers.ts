import {
  CommandId,
  DelegatedWorkError,
  MessageId,
  ThreadId,
  type CheckDelegatedWorkResult,
  type CheckDelegatedWorkInput,
  type DelegateWorkInput,
  type DelegateWorkResult,
  type DelegatedWorkStatus,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { GitWorkflowService } from "../../../git/GitWorkflowService.ts";
import { delegatedWorkRelationships } from "../../../orchestration/delegatedWork.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadTurnBootstrap } from "../../../orchestration/Services/ThreadTurnBootstrap.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DelegatedWorkToolkit } from "./tools.ts";

const LATEST_RESULT_MAX_LENGTH = 4_000;

function delegatedWorkStatus(thread: OrchestrationThread): DelegatedWorkStatus {
  if (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.latestTurn?.state === "running"
  ) {
    return "working";
  }
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return "failed";
  }
  if (thread.latestTurn?.state === "completed") return "completed";
  if (
    thread.latestTurn?.state === "interrupted" ||
    thread.session?.status === "interrupted" ||
    thread.session?.status === "stopped"
  ) {
    return "stopped";
  }
  return "queued";
}

function latestAssistantResult(thread: OrchestrationThread) {
  const message = thread.messages.findLast(
    (entry) => entry.role === "assistant" && entry.text.trim().length > 0,
  );
  if (!message) return null;
  return {
    text: message.text.slice(0, LATEST_RESULT_MAX_LENGTH),
    truncated: message.text.length > LATEST_RESULT_MAX_LENGTH,
  };
}

function delegatedWorkError(operation: "delegate" | "check", cause: unknown) {
  return new DelegatedWorkError({
    operation,
    detail: cause instanceof Error ? cause.message : String(cause),
  });
}

const delegateWork = Effect.fn("DelegatedWorkToolkit.delegateWork")(function* (
  input: DelegateWorkInput,
) {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("delegate-work")) {
    return yield* new DelegatedWorkError({
      operation: "delegate",
      detail: "The current MCP session cannot delegate work.",
    });
  }
  const query = yield* ProjectionSnapshotQuery;
  const git = yield* GitWorkflowService;
  const bootstrap = yield* ThreadTurnBootstrap;
  const crypto = yield* Crypto.Crypto;

  const sourceThreadOption = yield* query.getThreadDetailById(invocation.threadId);
  if (Option.isNone(sourceThreadOption)) {
    return yield* new DelegatedWorkError({
      operation: "delegate",
      detail: "The current T3 thread is no longer available.",
    });
  }
  const sourceThread = sourceThreadOption.value;
  const projectOption = yield* query.getProjectShellById(sourceThread.projectId);
  if (Option.isNone(projectOption)) {
    return yield* new DelegatedWorkError({
      operation: "delegate",
      detail: "The current T3 project is no longer available.",
    });
  }
  const project = projectOption.value;
  const sourceCwd = sourceThread.worktreePath ?? project.workspaceRoot;
  const sourceStatus = yield* git.localStatus({ cwd: sourceCwd });
  if (!sourceStatus.isRepo) {
    return yield* new DelegatedWorkError({
      operation: "delegate",
      detail: "Delegated work requires the current project to be a Git repository.",
    });
  }
  const baseBranch = sourceStatus.refName ?? sourceThread.branch;
  if (!baseBranch) {
    return yield* new DelegatedWorkError({
      operation: "delegate",
      detail: "Delegated work cannot start from a detached Git checkout.",
    });
  }

  const [threadUuid, messageUuid, commandUuid, branchUuid] = yield* Effect.all([
    crypto.randomUUIDv4,
    crypto.randomUUIDv4,
    crypto.randomUUIDv4,
    crypto.randomUUIDv4,
  ]);
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  const workThreadId = ThreadId.make(threadUuid);
  const temporaryBranch = buildTemporaryWorktreeBranchName(() => branchUuid);

  const bootstrapResult = yield* bootstrap.start({
    type: "thread.turn.start",
    commandId: CommandId.make(`mcp:delegate-work:${commandUuid}`),
    threadId: workThreadId,
    message: {
      messageId: MessageId.make(messageUuid),
      role: "user",
      text: input.task,
      attachments: [],
    },
    modelSelection: sourceThread.modelSelection,
    titleSeed: input.title,
    runtimeMode: sourceThread.runtimeMode,
    interactionMode: sourceThread.interactionMode,
    sourceDelegatedWork: {
      sourceThreadId: sourceThread.id,
      title: input.title,
    },
    bootstrap: {
      createThread: {
        projectId: project.id,
        title: input.title,
        modelSelection: sourceThread.modelSelection,
        runtimeMode: sourceThread.runtimeMode,
        interactionMode: sourceThread.interactionMode,
        branch: baseBranch,
        worktreePath: null,
        createdAt,
      },
      prepareWorktree: {
        projectCwd: project.workspaceRoot,
        baseBranch,
        branch: temporaryBranch,
      },
      runSetupScript: true,
    },
    createdAt,
  });

  if (!bootstrapResult.preparedWorktree) {
    return yield* new DelegatedWorkError({
      operation: "delegate",
      detail: "The delegated thread started but its worktree metadata is unavailable.",
    });
  }

  return {
    threadId: workThreadId,
    title: input.title,
    branch: bootstrapResult.preparedWorktree.branch,
    worktreePath: bootstrapResult.preparedWorktree.worktreePath,
    warnings: sourceStatus.hasWorkingTreeChanges
      ? [
          "The parent checkout has uncommitted changes. The delegated worktree starts from committed branch state and does not include them.",
        ]
      : [],
  } satisfies DelegateWorkResult;
});

const checkDelegatedWork = Effect.fn("DelegatedWorkToolkit.checkDelegatedWork")(function* (
  input: CheckDelegatedWorkInput,
) {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("delegate-work")) {
    return yield* new DelegatedWorkError({
      operation: "check",
      detail: "The current MCP session cannot inspect delegated work.",
    });
  }
  const query = yield* ProjectionSnapshotQuery;
  const sourceThreadOption = yield* query.getThreadDetailById(invocation.threadId);
  if (Option.isNone(sourceThreadOption)) {
    return yield* new DelegatedWorkError({
      operation: "check",
      detail: "The current T3 thread is no longer available.",
    });
  }

  const relationships = delegatedWorkRelationships(sourceThreadOption.value).filter(
    (relationship) => input.threadId === undefined || relationship.workThreadId === input.threadId,
  );
  if (input.threadId !== undefined && relationships.length === 0) {
    return yield* new DelegatedWorkError({
      operation: "check",
      detail: `Thread '${input.threadId}' was not delegated by the current thread.`,
    });
  }

  const work = yield* Effect.forEach(
    relationships,
    (relationship) =>
      query.getThreadDetailById(relationship.workThreadId).pipe(
        Effect.map(
          Option.match({
            onNone: () => ({
              threadId: relationship.workThreadId,
              title: relationship.title,
              status: "stopped" as const,
              branch: null,
              worktreePath: null,
              ...(relationship.jiraTicket ? { jiraTicket: relationship.jiraTicket } : {}),
              latestResult: null,
              lastError: null,
              updatedAt: sourceThreadOption.value.updatedAt,
            }),
            onSome: (thread) => ({
              threadId: thread.id,
              title: thread.title,
              status: delegatedWorkStatus(thread),
              branch: thread.branch,
              worktreePath: thread.worktreePath,
              ...(relationship.jiraTicket ? { jiraTicket: relationship.jiraTicket } : {}),
              latestResult: latestAssistantResult(thread),
              lastError: thread.session?.lastError ?? null,
              updatedAt: thread.updatedAt,
            }),
          }),
        ),
      ),
    { concurrency: 8 },
  );
  return { work } satisfies CheckDelegatedWorkResult;
});

const handlers = {
  delegate_work: (input: DelegateWorkInput) =>
    delegateWork(input).pipe(Effect.mapError((cause) => delegatedWorkError("delegate", cause))),
  check_delegated_work: (input) =>
    checkDelegatedWork(input).pipe(Effect.mapError((cause) => delegatedWorkError("check", cause))),
} satisfies Parameters<typeof DelegatedWorkToolkit.toLayer>[0];

export const DelegatedWorkToolkitHandlersLive = DelegatedWorkToolkit.toLayer(handlers);

export const __testing = {
  checkDelegatedWork,
  delegatedWorkStatus,
  delegateWork,
  latestAssistantResult,
};
