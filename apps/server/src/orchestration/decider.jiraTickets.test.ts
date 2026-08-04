import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import {
  JIRA_TICKET_WORK_NOTICE_DELIVERED_ACTIVITY_KIND,
  JIRA_TICKET_WORK_STARTED_ACTIVITY_KIND,
  appendJiraWorkStartedContext,
} from "./jiraTickets.ts";

const NOW = "2026-08-04T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-1");
const SOURCE_THREAD_ID = ThreadId.make("thread-source");
const WORK_THREAD_ID = ThreadId.make("thread-work");

function thread(
  id: ThreadId,
  activities: OrchestrationThread["activities"] = [],
): OrchestrationThread {
  return {
    id,
    projectId: PROJECT_ID,
    title: id === SOURCE_THREAD_ID ? "Original" : "Ticket work",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities,
    checkpoints: [],
    session: null,
  };
}

function workStartedActivity(): OrchestrationThread["activities"][number] {
  return {
    id: EventId.make("jira-work-started"),
    tone: "info",
    kind: JIRA_TICKET_WORK_STARTED_ACTIVITY_KIND,
    summary: "Work started on KG-3345",
    payload: {
      sourceThreadId: SOURCE_THREAD_ID,
      issueKey: "KG-3345",
      issueSummary: "Title of ticket",
      issueUrl: "https://example.atlassian.net/browse/KG-3345",
      workThreadId: WORK_THREAD_ID,
    },
    turnId: null,
    createdAt: NOW,
  };
}

function readModel(
  sourceActivities: OrchestrationThread["activities"] = [],
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [thread(SOURCE_THREAD_ID, sourceActivities), thread(WORK_THREAD_ID)],
    updatedAt: NOW,
  };
}

function startCommand(threadId: ThreadId, sourceJiraTicket = true) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.make(`start-${threadId}`),
    threadId,
    message: {
      messageId: MessageId.make(`message-${threadId}`),
      role: "user" as const,
      text: "Continue",
      attachments: [],
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    ...(sourceJiraTicket
      ? {
          sourceJiraTicket: {
            sourceThreadId: SOURCE_THREAD_ID,
            issueKey: "KG-3345",
            issueSummary: "Title of ticket",
            issueUrl: "https://example.atlassian.net/browse/KG-3345",
          },
        }
      : {}),
    createdAt: NOW,
  };
}

it.layer(NodeServices.layer)("Jira ticket thread relationships", (it) => {
  it.effect("records the original thread, Jira ticket, and new work thread", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: startCommand(WORK_THREAD_ID),
        readModel: readModel(),
      });
      const events = Array.isArray(decided) ? decided : [decided];
      const relationship = events.find(
        (event) =>
          event.type === "thread.activity-appended" &&
          event.payload.activity.kind === JIRA_TICKET_WORK_STARTED_ACTIVITY_KIND,
      );
      expect(relationship?.type).toBe("thread.activity-appended");
      if (relationship?.type === "thread.activity-appended") {
        expect(relationship.payload.threadId).toBe(SOURCE_THREAD_ID);
        expect(relationship.payload.activity.payload).toMatchObject({
          sourceThreadId: SOURCE_THREAD_ID,
          issueKey: "KG-3345",
          workThreadId: WORK_THREAD_ID,
        });
      }
    }),
  );

  it.effect("rejects starting the same Jira ticket twice", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: startCommand(WORK_THREAD_ID),
        readModel: readModel([workStartedActivity()]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect(error.message).toContain("already started");
    }),
  );

  it.effect(
    "queues the work notice for the original agent's next turn and marks it delivered",
    () =>
      Effect.gen(function* () {
        const decided = yield* decideOrchestrationCommand({
          command: startCommand(SOURCE_THREAD_ID, false),
          readModel: readModel([workStartedActivity()]),
        });
        const events = Array.isArray(decided) ? decided : [decided];
        const turnStart = events.find((event) => event.type === "thread.turn-start-requested");
        expect(turnStart?.type).toBe("thread.turn-start-requested");
        if (turnStart?.type === "thread.turn-start-requested") {
          expect(turnStart.payload.jiraWorkStartedNotices).toEqual([
            {
              issueKey: "KG-3345",
              issueSummary: "Title of ticket",
              issueUrl: "https://example.atlassian.net/browse/KG-3345",
              workThreadId: WORK_THREAD_ID,
            },
          ]);
        }
        expect(
          events.some(
            (event) =>
              event.type === "thread.activity-appended" &&
              event.payload.activity.kind === JIRA_TICKET_WORK_NOTICE_DELIVERED_ACTIVITY_KIND,
          ),
        ).toBe(true);
      }),
  );
});

it("adds Jira work notices to provider context without changing the stored user message", () => {
  const original = "What should we do next?";
  const output = appendJiraWorkStartedContext(original, [
    {
      issueKey: "KG-3345",
      issueSummary: "Title of ticket",
      issueUrl: "https://example.atlassian.net/browse/KG-3345",
      workThreadId: WORK_THREAD_ID,
    },
  ]);
  expect(output).toContain(original);
  expect(output).toContain("<jira_work_started>");
  expect(output).toContain("Do not duplicate this work");
});
