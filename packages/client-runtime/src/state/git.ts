import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    relevantPullRequests: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:relevant-pull-requests",
      tag: WS_METHODS.gitListRelevantPullRequests,
    }),
    submitPullRequestReview: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:submit-pull-request-review",
      tag: WS_METHODS.gitSubmitPullRequestReview,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
