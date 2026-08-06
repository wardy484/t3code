import { ChevronRightIcon, FileCodeIcon, MessageSquareIcon } from "lucide-react";

import type { PullRequestReviewBrief } from "../pullRequestReviewContextStore";

export function PullRequestReviewContextBar({ brief }: { readonly brief: PullRequestReviewBrief }) {
  return (
    <section
      aria-label="Pull request context"
      className="shrink-0 border-b border-border/70 bg-background"
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs font-medium" title={brief.title}>
          {brief.title}
        </p>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {brief.repositoryNameWithOwner}#{brief.number}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <FileCodeIcon aria-hidden="true" className="size-3" />
          {brief.context.files.length}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <MessageSquareIcon aria-hidden="true" className="size-3" />
          {brief.context.comments.length}
        </span>
      </div>
      <div className="flex border-t border-border/50 px-2 py-1">
        <details className="group min-w-0 flex-1">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded px-1 py-1 text-[11px] font-medium hover:bg-muted/50">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3 transition-transform group-open:rotate-90"
            />
            Description
          </summary>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap px-5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {brief.context.body.trim() || "No description provided."}
          </p>
        </details>
        <details className="group min-w-0 flex-1">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded px-1 py-1 text-[11px] font-medium hover:bg-muted/50">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3 transition-transform group-open:rotate-90"
            />
            Discussion ({brief.context.comments.length})
          </summary>
          <div className="max-h-40 space-y-2 overflow-y-auto px-5 py-2">
            {brief.context.comments.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No existing comments.</p>
            ) : (
              brief.context.comments.map((comment) => (
                <div key={`${comment.kind}:${comment.id}`} className="text-[11px] leading-relaxed">
                  <p className="font-medium">{comment.authorLogin ?? "Unknown author"}</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{comment.body}</p>
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
