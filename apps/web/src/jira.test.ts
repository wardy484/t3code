import { describe, expect, it } from "vite-plus/test";

import { buildJiraTicketPrompt, getJiraTicketAction, shouldAssignJiraTicket } from "./jira";

const ticket = {
  id: "10001",
  key: "KG-3345",
  summary: "Title of ticket",
  description: "Ticket body",
  statusId: "3",
  statusName: "In Progress",
  issueType: "Story",
  priority: "High",
  assignee: null,
  epic: null,
  updatedAt: "2026-08-04T00:00:00.000Z",
  url: "https://example.atlassian.net/browse/KG-3345",
  branchName: "KG-3345-title-of-ticket",
  pullRequestTitle: "[KG-3345] Title of ticket",
} as const;

describe("buildJiraTicketPrompt", () => {
  it("carries the ticket and exact delivery naming into the new thread", () => {
    const prompt = buildJiraTicketPrompt(ticket);

    expect(prompt).toContain("Work this Jira ticket: KG-3345 — Title of ticket");
    expect(prompt).toContain("<!-- t3-worktree-branch:KG-3345-title-of-ticket -->");
    expect(prompt).toContain("`[KG-3345] Title of ticket`");
    expect(prompt).toContain("Ticket body");
  });

  it("creates a review-focused prompt for tickets in review", () => {
    const prompt = buildJiraTicketPrompt(
      {
        id: "10001",
        key: "KG-3345",
        summary: "Title of ticket",
        description: "Ticket body",
        statusId: "3",
        statusName: "Review",
        issueType: "Story",
        priority: "High",
        assignee: null,
        epic: null,
        updatedAt: "2026-08-04T00:00:00.000Z",
        url: "https://example.atlassian.net/browse/KG-3345",
        branchName: "KG-3345-title-of-ticket",
        pullRequestTitle: "[KG-3345] Title of ticket",
      },
      "review",
    );

    expect(prompt).toContain("Review this Jira ticket: KG-3345 — Title of ticket");
    expect(prompt).toContain("Review the existing implementation against the ticket");
  });
});

describe("shouldAssignJiraTicket", () => {
  it("assigns an unassigned ticket when starting work", () => {
    expect(shouldAssignJiraTicket(ticket, "work")).toBe(true);
  });

  it("preserves an existing assignee and does not assign review tickets", () => {
    expect(
      shouldAssignJiraTicket(
        {
          ...ticket,
          assignee: { accountId: "account-2", displayName: "Ben", avatarUrl: null },
        },
        "work",
      ),
    ).toBe(false);
    expect(shouldAssignJiraTicket(ticket, "review")).toBe(false);
  });
});

describe("getJiraTicketAction", () => {
  it("uses a review action for review columns", () => {
    expect(getJiraTicketAction("Review")).toBe("review");
  });

  it("hides actions for done columns", () => {
    expect(getJiraTicketAction("Done")).toBeNull();
    expect(getJiraTicketAction("Done since last standup")).toBeNull();
  });

  it("uses the standard work action for other columns", () => {
    expect(getJiraTicketAction("In Progress")).toBe("work");
  });
});
