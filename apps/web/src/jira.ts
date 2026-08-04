import type {
  JiraAssignIssueInput,
  JiraAssignIssueResult,
  JiraBoard,
  JiraBoardDiscoveryResult,
  JiraBoardIssue,
  JiraDisconnectResult,
  JiraDiscoverBoardsInput,
  JiraIntegrationStatus,
  JiraLookupIssuesInput,
  JiraLookupIssuesResult,
  JiraSaveConfigurationInput,
  JiraTransitionIssueInput,
  JiraTransitionIssueResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { PrimaryEnvironmentHttpClient } from "./environments/primary/httpClient";
import { runPrimaryHttp } from "./lib/runtime";

export const JIRA_CONFIGURATION_CHANGED_EVENT = "t3:jira-configuration-changed";

export type JiraTicketAction = "review" | "work";

export function notifyJiraConfigurationChanged(): void {
  window.dispatchEvent(new Event(JIRA_CONFIGURATION_CHANGED_EVENT));
}

export function fetchJiraIntegrationStatus(): Promise<JiraIntegrationStatus> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.jira.status({ headers: {} })),
    ),
  );
}

export function fetchJiraBoard(): Promise<JiraBoard> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.jira.board({ headers: {} })),
    ),
  );
}

export function discoverJiraBoards(
  input: JiraDiscoverBoardsInput,
): Promise<JiraBoardDiscoveryResult> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.jira.discoverBoards({
          headers: {},
          payload: input,
        }),
      ),
    ),
  );
}

export function saveJiraConfiguration(
  input: JiraSaveConfigurationInput,
): Promise<JiraIntegrationStatus> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.jira.saveConfiguration({
          headers: {},
          payload: input,
        }),
      ),
    ),
  );
}

export function disconnectJira(): Promise<JiraDisconnectResult> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.jira.disconnect({ headers: {} })),
    ),
  );
}

export function transitionJiraIssue(
  input: JiraTransitionIssueInput,
): Promise<JiraTransitionIssueResult> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.jira.transitionIssue({
          headers: {},
          payload: input,
        }),
      ),
    ),
  );
}

export function assignJiraIssue(input: JiraAssignIssueInput): Promise<JiraAssignIssueResult> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.jira.assignIssue({
          headers: {},
          payload: input,
        }),
      ),
    ),
  );
}

export function lookupJiraIssues(input: JiraLookupIssuesInput): Promise<JiraLookupIssuesResult> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.jira.lookupIssues({
          headers: {},
          payload: input,
        }),
      ),
    ),
  );
}

export function getJiraTicketAction(columnName: string): JiraTicketAction | null {
  const normalizedName = columnName.trim().toLowerCase();
  if (/^done(?:\s|$)/.test(normalizedName)) return null;
  return normalizedName.includes("review") ? "review" : "work";
}

export function shouldAssignJiraTicket(issue: JiraBoardIssue, action: JiraTicketAction): boolean {
  return action === "work" && issue.assignee === null;
}

export function buildJiraTicketPrompt(
  issue: JiraBoardIssue,
  action: JiraTicketAction = "work",
): string {
  const description = issue.description.trim() || "No description was provided.";
  const instruction =
    action === "review"
      ? "- Review the existing implementation against the ticket, run relevant verification, and report or fix confirmed issues."
      : "- Implement the ticket, verify the behavior, and report any blocker instead of inventing missing requirements.";
  return [
    `<!-- t3-worktree-branch:${issue.branchName} -->`,
    `${action === "review" ? "Review" : "Work"} this Jira ticket: ${issue.key} — ${issue.summary}`,
    "",
    `Jira: ${issue.url}`,
    "",
    "Description:",
    description,
    "",
    "Delivery conventions:",
    `- Use the exact branch \`${issue.branchName}\`.`,
    `- Open the pull request as \`${issue.pullRequestTitle}\`.`,
    instruction,
  ].join("\n");
}
