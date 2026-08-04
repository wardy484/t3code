import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  KanbanBoardId,
  KanbanCardId,
  OrganizationId,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

export const KanbanBoardSource = Schema.Literals(["native", "jira"]);
export type KanbanBoardSource = typeof KanbanBoardSource.Type;

export const KanbanOrganization = Schema.Struct({
  id: OrganizationId,
  name: TrimmedNonEmptyString,
  projectIds: Schema.Array(ProjectId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type KanbanOrganization = typeof KanbanOrganization.Type;

export const KanbanBoardSummary = Schema.Struct({
  id: KanbanBoardId,
  organizationId: OrganizationId,
  name: TrimmedNonEmptyString,
  source: KanbanBoardSource,
  projectIds: Schema.Array(ProjectId),
  baseBranch: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type KanbanBoardSummary = typeof KanbanBoardSummary.Type;

export const KanbanCatalog = Schema.Struct({
  organizations: Schema.Array(KanbanOrganization),
  boards: Schema.Array(KanbanBoardSummary),
});
export type KanbanCatalog = typeof KanbanCatalog.Type;

export const KanbanColumn = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  statusIds: Schema.Array(TrimmedNonEmptyString),
});
export type KanbanColumn = typeof KanbanColumn.Type;

export const KanbanCardAssignee = Schema.Struct({
  accountId: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  avatarUrl: Schema.NullOr(TrimmedNonEmptyString),
});
export type KanbanCardAssignee = typeof KanbanCardAssignee.Type;

export const KanbanCardEpic = Schema.Struct({
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
});
export type KanbanCardEpic = typeof KanbanCardEpic.Type;

export const KanbanCard = Schema.Struct({
  id: KanbanCardId,
  key: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  description: Schema.String,
  statusId: TrimmedNonEmptyString,
  statusName: TrimmedNonEmptyString,
  issueType: TrimmedNonEmptyString,
  priority: Schema.NullOr(TrimmedNonEmptyString),
  assignee: Schema.NullOr(KanbanCardAssignee),
  epic: Schema.NullOr(KanbanCardEpic),
  updatedAt: IsoDateTime,
  url: Schema.NullOr(TrimmedNonEmptyString),
  branchName: TrimmedNonEmptyString,
  pullRequestTitle: TrimmedNonEmptyString,
});
export type KanbanCard = typeof KanbanCard.Type;

export const KanbanBoard = Schema.Struct({
  id: KanbanBoardId,
  organizationId: OrganizationId,
  name: TrimmedNonEmptyString,
  source: KanbanBoardSource,
  projectIds: Schema.Array(ProjectId),
  baseBranch: TrimmedNonEmptyString,
  url: Schema.NullOr(TrimmedNonEmptyString),
  columns: Schema.Array(KanbanColumn),
  cards: Schema.Array(KanbanCard),
  currentUserAccountId: Schema.NullOr(TrimmedNonEmptyString),
});
export type KanbanBoard = typeof KanbanBoard.Type;

export const KanbanCreateOrganizationInput = Schema.Struct({
  name: TrimmedNonEmptyString,
});
export type KanbanCreateOrganizationInput = typeof KanbanCreateOrganizationInput.Type;

export const KanbanUpdateOrganizationInput = Schema.Struct({
  organizationId: OrganizationId,
  name: TrimmedNonEmptyString,
  projectIds: Schema.Array(ProjectId),
});
export type KanbanUpdateOrganizationInput = typeof KanbanUpdateOrganizationInput.Type;

export const KanbanDeleteOrganizationInput = Schema.Struct({
  organizationId: OrganizationId,
});
export type KanbanDeleteOrganizationInput = typeof KanbanDeleteOrganizationInput.Type;

export const KanbanCreateNativeBoardInput = Schema.Struct({
  organizationId: OrganizationId,
  name: TrimmedNonEmptyString,
  projectIds: Schema.Array(ProjectId),
  baseBranch: TrimmedNonEmptyString,
});
export type KanbanCreateNativeBoardInput = typeof KanbanCreateNativeBoardInput.Type;

export const KanbanCreateJiraBoardInput = Schema.Struct({
  organizationId: OrganizationId,
  baseUrl: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  apiToken: Schema.optionalKey(TrimmedNonEmptyString),
  jiraBoardId: PositiveInt,
  jql: TrimmedString,
  projectIds: Schema.Array(ProjectId),
  baseBranch: TrimmedNonEmptyString,
});
export type KanbanCreateJiraBoardInput = typeof KanbanCreateJiraBoardInput.Type;

export const KanbanUpdateBoardInput = Schema.Struct({
  boardId: KanbanBoardId,
  name: TrimmedNonEmptyString,
  projectIds: Schema.Array(ProjectId),
  baseBranch: TrimmedNonEmptyString,
});
export type KanbanUpdateBoardInput = typeof KanbanUpdateBoardInput.Type;

export const KanbanBoardInput = Schema.Struct({
  boardId: KanbanBoardId,
});
export type KanbanBoardInput = typeof KanbanBoardInput.Type;

export const KanbanProjectBoardsInput = Schema.Struct({
  projectId: ProjectId,
});
export type KanbanProjectBoardsInput = typeof KanbanProjectBoardsInput.Type;

export const KanbanProjectBoards = Schema.Struct({
  organization: Schema.NullOr(KanbanOrganization),
  boards: Schema.Array(KanbanBoardSummary),
});
export type KanbanProjectBoards = typeof KanbanProjectBoards.Type;

export const KanbanLookupProjectCardsInput = Schema.Struct({
  projectId: ProjectId,
  issueKeys: Schema.Array(TrimmedNonEmptyString).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
});
export type KanbanLookupProjectCardsInput = typeof KanbanLookupProjectCardsInput.Type;

export const KanbanProjectCard = Schema.Struct({
  board: KanbanBoardSummary,
  card: KanbanCard,
});
export type KanbanProjectCard = typeof KanbanProjectCard.Type;

export const KanbanLookupProjectCardsResult = Schema.Struct({
  matches: Schema.Array(KanbanProjectCard),
});
export type KanbanLookupProjectCardsResult = typeof KanbanLookupProjectCardsResult.Type;

export const KanbanCreateCardInput = Schema.Struct({
  boardId: KanbanBoardId,
  summary: TrimmedNonEmptyString,
  description: Schema.String,
});
export type KanbanCreateCardInput = typeof KanbanCreateCardInput.Type;

export const KanbanUpdateCardInput = Schema.Struct({
  boardId: KanbanBoardId,
  cardId: KanbanCardId,
  summary: TrimmedNonEmptyString,
  description: Schema.String,
});
export type KanbanUpdateCardInput = typeof KanbanUpdateCardInput.Type;

export const KanbanMoveCardInput = Schema.Struct({
  boardId: KanbanBoardId,
  cardId: KanbanCardId,
  targetColumnId: TrimmedNonEmptyString,
});
export type KanbanMoveCardInput = typeof KanbanMoveCardInput.Type;

export const KanbanDeleteCardInput = Schema.Struct({
  boardId: KanbanBoardId,
  cardId: KanbanCardId,
});
export type KanbanDeleteCardInput = typeof KanbanDeleteCardInput.Type;

export const KanbanAssignCardInput = Schema.Struct({
  boardId: KanbanBoardId,
  cardId: KanbanCardId,
});
export type KanbanAssignCardInput = typeof KanbanAssignCardInput.Type;

export const KanbanDeleteResult = Schema.Struct({ deleted: Schema.Literal(true) });
export type KanbanDeleteResult = typeof KanbanDeleteResult.Type;
