import {
  JiraTicketWorkNoticeDeliveredActivityPayload,
  JiraTicketWorkStartedActivityPayload,
  type JiraWorkStartedNotice,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const JIRA_TICKET_WORK_STARTED_ACTIVITY_KIND = "jira.ticket.work-started";
export const JIRA_TICKET_WORK_NOTICE_DELIVERED_ACTIVITY_KIND = "jira.ticket.work-notice-delivered";

const isWorkStartedPayload = Schema.is(JiraTicketWorkStartedActivityPayload);
const isNoticeDeliveredPayload = Schema.is(JiraTicketWorkNoticeDeliveredActivityPayload);

function relationshipKey(issueKey: string, workThreadId: string): string {
  return `${issueKey.toUpperCase()}:${workThreadId}`;
}

export function hasJiraTicketWorkStarted(thread: OrchestrationThread, issueKey: string): boolean {
  const normalizedIssueKey = issueKey.toUpperCase();
  return thread.activities.some(
    (activity) =>
      activity.kind === JIRA_TICKET_WORK_STARTED_ACTIVITY_KIND &&
      isWorkStartedPayload(activity.payload) &&
      activity.payload.issueKey.toUpperCase() === normalizedIssueKey,
  );
}

export function pendingJiraWorkStartedNotices(
  thread: OrchestrationThread,
): ReadonlyArray<JiraWorkStartedNotice> {
  const delivered = new Set(
    thread.activities.flatMap((activity) =>
      activity.kind === JIRA_TICKET_WORK_NOTICE_DELIVERED_ACTIVITY_KIND &&
      isNoticeDeliveredPayload(activity.payload)
        ? [relationshipKey(activity.payload.issueKey, activity.payload.workThreadId)]
        : [],
    ),
  );

  return thread.activities.flatMap((activity) => {
    if (
      activity.kind !== JIRA_TICKET_WORK_STARTED_ACTIVITY_KIND ||
      !isWorkStartedPayload(activity.payload) ||
      delivered.has(relationshipKey(activity.payload.issueKey, activity.payload.workThreadId))
    ) {
      return [];
    }
    return [
      {
        issueKey: activity.payload.issueKey,
        issueSummary: activity.payload.issueSummary,
        issueUrl: activity.payload.issueUrl,
        workThreadId: activity.payload.workThreadId,
      },
    ];
  });
}

export function appendJiraWorkStartedContext(
  messageText: string,
  notices: ReadonlyArray<JiraWorkStartedNotice>,
): string {
  if (notices.length === 0) return messageText;
  const lines = notices.map(
    (notice) =>
      `- ${notice.issueKey} — ${notice.issueSummary} (${notice.issueUrl}); work thread: ${notice.workThreadId}`,
  );
  return [
    messageText,
    "",
    "<jira_work_started>",
    "Work has started in separate T3 threads for these Jira tickets:",
    ...lines,
    "Do not duplicate this work. Account for these threads when coordinating or planning related work.",
    "</jira_work_started>",
  ].join("\n");
}
