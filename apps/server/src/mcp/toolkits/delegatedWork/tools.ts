import {
  CheckDelegatedWorkInput,
  CheckDelegatedWorkResult,
  DelegateWorkInput,
  DelegateWorkResult,
  DelegatedWorkError,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadTurnBootstrap from "../../../orchestration/Services/ThreadTurnBootstrap.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ThreadTurnBootstrap.ThreadTurnBootstrap,
  GitWorkflowService.GitWorkflowService,
  Crypto.Crypto,
];

export const DelegateWorkTool = Tool.make("delegate_work", {
  description:
    "Hand off an independent coding task to a new visible T3 thread. The thread starts immediately in an isolated worktree based on the current thread's checked-out branch. Uncommitted changes in the current checkout are not copied. Returns the work thread id for later inspection with check_delegated_work.",
  parameters: DelegateWorkInput,
  success: DelegateWorkResult,
  failure: DelegatedWorkError,
  dependencies,
})
  .annotate(Tool.Title, "Delegate work to a new thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const CheckDelegatedWorkTool = Tool.make("check_delegated_work", {
  description:
    "Review work previously delegated by the current T3 thread. Omit threadId to list every delegated thread, or provide one returned by delegate_work. Returns lifecycle state, latest assistant result, errors, branch, worktree, and Jira ticket metadata when the work originated from Jira.",
  parameters: CheckDelegatedWorkInput,
  success: CheckDelegatedWorkResult,
  failure: DelegatedWorkError,
  dependencies,
})
  .annotate(Tool.Title, "Check delegated work")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const DelegatedWorkToolkit = Toolkit.make(DelegateWorkTool, CheckDelegatedWorkTool);
