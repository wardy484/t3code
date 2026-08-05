import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";
import { parseGitHubAuthStatus } from "./gitHubAuthStatus.ts";
import * as GitHubSourceControlProvider from "./GitHubSourceControlProvider.ts";

const processResult = (
  stdout: string,
  options?: {
    readonly stderr?: string;
    readonly exitCode?: ChildProcessSpawner.ExitCode;
  },
): VcsProcess.VcsProcessOutput => ({
  exitCode: options?.exitCode ?? ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: options?.stderr ?? "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeProvider(github: Partial<GitHubCli.GitHubCli["Service"]>) {
  return GitHubSourceControlProvider.make.pipe(
    Effect.provide(Layer.mock(GitHubCli.GitHubCli)(github)),
  );
}

it.effect("maps GitHub PR summaries into provider-neutral change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      getPullRequest: () =>
        Effect.succeed({
          number: 42,
          title: "Add GitHub provider",
          url: "https://github.com/pingdotgg/t3code/pull/42",
          baseRefName: "main",
          headRefName: "feature/source-control",
          state: "open",
          isCrossRepository: true,
          headRepositoryNameWithOwner: "fork/t3code",
          headRepositoryOwnerLogin: "fork",
        }),
    });

    const changeRequest = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: "42",
    });

    assert.deepStrictEqual(changeRequest, {
      provider: "github",
      number: 42,
      title: "Add GitHub provider",
      url: "https://github.com/pingdotgg/t3code/pull/42",
      baseRefName: "main",
      headRefName: "feature/source-control",
      state: "open",
      updatedAt: Option.none(),
      isCrossRepository: true,
      headRepositoryNameWithOwner: "fork/t3code",
      headRepositoryOwnerLogin: "fork",
    });
  }),
);

it.effect("adds safe request context while retaining GitHub CLI causes", () =>
  Effect.gen(function* () {
    const cause = new GitHubCli.GitHubPullRequestNotFoundError({
      command: "gh",
      cwd: "/repo",
      cause: new Error("raw upstream detail that should remain in the cause"),
    });
    const provider = yield* makeProvider({
      getPullRequest: () => Effect.fail(cause),
    });

    const error = yield* provider
      .getChangeRequest({
        cwd: "/repo",
        reference: "https://user:secret@github.com/pingdotgg/t3code/pull/42?token=secret#diff",
      })
      .pipe(Effect.flip);

    assert.deepStrictEqual(
      {
        provider: error.provider,
        operation: error.operation,
        command: error.command,
        cwd: error.cwd,
        reference: error.reference,
        detail: error.detail,
      },
      {
        provider: "github",
        operation: "getChangeRequest",
        command: "gh",
        cwd: "/repo",
        reference: "https://github.com/pingdotgg/t3code/pull/42",
        detail: "Pull request not found. Check the PR number or URL and try again.",
      },
    );
    assert.strictEqual(error.cause, cause);
    assert.equal(error.message.includes("raw upstream detail"), false);
  }),
);

it.effect("uses gh json listing for non-open change request state queries", () =>
  Effect.gen(function* () {
    let executeArgs: ReadonlyArray<string> = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        executeArgs = input.args;
        return Effect.succeed(
          processResult(
            JSON.stringify([
              {
                number: 7,
                title: "Merged work",
                url: "https://github.com/pingdotgg/t3code/pull/7",
                baseRefName: "main",
                headRefName: "feature/merged",
                state: "merged",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ]),
          ),
        );
      },
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/merged",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(executeArgs, [
      "pr",
      "list",
      "--head",
      "feature/merged",
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      "number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt,isCrossRepository,headRepository,headRepositoryOwner",
    ]);
    assert.strictEqual(changeRequests[0]?.provider, "github");
    assert.strictEqual(changeRequests[0]?.state, "merged");
    assert.deepStrictEqual(
      changeRequests[0]?.updatedAt,
      Option.some(DateTime.makeUnsafe("2026-01-02T00:00:00.000Z")),
    );
  }),
);

it.effect("fetches and combines the complete pull request review context", () =>
  Effect.gen(function* () {
    const calls: Array<ReadonlyArray<string>> = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        calls.push(input.args);
        return Effect.succeed(
          processResult(
            input.args[0] === "pr"
              ? JSON.stringify({
                  body: "Why this changed",
                  comments: [],
                  reviews: [],
                  files: [{ path: "src/review.ts", additions: 2, deletions: 1 }],
                })
              : JSON.stringify([
                  [
                    {
                      id: 7,
                      user: { login: "reviewer" },
                      body: "Please handle null",
                      path: "src/review.ts",
                      line: 12,
                    },
                  ],
                ]),
          ),
        );
      },
    });

    const context = yield* provider.getPullRequestReviewContext!({
      cwd: "/repo",
      pullRequestUrl: "https://github.com/pingdotgg/t3code/pull/42",
      pullRequestNumber: 42,
    });

    assert.deepStrictEqual(calls, [
      [
        "pr",
        "view",
        "https://github.com/pingdotgg/t3code/pull/42",
        "--json",
        "body,comments,reviews,files",
      ],
      ["api", "repos/pingdotgg/t3code/pulls/42/comments?per_page=100"],
    ]);
    assert.strictEqual(context.body, "Why this changed");
    assert.deepStrictEqual(context.comments[0], {
      id: "7",
      kind: "inline",
      authorLogin: "reviewer",
      body: "Please handle null",
      createdAt: null,
      url: null,
      path: "src/review.ts",
      line: 12,
      state: null,
    });
  }),
);

it.effect("treats empty non-open change request listing output as no results", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      execute: () => Effect.succeed(processResult("")),
    });

    const changeRequests = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "feature/empty",
      state: "all",
      limit: 10,
    });

    assert.deepStrictEqual(changeRequests, []);
  }),
);

it.effect("merges authored and review-requested PRs for the inbox", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      execute: (input) =>
        Effect.succeed(
          processResult(
            JSON.stringify([
              {
                number: 42,
                title: "Add pull request inbox",
                url: "https://github.com/pingdotgg/t3code/pull/42",
                baseRefName: "main",
                headRefName: "feature/pr-inbox",
                state: "OPEN",
                updatedAt: "2026-08-04T00:00:00.000Z",
                author: { login: "kim" },
                isDraft: false,
                repository: { nameWithOwner: "pingdotgg/t3code" },
              },
              ...(input.args.includes("--author")
                ? []
                : [
                    {
                      number: 43,
                      title: "Review requested PR",
                      url: "https://github.com/pingdotgg/t3code/pull/43",
                      baseRefName: "main",
                      headRefName: "feature/review",
                      state: "OPEN",
                      updatedAt: "2026-08-05T00:00:00.000Z",
                      author: { login: "theo" },
                      isDraft: true,
                      repository: { nameWithOwner: "pingdotgg/t3code" },
                    },
                  ]),
            ]),
          ),
        ),
    });

    const pullRequests = yield* provider.listRelevantChangeRequests!({
      cwd: "/repo",
      limit: 50,
    });

    assert.deepStrictEqual(
      pullRequests.map((pullRequest) => ({
        number: pullRequest.number,
        authoredByViewer: pullRequest.authoredByViewer,
        reviewRequestedFromViewer: pullRequest.reviewRequestedFromViewer,
        isDraft: pullRequest.isDraft,
      })),
      [
        {
          number: 43,
          authoredByViewer: false,
          reviewRequestedFromViewer: true,
          isDraft: true,
        },
        {
          number: 42,
          authoredByViewer: true,
          reviewRequestedFromViewer: true,
          isDraft: false,
        },
      ],
    );
  }),
);

it.effect("submits inline GitHub reviews through the reviews API", () =>
  Effect.gen(function* () {
    const requests: Array<Parameters<GitHubCli.GitHubCli["Service"]["execute"]>[0]> = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        requests.push(input);
        return Effect.succeed(processResult("{}"));
      },
    });

    yield* provider.submitChangeRequestReview!({
      cwd: "/repo",
      pullRequestUrl: "https://github.com/pingdotgg/t3code/pull/42",
      pullRequestNumber: 42,
      event: "request-changes",
      body: "Please address the inline note.",
      comments: [
        {
          path: "src/value.ts",
          body: "This needs a test.",
          line: 12,
          side: "right",
          startLine: 10,
          startSide: "right",
        },
      ],
    });

    assert.deepStrictEqual(requests[0]?.args, [
      "api",
      "--method",
      "POST",
      "repos/pingdotgg/t3code/pulls/42/reviews",
      "--input",
      "-",
    ]);
    assert.strictEqual(
      requests[0]?.stdin,
      '{"event":"REQUEST_CHANGES","body":"Please address the inline note.","comments":[{"path":"src/value.ts","body":"This needs a test.","line":12,"side":"RIGHT","start_line":10,"start_side":"RIGHT"}]}',
    );
  }),
);

it.effect("creates GitHub PRs through provider-neutral input names", () =>
  Effect.gen(function* () {
    let createInput: Parameters<GitHubCli.GitHubCli["Service"]["createPullRequest"]>[0] | null =
      null;
    const provider = yield* makeProvider({
      createPullRequest: (input) => {
        createInput = input;
        return Effect.void;
      },
    });

    yield* provider.createChangeRequest({
      cwd: "/repo",
      baseRefName: "main",
      headSelector: "owner:feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });

    assert.deepStrictEqual(createInput, {
      cwd: "/repo",
      baseBranch: "main",
      headSelector: "owner:feature/provider",
      title: "Provider PR",
      bodyFile: "/tmp/body.md",
    });
  }),
);

it("accepts active authenticated GitHub accounts when another account fails", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
            {
              state: "error",
              active: false,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
              error: "The token in keyring is invalid.",
            },
          ],
        },
      }),
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      account: auth.account,
      host: auth.host,
    },
    {
      status: "authenticated",
      account: Option.some("active-user"),
      host: Option.some("github.com"),
    },
  );
});

it("parses GitHub auth JSON from stdout when stderr has warnings", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
        },
      }),
      { stderr: "warning: ignored diagnostic from gh\n" },
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      account: auth.account,
      host: auth.host,
    },
    {
      status: "authenticated",
      account: Option.some("active-user"),
      host: Option.some("github.com"),
    },
  );
});

it("parses GitHub auth status accounts by host and active state", () => {
  assert.deepStrictEqual(
    parseGitHubAuthStatus(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "success",
              active: true,
              host: "github.com",
              login: "active-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
            {
              state: "error",
              active: false,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
          "github.example.test": [
            {
              state: "success",
              active: false,
              host: "github.example.test",
              login: "enterprise-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
            },
          ],
        },
      }),
    ).accounts,
    [
      {
        host: "github.com",
        account: "active-user",
        authenticated: true,
        active: true,
        error: null,
      },
      {
        host: "github.com",
        account: "stale-user",
        authenticated: false,
        active: false,
        error: null,
      },
      {
        host: "github.example.test",
        account: "enterprise-user",
        authenticated: true,
        active: false,
        error: null,
      },
    ],
  );
});

it("reports unauthenticated when GitHub JSON has accounts but none are valid", () => {
  const auth = GitHubSourceControlProvider.discovery.parseAuth(
    processResult(
      JSON.stringify({
        hosts: {
          "github.com": [
            {
              state: "error",
              active: true,
              host: "github.com",
              login: "stale-user",
              tokenSource: "keyring",
              gitProtocol: "ssh",
              error: "The token in keyring is invalid.",
            },
          ],
        },
      }),
    ),
  );

  assert.deepStrictEqual(
    {
      status: auth.status,
      host: auth.host,
      detail: auth.detail,
    },
    {
      status: "unauthenticated",
      host: Option.some("github.com"),
      detail: Option.some("The token in keyring is invalid."),
    },
  );
});
