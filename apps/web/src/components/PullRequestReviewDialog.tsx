import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ChangeRequestReviewComment,
  ChangeRequestReviewEvent,
  EnvironmentId,
} from "@t3tools/contracts";
import { GitPullRequestIcon } from "lucide-react";
import { useState } from "react";

import { useSubmitPullRequestReviewAction } from "~/lib/sourceControlActions";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";

interface PullRequestReviewDialogProps {
  readonly open: boolean;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly pullRequest: {
    readonly number: number;
    readonly title: string;
    readonly url: string;
  };
  readonly comments: ReadonlyArray<ChangeRequestReviewComment>;
  readonly skippedCommentCount: number;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmitted: () => void;
}

export function PullRequestReviewDialog(props: PullRequestReviewDialogProps) {
  const [body, setBody] = useState("");
  const [submittingEvent, setSubmittingEvent] = useState<ChangeRequestReviewEvent | null>(null);
  const submitReview = useSubmitPullRequestReviewAction({
    environmentId: props.environmentId,
    cwd: props.cwd,
  });

  const submit = async (event: ChangeRequestReviewEvent) => {
    const trimmedBody = body.trim();
    if (event === "request-changes" && trimmedBody.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Describe the requested changes",
      });
      return;
    }
    if (event === "comment" && trimmedBody.length === 0 && props.comments.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Add a review summary or inline comment",
      });
      return;
    }

    setSubmittingEvent(event);
    const result = await submitReview.run({
      pullRequestUrl: props.pullRequest.url,
      pullRequestNumber: props.pullRequest.number,
      event,
      ...(trimmedBody.length > 0 ? { body: trimmedBody } : {}),
      comments: props.comments,
    });
    setSubmittingEvent(null);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) submitReview.resetError();
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not submit GitHub review",
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    props.onSubmitted();
    props.onOpenChange(false);
    setBody("");
    toastManager.add({
      type: "success",
      title:
        event === "approve"
          ? "Pull request approved"
          : event === "request-changes"
            ? "Changes requested"
            : "Review submitted",
    });
  };

  const pending = submittingEvent !== null;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!pending) props.onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequestIcon className="size-4" />
            Review pull request #{props.pullRequest.number}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">{props.pullRequest.title}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {props.comments.length} inline {props.comments.length === 1 ? "comment" : "comments"}
            {props.skippedCommentCount > 0
              ? ` · ${props.skippedCommentCount} cross-side or stale comment${props.skippedCommentCount === 1 ? "" : "s"} will stay in the agent composer`
              : ""}
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Review summary</span>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.currentTarget.value)}
              placeholder="Add context for the author…"
              rows={5}
              disabled={pending}
            />
          </label>
        </DialogPanel>
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            disabled={pending}
            onClick={() => void submit("request-changes")}
          >
            {submittingEvent === "request-changes" ? "Submitting…" : "Request changes"}
          </Button>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void submit("comment")}
            >
              {submittingEvent === "comment" ? "Submitting…" : "Comment"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => void submit("approve")}
            >
              {submittingEvent === "approve" ? "Submitting…" : "Approve"}
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
