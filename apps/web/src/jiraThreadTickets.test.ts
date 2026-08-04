import { EventId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveJiraTicketRelationships, extractJiraIssueKeys } from "./jiraThreadTickets";

describe("extractJiraIssueKeys", () => {
  it("extracts unique Jira keys from assistant messages only", () => {
    expect(
      extractJiraIssueKeys([
        { role: "user", text: "Please inspect KG-1000" },
        {
          role: "assistant",
          text: "Created [KG-3345](https://example.atlassian.net/browse/KG-3345) and kg-3346.",
        },
      ]),
    ).toEqual(["KG-3345", "KG-3346"]);
  });
});

describe("deriveJiraTicketRelationships", () => {
  it("maps a surfaced Jira ticket to its started work thread", () => {
    const workThreadId = ThreadId.make("thread-work");
    const relationships = deriveJiraTicketRelationships([
      {
        id: EventId.make("activity-1"),
        tone: "info",
        kind: "jira.ticket.work-started",
        summary: "Work started on KG-3345",
        payload: {
          sourceThreadId: ThreadId.make("thread-source"),
          issueKey: "KG-3345",
          issueSummary: "Title of ticket",
          issueUrl: "https://example.atlassian.net/browse/KG-3345",
          workThreadId,
        },
        turnId: null,
        createdAt: "2026-08-04T00:00:00.000Z",
      },
    ]);

    expect(relationships.get("KG-3345")?.workThreadId).toBe(workThreadId);
  });
});
