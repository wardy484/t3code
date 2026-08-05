import * as Cause from "effect/Cause";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { PullRequestReviewContext } from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";

const Author = Schema.NullOr(Schema.Struct({ login: Schema.optional(Schema.String) }));
const PullRequestView = Schema.Struct({
  body: Schema.optional(Schema.NullOr(Schema.String)),
  comments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        author: Author,
        body: Schema.String,
        createdAt: Schema.optional(Schema.NullOr(Schema.String)),
        url: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  reviews: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        author: Author,
        body: Schema.String,
        submittedAt: Schema.optional(Schema.NullOr(Schema.String)),
        state: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  files: Schema.optional(
    Schema.Array(
      Schema.Struct({ path: Schema.String, additions: Schema.Number, deletions: Schema.Number }),
    ),
  ),
});

const InlineComments = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    user: Author,
    body: Schema.String,
    created_at: Schema.optional(Schema.NullOr(Schema.String)),
    html_url: Schema.optional(Schema.NullOr(Schema.String)),
    path: Schema.optional(Schema.NullOr(Schema.String)),
    line: Schema.optional(Schema.NullOr(Schema.Number)),
    original_line: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
);

const decodeView = decodeJsonResult(PullRequestView);
const decodeInline = decodeJsonResult(InlineComments);
const text = (value: string | null | undefined): string | null => value?.trim() || null;
const date = (value: string | null | undefined): string | null => text(value);

export function decodeGitHubReviewContext(
  viewJson: string,
  inlineCommentsJson: string,
): Result.Result<PullRequestReviewContext, Cause.Cause<Schema.SchemaError>> {
  const view = decodeView(viewJson);
  if (Result.isFailure(view)) return Result.fail(view.failure);
  const inline = decodeInline(inlineCommentsJson);
  if (Result.isFailure(inline)) return Result.fail(inline.failure);

  const comments: PullRequestReviewContext["comments"] = [
    ...(view.success.comments ?? []).map((comment) => ({
      id: comment.id,
      kind: "issue" as const,
      authorLogin: text(comment.author?.login),
      body: comment.body,
      createdAt: date(comment.createdAt),
      url: text(comment.url),
      path: null,
      line: null,
      state: null,
    })),
    ...(view.success.reviews ?? [])
      .filter((review) => review.body.trim().length > 0)
      .map((review) => ({
        id: review.id,
        kind: "review" as const,
        authorLogin: text(review.author?.login),
        body: review.body,
        createdAt: date(review.submittedAt),
        url: null,
        path: null,
        line: null,
        state: text(review.state),
      })),
    ...inline.success.map((comment) => ({
      id: String(comment.id),
      kind: "inline" as const,
      authorLogin: text(comment.user?.login),
      body: comment.body,
      createdAt: date(comment.created_at),
      url: text(comment.html_url),
      path: text(comment.path),
      line: comment.line ?? comment.original_line ?? null,
      state: null,
    })),
  ].toSorted((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));

  return Result.succeed({
    body: view.success.body ?? "",
    comments,
    files: (view.success.files ?? []).map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    })),
  });
}
