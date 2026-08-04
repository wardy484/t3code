import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import {
  SourceControlProviderError,
  type ChangeRequest,
  type ChangeRequestState,
  type RelevantChangeRequest,
} from "@t3tools/contracts";

import * as GitHubCli from "./GitHubCli.ts";
import { findAuthenticatedGitHubAccount, parseGitHubAuthStatus } from "./gitHubAuthStatus.ts";
import {
  decodeGitHubPullRequestListJson,
  decodeGitHubSearchPullRequestListJson,
} from "./gitHubPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import {
  combinedAuthOutput,
  firstSafeAuthLine,
  providerAuth,
  type SourceControlAuthProbeInput,
  type SourceControlCliDiscoverySpec,
} from "./SourceControlProviderDiscovery.ts";

function toChangeRequest(summary: GitHubCli.GitHubPullRequestSummary): ChangeRequest {
  return {
    provider: "github",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state ?? "open",
    updatedAt: Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function repositoryNameWithOwnerFromPullRequestUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null;
  } catch {
    return null;
  }
}

function toGitHubReviewEvent(event: "comment" | "approve" | "request-changes") {
  if (event === "approve") return "APPROVE" as const;
  if (event === "request-changes") return "REQUEST_CHANGES" as const;
  return "COMMENT" as const;
}

function parseGitHubAuth(input: SourceControlAuthProbeInput) {
  const output = combinedAuthOutput(input);
  const authStatus = parseGitHubAuthStatus(input.stdout);
  const authenticatedAccount = findAuthenticatedGitHubAccount(authStatus.accounts);
  const host = authenticatedAccount?.host;

  if (authenticatedAccount) {
    return providerAuth({
      status: "authenticated",
      account: authenticatedAccount.account,
      host,
    });
  }

  const failedAccount = authStatus.accounts.find((entry) => entry.active) ?? authStatus.accounts[0];
  if (authStatus.parsed) {
    return providerAuth({
      status: "unauthenticated",
      host: failedAccount?.host,
      detail:
        failedAccount?.error ??
        "Run `gh auth login` to authenticate GitHub CLI with an active account.",
    });
  }

  if (input.exitCode !== 0) {
    return providerAuth({
      status: "unauthenticated",
      host,
      detail: firstSafeAuthLine(output) ?? "Run `gh auth login` to authenticate GitHub CLI.",
    });
  }

  return providerAuth({
    status: "unknown",
    host,
    detail: firstSafeAuthLine(output) ?? "GitHub CLI auth status could not be parsed.",
  });
}

export const discovery = {
  type: "cli",
  kind: "github",
  label: "GitHub",
  executable: "gh",
  versionArgs: ["--version"],
  authArgs: ["auth", "status", "--json", "hosts"],
  parseAuth: parseGitHubAuth,
  installHint:
    "Install the GitHub command-line tool (`gh`) via https://cli.github.com/ or your package manager (for example `brew install gh`).",
} satisfies SourceControlCliDiscoverySpec;

export const make = Effect.gen(function* () {
  const github = yield* GitHubCli.GitHubCli;

  const submitChangeRequestReview: NonNullable<
    SourceControlProvider.SourceControlProvider["Service"]["submitChangeRequestReview"]
  > = (input) => {
    const repository = repositoryNameWithOwnerFromPullRequestUrl(input.pullRequestUrl);
    if (!repository) {
      return Effect.fail(
        new SourceControlProviderError({
          provider: "github",
          operation: "submitChangeRequestReview",
          command: "gh",
          cwd: input.cwd,
          detail: "The pull request URL does not identify a GitHub repository.",
        }),
      );
    }

    const body = input.body?.trim() ?? "";
    return github
      .execute({
        cwd: input.cwd,
        args: [
          "api",
          "--method",
          "POST",
          `repos/${repository}/pulls/${input.pullRequestNumber}/reviews`,
          "--input",
          "-",
        ],
        stdin: JSON.stringify({
          event: toGitHubReviewEvent(input.event),
          ...(body.length > 0 ? { body } : {}),
          comments: input.comments.map((comment) => ({
            path: comment.path,
            body: comment.body,
            line: comment.line,
            side: comment.side === "left" ? "LEFT" : "RIGHT",
            ...(comment.startLine !== undefined ? { start_line: comment.startLine } : {}),
            ...(comment.startSide !== undefined
              ? { start_side: comment.startSide === "left" ? "LEFT" : "RIGHT" }
              : {}),
          })),
        }),
      })
      .pipe(
        Effect.asVoid,
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "submitChangeRequestReview",
              command: error.command,
              cwd: input.cwd,
              detail: error.detail,
              cause: error,
            }),
        ),
      );
  };

  const listRelevantChangeRequests: NonNullable<
    SourceControlProvider.SourceControlProvider["Service"]["listRelevantChangeRequests"]
  > = (input) => {
    const list = (relation: "authored" | "review-requested") =>
      github
        .execute({
          cwd: input.cwd,
          args: [
            "search",
            "prs",
            "--state",
            "open",
            ...(relation === "authored" ? ["--author", "@me"] : ["--review-requested", "@me"]),
            "--sort",
            "updated",
            "--order",
            "desc",
            "--limit",
            String(input.limit ?? 100),
            "--json",
            "number,title,url,updatedAt,author,isDraft,repository",
          ],
        })
        .pipe(
          Effect.flatMap((result) => {
            const raw = result.stdout.trim();
            if (raw.length === 0) return Effect.succeed([]);
            return Effect.sync(() => decodeGitHubSearchPullRequestListJson(raw)).pipe(
              Effect.flatMap((decoded) =>
                Result.isSuccess(decoded)
                  ? Effect.succeed(decoded.success)
                  : Effect.fail(
                      new GitHubCli.GitHubChangeRequestListDecodeError({
                        command: "gh",
                        cwd: input.cwd,
                        cause: decoded.failure,
                      }),
                    ),
              ),
            );
          }),
        );

    return Effect.all([list("authored"), list("review-requested")], {
      concurrency: "unbounded",
    }).pipe(
      Effect.map(([authored, reviewRequested]) => {
        const items = new Map<string, RelevantChangeRequest>();
        const add = (
          summary: (typeof authored)[number],
          relation: "authored" | "review-requested",
        ) => {
          const existing = items.get(summary.url);
          items.set(summary.url, {
            provider: "github",
            number: summary.number,
            title: summary.title,
            url: summary.url,
            repositoryNameWithOwner: summary.repositoryNameWithOwner,
            baseRefName: null,
            headRefName: null,
            authorLogin: summary.authorLogin,
            isDraft: summary.isDraft,
            updatedAt: Option.match(summary.updatedAt, {
              onNone: () => null,
              onSome: DateTime.formatIso,
            }),
            authoredByViewer: existing?.authoredByViewer === true || relation === "authored",
            reviewRequestedFromViewer:
              existing?.reviewRequestedFromViewer === true || relation === "review-requested",
          });
        };
        for (const summary of authored) add(summary, "authored");
        for (const summary of reviewRequested) add(summary, "review-requested");
        return [...items.values()].toSorted((left, right) =>
          (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
        );
      }),
      Effect.mapError(
        (error) =>
          new SourceControlProviderError({
            provider: "github",
            operation: "listRelevantChangeRequests",
            command: error.command,
            cwd: input.cwd,
            detail: error.detail,
            cause: error,
          }),
      ),
    );
  };

  const listChangeRequests: SourceControlProvider.SourceControlProvider["Service"]["listChangeRequests"] =
    (input) => {
      if (input.state === "open") {
        return github
          .listOpenPullRequests({
            cwd: input.cwd,
            headSelector: input.headSelector,
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          })
          .pipe(
            Effect.map((items) => items.map(toChangeRequest)),
            Effect.mapError(
              (error) =>
                new SourceControlProviderError({
                  provider: "github",
                  operation: "listChangeRequests",
                  command: error.command,
                  cwd: input.cwd,
                  reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                    input.headSelector,
                  ),
                  detail: error.detail,
                  cause: error,
                }),
            ),
          );
      }

      const stateArg: ChangeRequestState | "all" = input.state;
      return github
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "list",
            "--head",
            input.headSelector,
            "--state",
            stateArg,
            "--limit",
            String(input.limit ?? 20),
            "--json",
            "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
          ],
        })
        .pipe(
          Effect.flatMap((result) => {
            const raw = result.stdout.trim();
            if (raw.length === 0) {
              return Effect.succeed([]);
            }
            return Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
              Effect.flatMap((decoded) =>
                Result.isSuccess(decoded)
                  ? Effect.succeed(
                      decoded.success.map((item) => ({
                        ...toChangeRequest(item),
                        updatedAt: item.updatedAt,
                      })),
                    )
                  : Effect.fail(
                      new GitHubCli.GitHubChangeRequestListDecodeError({
                        command: "gh",
                        cwd: input.cwd,
                        cause: decoded.failure,
                      }),
                    ),
              ),
            );
          }),
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "github",
                operation: "listChangeRequests",
                command: error.command,
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        );
    };

  return SourceControlProvider.SourceControlProvider.of({
    kind: "github",
    listRelevantChangeRequests,
    submitChangeRequestReview,
    listChangeRequests,
    getChangeRequest: (input) =>
      github.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getChangeRequest",
              command: error.command,
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    createChangeRequest: (input) =>
      github
        .createPullRequest({
          cwd: input.cwd,
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: "github",
                operation: "createChangeRequest",
                command: error.command,
                cwd: input.cwd,
                reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.headSelector,
                ),
                detail: error.detail,
                cause: error,
              }),
          ),
        ),
    getRepositoryCloneUrls: (input) =>
      github.getRepositoryCloneUrls(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getRepositoryCloneUrls",
              command: error.command,
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    createRepository: (input) =>
      github.createRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "createRepository",
              command: error.command,
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    getDefaultBranch: (input) =>
      github.getDefaultBranch(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "getDefaultBranch",
              command: error.command,
              cwd: input.cwd,
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
    checkoutChangeRequest: (input) =>
      github.checkoutPullRequest(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: "github",
              operation: "checkoutChangeRequest",
              command: error.command,
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: error.detail,
              cause: error,
            }),
        ),
      ),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make);
