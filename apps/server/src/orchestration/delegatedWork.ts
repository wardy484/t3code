import {
  DelegatedWorkNoticeDeliveredActivityPayload,
  DelegatedWorkStartedActivityPayload,
  JiraTicketWorkNoticeDeliveredActivityPayload,
  JiraTicketWorkStartedActivityPayload,
  type DelegatedWorkStartedNotice,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const DELEGATED_WORK_STARTED_ACTIVITY_KIND = "delegated-work.started";
export const DELEGATED_WORK_NOTICE_DELIVERED_ACTIVITY_KIND = "delegated-work.notice-delivered";

const LEGACY_JIRA_WORK_STARTED_ACTIVITY_KIND = "jira.ticket.work-started";
const LEGACY_JIRA_WORK_NOTICE_DELIVERED_ACTIVITY_KIND = "jira.ticket.work-notice-delivered";

const isDelegatedWorkStartedPayload = Schema.is(DelegatedWorkStartedActivityPayload);
const isDelegatedWorkNoticeDeliveredPayload = Schema.is(
  DelegatedWorkNoticeDeliveredActivityPayload,
);
const isLegacyJiraWorkStartedPayload = Schema.is(JiraTicketWorkStartedActivityPayload);
const isLegacyJiraNoticeDeliveredPayload = Schema.is(JiraTicketWorkNoticeDeliveredActivityPayload);

export interface DelegatedWorkRelationship extends DelegatedWorkStartedNotice {
  readonly sourceThreadId: OrchestrationThread["id"];
}

function startedRelationship(
  activity: OrchestrationThread["activities"][number],
): DelegatedWorkRelationship | null {
  if (
    activity.kind === DELEGATED_WORK_STARTED_ACTIVITY_KIND &&
    isDelegatedWorkStartedPayload(activity.payload)
  ) {
    return activity.payload;
  }
  if (
    activity.kind === LEGACY_JIRA_WORK_STARTED_ACTIVITY_KIND &&
    isLegacyJiraWorkStartedPayload(activity.payload)
  ) {
    return {
      sourceThreadId: activity.payload.sourceThreadId,
      title: `${activity.payload.issueKey}: ${activity.payload.issueSummary}`,
      workThreadId: activity.payload.workThreadId,
      jiraTicket: {
        issueKey: activity.payload.issueKey,
        issueSummary: activity.payload.issueSummary,
        issueUrl: activity.payload.issueUrl,
      },
    };
  }
  return null;
}

function deliveredWorkThreadId(activity: OrchestrationThread["activities"][number]): string | null {
  if (
    activity.kind === DELEGATED_WORK_NOTICE_DELIVERED_ACTIVITY_KIND &&
    isDelegatedWorkNoticeDeliveredPayload(activity.payload)
  ) {
    return activity.payload.workThreadId;
  }
  if (
    activity.kind === LEGACY_JIRA_WORK_NOTICE_DELIVERED_ACTIVITY_KIND &&
    isLegacyJiraNoticeDeliveredPayload(activity.payload)
  ) {
    return activity.payload.workThreadId;
  }
  return null;
}

export function delegatedWorkRelationships(
  thread: OrchestrationThread,
): ReadonlyArray<DelegatedWorkRelationship> {
  const relationships = new Map<string, DelegatedWorkRelationship>();
  for (const activity of thread.activities) {
    const relationship = startedRelationship(activity);
    if (relationship) relationships.set(relationship.workThreadId, relationship);
  }
  return [...relationships.values()];
}

export function hasJiraTicketWorkStarted(thread: OrchestrationThread, issueKey: string): boolean {
  const normalizedIssueKey = issueKey.toUpperCase();
  return delegatedWorkRelationships(thread).some(
    (relationship) => relationship.jiraTicket?.issueKey.toUpperCase() === normalizedIssueKey,
  );
}

export function pendingDelegatedWorkStartedNotices(
  thread: OrchestrationThread,
): ReadonlyArray<DelegatedWorkStartedNotice> {
  const delivered = new Set(
    thread.activities.flatMap((activity) => {
      const workThreadId = deliveredWorkThreadId(activity);
      return workThreadId ? [workThreadId] : [];
    }),
  );
  return delegatedWorkRelationships(thread).flatMap((relationship) =>
    delivered.has(relationship.workThreadId)
      ? []
      : [
          {
            title: relationship.title,
            workThreadId: relationship.workThreadId,
            ...(relationship.jiraTicket ? { jiraTicket: relationship.jiraTicket } : {}),
          },
        ],
  );
}

export function appendDelegatedWorkStartedContext(
  messageText: string,
  notices: ReadonlyArray<DelegatedWorkStartedNotice>,
): string {
  if (notices.length === 0) return messageText;
  const lines = notices.map((notice) => {
    const jira = notice.jiraTicket
      ? `; Jira: ${notice.jiraTicket.issueKey} (${notice.jiraTicket.issueUrl})`
      : "";
    return `- ${notice.title}; work thread: ${notice.workThreadId}${jira}`;
  });
  return [
    messageText,
    "",
    "<delegated_work_started>",
    "Work has started in separate T3 threads:",
    ...lines,
    "Do not duplicate this work. Check its state before coordinating or planning related work.",
    "</delegated_work_started>",
  ].join("\n");
}
