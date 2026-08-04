import {
  DelegatedWorkStartedActivityPayload,
  JiraTicketWorkStartedActivityPayload,
  type OrchestrationThread,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const JIRA_ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9_]{1,19}-\d+)\b/gi;
const isWorkStartedPayload = Schema.is(JiraTicketWorkStartedActivityPayload);
const isDelegatedWorkStartedPayload = Schema.is(DelegatedWorkStartedActivityPayload);

export interface JiraThreadTicketRelationship {
  readonly issueKey: string;
  readonly workThreadId: ThreadId;
}

export function extractJiraIssueKeys(
  messages: ReadonlyArray<Pick<OrchestrationThread["messages"][number], "role" | "text">>,
): ReadonlyArray<string> {
  const issueKeys = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const match of message.text.matchAll(JIRA_ISSUE_KEY_PATTERN)) {
      const issueKey = match[1];
      if (issueKey) issueKeys.add(issueKey.toUpperCase());
    }
  }
  return [...issueKeys];
}

export function deriveJiraTicketRelationships(
  activities: OrchestrationThread["activities"],
): ReadonlyMap<string, JiraThreadTicketRelationship> {
  const relationships = new Map<string, JiraThreadTicketRelationship>();
  for (const activity of activities) {
    if (
      activity.kind === "delegated-work.started" &&
      isDelegatedWorkStartedPayload(activity.payload) &&
      activity.payload.jiraTicket
    ) {
      const issueKey = activity.payload.jiraTicket.issueKey.toUpperCase();
      relationships.set(issueKey, {
        issueKey,
        workThreadId: activity.payload.workThreadId,
      });
    } else if (
      activity.kind === "jira.ticket.work-started" &&
      isWorkStartedPayload(activity.payload)
    ) {
      const issueKey = activity.payload.issueKey.toUpperCase();
      relationships.set(issueKey, {
        issueKey,
        workThreadId: activity.payload.workThreadId,
      });
    }
  }
  return relationships;
}
