import {
  CommandId,
  EventId,
  OrchestrationDispatchCommandError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import * as ProjectSetupScriptRunner from "../../project/ProjectSetupScriptRunner.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ThreadTurnBootstrap,
  type ThreadTurnStartCommand,
} from "../Services/ThreadTurnBootstrap.ts";

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function setupFailureDetail(error: ProjectSetupScriptRunner.ProjectSetupScriptRunnerError): string {
  switch (error._tag) {
    case "ProjectSetupScriptOperationError":
      return typeof error.cause === "object" &&
        error.cause !== null &&
        "message" in error.cause &&
        typeof error.cause.message === "string"
        ? error.cause.message
        : String(error.cause);
    case "ProjectSetupScriptProjectNotFoundError":
      return "Project was not found for setup script execution.";
  }
}

function bootstrapError(cause: Cause.Cause<unknown>): OrchestrationDispatchCommandError {
  const error = Cause.squash(cause);
  return isOrchestrationDispatchCommandError(error)
    ? error
    : new OrchestrationDispatchCommandError({
        message: error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
        cause,
      });
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const gitWorkflow = yield* GitWorkflowService;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const projectSetupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const serverEventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make));

  const appendSetupScriptActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
    readonly summary: string;
    readonly createdAt: string;
    readonly payload: Record<string, unknown>;
    readonly tone: "info" | "error";
  }) =>
    Effect.all({
      commandId: serverCommandId("setup-script-activity"),
      activityId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, activityId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: activityId,
            tone: input.tone,
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const refreshGitStatus = (cwd: string) =>
    vcsStatusBroadcaster
      .refreshStatus(cwd)
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach, Effect.asVoid);

  const start = Effect.fn("ThreadTurnBootstrap.start")(function* (command: ThreadTurnStartCommand) {
    if (!command.bootstrap) {
      return yield* orchestrationEngine.dispatch(command).pipe(
        Effect.mapError((cause) =>
          isOrchestrationDispatchCommandError(cause)
            ? cause
            : new OrchestrationDispatchCommandError({
                message: "Failed to dispatch orchestration command.",
                cause,
              }),
        ),
      );
    }

    const bootstrap = command.bootstrap;
    const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
    let createdThread = false;
    let targetProjectId = bootstrap.createThread?.projectId;
    let targetProjectCwd = bootstrap.prepareWorktree?.projectCwd;
    let targetWorktreePath = bootstrap.createThread?.worktreePath ?? null;
    let preparedWorktreeBranch: string | null = null;

    const cleanupCreatedThread = () =>
      createdThread
        ? serverCommandId("bootstrap-thread-delete").pipe(
            Effect.flatMap((commandId) =>
              orchestrationEngine.dispatch({
                type: "thread.delete",
                commandId,
                threadId: command.threadId,
              }),
            ),
            Effect.ignoreCause({ log: true }),
          )
        : Effect.void;

    const runSetupProgram = () =>
      Effect.gen(function* () {
        if (!bootstrap.runSetupScript || !targetWorktreePath) return;
        const worktreePath = targetWorktreePath;
        const requestedAt = yield* nowIso;
        yield* projectSetupScriptRunner
          .runForThread({
            threadId: command.threadId,
            ...(targetProjectId ? { projectId: targetProjectId } : {}),
            ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
            worktreePath,
          })
          .pipe(
            Effect.matchEffect({
              onFailure: (error) => {
                const detail = setupFailureDetail(error);
                return appendSetupScriptActivity({
                  threadId: command.threadId,
                  kind: "setup-script.failed",
                  summary: "Setup script failed to start",
                  createdAt: requestedAt,
                  payload: { detail, worktreePath },
                  tone: "error",
                }).pipe(
                  Effect.ignoreCause({ log: false }),
                  Effect.flatMap(() =>
                    Effect.logWarning("bootstrap turn start failed to launch setup script", {
                      threadId: command.threadId,
                      worktreePath,
                      detail,
                    }),
                  ),
                );
              },
              onSuccess: (setupResult) => {
                if (setupResult.status !== "started") return Effect.void;
                return Effect.gen(function* () {
                  const startedAt = yield* nowIso;
                  const payload = {
                    scriptId: setupResult.scriptId,
                    scriptName: setupResult.scriptName,
                    terminalId: setupResult.terminalId,
                    worktreePath,
                  };
                  yield* Effect.all([
                    appendSetupScriptActivity({
                      threadId: command.threadId,
                      kind: "setup-script.requested",
                      summary: "Starting setup script",
                      createdAt: requestedAt,
                      payload,
                      tone: "info",
                    }),
                    appendSetupScriptActivity({
                      threadId: command.threadId,
                      kind: "setup-script.started",
                      summary: "Setup script started",
                      createdAt: startedAt,
                      payload,
                      tone: "info",
                    }),
                  ]).pipe(
                    Effect.asVoid,
                    Effect.catch((error) =>
                      Effect.logWarning(
                        "bootstrap turn start launched setup script but failed to record setup activity",
                        {
                          threadId: command.threadId,
                          worktreePath,
                          scriptId: setupResult.scriptId,
                          terminalId: setupResult.terminalId,
                          detail: error.message,
                        },
                      ),
                    ),
                  );
                });
              },
            }),
          );
      });

    const program = Effect.gen(function* () {
      if (bootstrap.createThread) {
        const parentThreadId =
          command.sourceDelegatedWork?.sourceThreadId ?? command.sourceJiraTicket?.sourceThreadId;
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: yield* serverCommandId("bootstrap-thread-create"),
          threadId: command.threadId,
          projectId: bootstrap.createThread.projectId,
          ...(parentThreadId !== undefined ? { parentThreadId } : {}),
          title: bootstrap.createThread.title,
          modelSelection: bootstrap.createThread.modelSelection,
          runtimeMode: bootstrap.createThread.runtimeMode,
          interactionMode: bootstrap.createThread.interactionMode,
          branch: bootstrap.createThread.branch,
          worktreePath: bootstrap.createThread.worktreePath,
          createdAt: bootstrap.createThread.createdAt,
        });
        createdThread = true;
      }

      if (bootstrap.prepareWorktree) {
        let worktreeBaseRef = bootstrap.prepareWorktree.baseBranch;
        if (bootstrap.prepareWorktree.startFromOrigin) {
          yield* gitWorkflow.fetchRemote({
            cwd: bootstrap.prepareWorktree.projectCwd,
            remoteName: "origin",
          });
          const resolvedRemoteBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
            cwd: bootstrap.prepareWorktree.projectCwd,
            refName: bootstrap.prepareWorktree.baseBranch,
            fallbackRemoteName: "origin",
          });
          worktreeBaseRef = resolvedRemoteBase.commitSha;
        }
        const worktree = yield* gitWorkflow.createWorktree({
          cwd: bootstrap.prepareWorktree.projectCwd,
          refName: worktreeBaseRef,
          newRefName: bootstrap.prepareWorktree.branch,
          baseRefName: bootstrap.prepareWorktree.baseBranch,
          path: null,
        });
        targetWorktreePath = worktree.worktree.path;
        preparedWorktreeBranch = worktree.worktree.refName;
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: yield* serverCommandId("bootstrap-thread-meta-update"),
          threadId: command.threadId,
          branch: worktree.worktree.refName,
          worktreePath: targetWorktreePath,
        });
        yield* refreshGitStatus(targetWorktreePath);
      }

      yield* runSetupProgram();
      const result = yield* orchestrationEngine.dispatch(finalTurnStartCommand);
      return preparedWorktreeBranch && targetWorktreePath
        ? {
            ...result,
            preparedWorktree: {
              branch: preparedWorktreeBranch,
              worktreePath: targetWorktreePath,
            },
          }
        : result;
    });

    return yield* program.pipe(
      Effect.catchCause((cause) => {
        const error = bootstrapError(cause);
        if (Cause.hasInterruptsOnly(cause)) return Effect.fail(error);
        return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(error)));
      }),
    );
  });

  return ThreadTurnBootstrap.of({ start });
});

export const layer = Layer.effect(ThreadTurnBootstrap, make);
