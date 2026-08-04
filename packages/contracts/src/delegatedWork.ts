import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { DelegatedWorkJiraTicket } from "./orchestration.ts";

export const DelegateWorkInput = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  task: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
});
export type DelegateWorkInput = typeof DelegateWorkInput.Type;

export const DelegateWorkResult = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  warnings: Schema.Array(TrimmedNonEmptyString),
});
export type DelegateWorkResult = typeof DelegateWorkResult.Type;

export const CheckDelegatedWorkInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
});
export type CheckDelegatedWorkInput = typeof CheckDelegatedWorkInput.Type;

export const DelegatedWorkStatus = Schema.Literals([
  "queued",
  "working",
  "completed",
  "failed",
  "stopped",
]);
export type DelegatedWorkStatus = typeof DelegatedWorkStatus.Type;

export const DelegatedWorkLatestResult = Schema.Struct({
  text: Schema.String,
  truncated: Schema.Boolean,
});
export type DelegatedWorkLatestResult = typeof DelegatedWorkLatestResult.Type;

export const DelegatedWorkState = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  status: DelegatedWorkStatus,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  jiraTicket: Schema.optional(DelegatedWorkJiraTicket),
  latestResult: Schema.NullOr(DelegatedWorkLatestResult),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type DelegatedWorkState = typeof DelegatedWorkState.Type;

export const CheckDelegatedWorkResult = Schema.Struct({
  work: Schema.Array(DelegatedWorkState),
});
export type CheckDelegatedWorkResult = typeof CheckDelegatedWorkResult.Type;

export class DelegatedWorkError extends Schema.TaggedErrorClass<DelegatedWorkError>()(
  "DelegatedWorkError",
  {
    operation: Schema.Literals(["delegate", "check"]),
    detail: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
