import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const JiraIntegrationConfiguration = Schema.Struct({
  baseUrl: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  boardId: PositiveInt,
  jql: TrimmedString,
  projectPath: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  hasApiToken: Schema.Boolean,
});
export type JiraIntegrationConfiguration = typeof JiraIntegrationConfiguration.Type;

export const JiraIntegrationStatus = Schema.Struct({
  configured: Schema.Boolean,
  configPath: TrimmedNonEmptyString,
  configuration: Schema.NullOr(JiraIntegrationConfiguration),
});
export type JiraIntegrationStatus = typeof JiraIntegrationStatus.Type;

export const JiraAvailableBoard = Schema.Struct({
  id: PositiveInt,
  name: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  location: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        displayName: Schema.optionalKey(TrimmedNonEmptyString),
        projectKey: Schema.optionalKey(TrimmedNonEmptyString),
        projectName: Schema.optionalKey(TrimmedNonEmptyString),
      }),
    ),
  ),
});
export type JiraAvailableBoard = typeof JiraAvailableBoard.Type;

export const JiraDiscoverBoardsInput = Schema.Struct({
  baseUrl: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  apiToken: Schema.optionalKey(TrimmedNonEmptyString),
});
export type JiraDiscoverBoardsInput = typeof JiraDiscoverBoardsInput.Type;

export const JiraBoardDiscoveryResult = Schema.Struct({
  accountDisplayName: TrimmedNonEmptyString,
  boards: Schema.Array(JiraAvailableBoard),
});
export type JiraBoardDiscoveryResult = typeof JiraBoardDiscoveryResult.Type;

export const JiraSaveConfigurationInput = Schema.Struct({
  baseUrl: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  apiToken: Schema.optionalKey(TrimmedNonEmptyString),
  boardId: PositiveInt,
  jql: TrimmedString,
  projectPath: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
});
export type JiraSaveConfigurationInput = typeof JiraSaveConfigurationInput.Type;

export const JiraDisconnectResult = Schema.Struct({
  disconnected: Schema.Literal(true),
});
export type JiraDisconnectResult = typeof JiraDisconnectResult.Type;

export const JiraBoardColumn = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  statusIds: Schema.Array(TrimmedNonEmptyString),
});
export type JiraBoardColumn = typeof JiraBoardColumn.Type;

export const JiraIssueUser = Schema.Struct({
  accountId: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  avatarUrl: Schema.NullOr(TrimmedNonEmptyString),
});
export type JiraIssueUser = typeof JiraIssueUser.Type;

export const JiraIssueEpic = Schema.Struct({
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
});
export type JiraIssueEpic = typeof JiraIssueEpic.Type;

export const JiraBoardIssue = Schema.Struct({
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  description: Schema.String,
  statusId: TrimmedNonEmptyString,
  statusName: TrimmedNonEmptyString,
  issueType: TrimmedNonEmptyString,
  priority: Schema.NullOr(TrimmedNonEmptyString),
  assignee: Schema.NullOr(JiraIssueUser),
  epic: Schema.NullOr(JiraIssueEpic),
  updatedAt: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  branchName: TrimmedNonEmptyString,
  pullRequestTitle: TrimmedNonEmptyString,
});
export type JiraBoardIssue = typeof JiraBoardIssue.Type;

export const JiraBoard = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  projectPath: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  columns: Schema.Array(JiraBoardColumn),
  issues: Schema.Array(JiraBoardIssue),
  currentUserAccountId: TrimmedNonEmptyString,
});
export type JiraBoard = typeof JiraBoard.Type;

export const JiraTransitionIssueInput = Schema.Struct({
  issueKey: TrimmedNonEmptyString,
  targetColumnId: TrimmedNonEmptyString,
});
export type JiraTransitionIssueInput = typeof JiraTransitionIssueInput.Type;

export const JiraTransitionIssueResult = Schema.Struct({
  issueKey: TrimmedNonEmptyString,
  statusId: TrimmedNonEmptyString,
  statusName: TrimmedNonEmptyString,
});
export type JiraTransitionIssueResult = typeof JiraTransitionIssueResult.Type;

export const JiraAssignIssueInput = Schema.Struct({
  issueKey: TrimmedNonEmptyString,
});
export type JiraAssignIssueInput = typeof JiraAssignIssueInput.Type;

export const JiraAssignIssueResult = Schema.Struct({
  issueKey: TrimmedNonEmptyString,
  assignee: JiraIssueUser,
});
export type JiraAssignIssueResult = typeof JiraAssignIssueResult.Type;

export const JiraLookupIssuesInput = Schema.Struct({
  issueKeys: Schema.Array(TrimmedNonEmptyString).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
});
export type JiraLookupIssuesInput = typeof JiraLookupIssuesInput.Type;

export const JiraLookupIssuesResult = Schema.Struct({
  issues: Schema.Array(JiraBoardIssue),
});
export type JiraLookupIssuesResult = typeof JiraLookupIssuesResult.Type;
