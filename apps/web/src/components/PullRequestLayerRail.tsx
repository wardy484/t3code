import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  FileCodeIcon,
  FilesIcon,
  Layers3Icon,
  MessageSquareIcon,
} from "lucide-react";
import type { PullRequestLayer } from "../pullRequestLayers";
import type { PullRequestReviewBrief } from "../pullRequestReviewContextStore";
import { cn } from "../lib/utils";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { Button } from "./ui/button";

export type PullRequestRailMode = "layers" | "files";

const riskStyles = {
  high: "text-red-600 dark:text-red-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-emerald-600 dark:text-emerald-400",
} as const;

export function PullRequestLayerRail({
  brief,
  layers,
  mode,
  selectedLayerId,
  viewedLayerIds,
  onModeChange,
  onSelectLayer,
  onSelectFile,
}: {
  readonly brief: PullRequestReviewBrief;
  readonly layers: ReadonlyArray<PullRequestLayer>;
  readonly mode: PullRequestRailMode;
  readonly selectedLayerId: string | null;
  readonly viewedLayerIds: ReadonlySet<string>;
  readonly onModeChange: (mode: PullRequestRailMode) => void;
  readonly onSelectLayer: (layerId: string) => void;
  readonly onSelectFile: (path: string) => void;
}) {
  const viewedCount = layers.filter((layer) => viewedLayerIds.has(layer.id)).length;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border/70 bg-background">
      <div className="grid grid-cols-2 border-b border-border/70 p-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "layers" ? "secondary" : "ghost"}
          className="justify-start"
          onClick={() => onModeChange("layers")}
        >
          <Layers3Icon className="size-3.5" />
          Layers
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "files" ? "secondary" : "ghost"}
          className="justify-start"
          onClick={() => onModeChange("files")}
        >
          <FilesIcon className="size-3.5" />
          Files
        </Button>
      </div>

      <div className="border-b border-border/70 px-3 py-2.5">
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          {brief.repositoryNameWithOwner}#{brief.number}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug">{brief.title}</p>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{brief.context.files.length} files</span>
          <span aria-hidden="true">·</span>
          <span>{brief.context.comments.length} comments</span>
          <span className="ml-auto">
            {viewedCount}/{layers.length} viewed
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {mode === "layers" ? (
          <div className="space-y-1.5">
            {layers.map((layer, index) => {
              const selected = layer.id === selectedLayerId;
              const viewed = viewedLayerIds.has(layer.id);
              return (
                <button
                  key={layer.id}
                  type="button"
                  className={cn(
                    "w-full rounded-lg border px-2.5 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
                    selected
                      ? "border-primary bg-primary/[0.06]"
                      : "border-transparent hover:border-border hover:bg-muted/45",
                  )}
                  aria-current={selected ? "step" : undefined}
                  onClick={() => onSelectLayer(layer.id)}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        <span className="truncate">{layer.title}</span>
                        {viewed ? (
                          <CheckCircle2Icon className="ml-auto size-3.5 shrink-0 text-emerald-600" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                        {layer.description}
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span
                      className={cn("flex items-center gap-1 capitalize", riskStyles[layer.risk])}
                    >
                      <CircleIcon className="size-2.5" />
                      {layer.risk}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileCodeIcon className="size-3" />
                      {layer.files.length}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquareIcon className="size-3" />
                      {layer.commentCount}
                    </span>
                    <DiffStatLabel
                      additions={layer.additions}
                      deletions={layer.deletions}
                      layout="inline"
                      className="ml-auto text-[10px]"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-0.5">
            {brief.context.files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => onSelectFile(file.path)}
              >
                <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={file.path}>
                  {file.path}
                </span>
                <DiffStatLabel
                  additions={file.additions}
                  deletions={file.deletions}
                  layout="inline"
                  className="text-[10px]"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/70 p-2">
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium hover:bg-muted/50">
            <ChevronRightIcon className="size-3" />
            PR description
          </summary>
          <p className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[10px] leading-relaxed text-muted-foreground">
            {brief.context.body.trim() || "No description provided."}
          </p>
        </details>
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium hover:bg-muted/50">
            <ChevronRightIcon className="size-3" />
            Existing discussion ({brief.context.comments.length})
          </summary>
          <div className="mt-1 max-h-40 space-y-1.5 overflow-y-auto px-2 pb-2">
            {brief.context.comments.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">No existing comments.</p>
            ) : (
              brief.context.comments.map((comment) => (
                <div key={`${comment.kind}:${comment.id}`} className="text-[10px] leading-relaxed">
                  <p className="font-medium">{comment.authorLogin ?? "Unknown author"}</p>
                  <p className="line-clamp-3 text-muted-foreground">{comment.body}</p>
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    </aside>
  );
}
