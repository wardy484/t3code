import { ChevronRightIcon, FileCodeIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";
import type { PullRequestReviewBrief as PullRequestReviewBriefData } from "../pullRequestReviewContextStore";
import { DiffStatLabel } from "./chat/DiffStatLabel";

export function PullRequestReviewBrief({ brief }: { readonly brief: PullRequestReviewBriefData }) {
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(brief.context.comments.length > 0);

  return (
    <section className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border/70 bg-background">
      <div className="space-y-3 p-3">
        <div>
          <p className="font-mono text-[11px] text-muted-foreground">
            {brief.repositoryNameWithOwner}#{brief.number}
          </p>
          <h2 className="mt-1 text-sm font-semibold leading-snug">{brief.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {brief.context.files.length} changed{" "}
            {brief.context.files.length === 1 ? "file" : "files"}
            {` · ${brief.context.comments.length} existing ${brief.context.comments.length === 1 ? "comment" : "comments"}`}
          </p>
        </div>

        <details
          open={descriptionOpen}
          onToggle={(event) => setDescriptionOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold">
            <ChevronRightIcon
              className={`size-3 transition-transform ${descriptionOpen ? "rotate-90" : ""}`}
            />
            PR description
          </summary>
          <div className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-muted/25 p-3 text-xs leading-relaxed">
            {brief.context.body.trim() || "No description provided."}
          </div>
        </details>

        <details
          open={commentsOpen}
          onToggle={(event) => setCommentsOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold">
            <ChevronRightIcon
              className={`size-3 transition-transform ${commentsOpen ? "rotate-90" : ""}`}
            />
            Existing discussion ({brief.context.comments.length})
          </summary>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {brief.context.comments.length === 0 ? (
              <p className="rounded-lg border border-border/70 bg-muted/25 p-3 text-xs text-muted-foreground">
                No existing comments.
              </p>
            ) : (
              brief.context.comments.map((comment) => (
                <article
                  key={`${comment.kind}:${comment.id}`}
                  className="rounded-lg border border-border/70 bg-muted/25 p-3 text-xs"
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <MessageSquareIcon className="size-3" />
                    <span className="font-medium text-foreground">
                      {comment.authorLogin ?? "Unknown author"}
                    </span>
                    <span>
                      ·{" "}
                      {comment.kind === "inline"
                        ? "Code comment"
                        : comment.kind === "review"
                          ? "Review"
                          : "Comment"}
                    </span>
                    {comment.path ? (
                      <span className="ml-auto truncate font-mono">
                        {comment.path}
                        {comment.line ? `:${comment.line}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{comment.body}</p>
                </article>
              ))
            )}
          </div>
        </details>

        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <FileCodeIcon className="size-3" />
            Changed files
          </h3>
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {brief.context.files.map((file) => (
              <div
                key={file.path}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
                  {file.path}
                </span>
                <DiffStatLabel
                  additions={file.additions}
                  deletions={file.deletions}
                  layout="inline"
                  className="text-[11px]"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
