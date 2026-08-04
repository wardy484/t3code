import { type OrchestrationCommand, OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export type ThreadTurnStartCommand = Extract<
  OrchestrationCommand,
  { readonly type: "thread.turn.start" }
>;

export interface ThreadTurnBootstrapResult {
  readonly sequence: number;
  readonly preparedWorktree?: {
    readonly branch: string;
    readonly worktreePath: string;
  };
}

export class ThreadTurnBootstrap extends Context.Service<
  ThreadTurnBootstrap,
  {
    readonly start: (
      command: ThreadTurnStartCommand,
    ) => Effect.Effect<ThreadTurnBootstrapResult, OrchestrationDispatchCommandError>;
  }
>()("t3/orchestration/Services/ThreadTurnBootstrap") {}
