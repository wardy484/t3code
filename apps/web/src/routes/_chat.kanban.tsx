import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { JiraBoard, JiraBoardColumn, JiraBoardIssue } from "@t3tools/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SettingsIcon,
  TicketIcon,
  UserRoundIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import {
  assignJiraIssue,
  buildJiraTicketPrompt,
  fetchJiraBoard,
  fetchJiraIntegrationStatus,
  getJiraTicketAction,
  shouldAssignJiraTicket,
  type JiraTicketAction,
  transitionJiraIssue,
} from "../jira";
import { cn } from "../lib/utils";
import { useProjects } from "../state/entities";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

type BoardState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string; readonly configPath: string | null }
  | { readonly status: "ready"; readonly board: JiraBoard };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Jira returned an unexpected error.";
}

function JiraIssueCard({
  issue,
  action,
  transitioning,
  canStartThread,
  onStartThread,
}: {
  readonly issue: JiraBoardIssue;
  readonly action: JiraTicketAction | null;
  readonly transitioning: boolean;
  readonly canStartThread: boolean;
  readonly onStartThread: (issue: JiraBoardIssue, action: JiraTicketAction) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.key,
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "group relative rounded-xl border border-border/70 bg-card p-3 shadow-xs transition-[border-color,box-shadow,opacity]",
        "hover:border-border hover:shadow-sm",
        isDragging && "z-20 opacity-70 shadow-xl",
        transitioning && "pointer-events-none opacity-60",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold tracking-wide text-muted-foreground hover:text-foreground"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {issue.key}
          <ArrowUpRightIcon className="size-3" />
        </a>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {issue.issueType}
        </span>
      </div>
      <h3 className="mt-2 min-w-0 text-sm leading-snug font-medium text-card-foreground wrap-anywhere">
        {issue.summary}
      </h3>
      {issue.epic ? (
        <p className="mt-2 truncate text-[11px] text-muted-foreground/80">
          {issue.epic.key} · {issue.epic.summary}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/55 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {issue.assignee?.avatarUrl ? (
            <img
              src={issue.assignee.avatarUrl}
              alt=""
              className="size-5 rounded-full"
              draggable={false}
            />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-full bg-muted">
              <UserRoundIcon className="size-3" />
            </span>
          )}
          <span className="truncate">{issue.assignee?.displayName ?? "Unassigned"}</span>
        </div>
        {action ? (
          <Button
            size="xs"
            variant="outline"
            disabled={!canStartThread || transitioning}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onStartThread(issue, action);
            }}
          >
            {action === "review" ? "Review" : "Start"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function JiraColumn({
  column,
  issues,
  transitioningIssueKeys,
  canStartThread,
  onStartThread,
}: {
  readonly column: JiraBoardColumn;
  readonly issues: ReadonlyArray<JiraBoardIssue>;
  readonly transitioningIssueKeys: ReadonlySet<string>;
  readonly canStartThread: boolean;
  readonly onStartThread: (issue: JiraBoardIssue, action: JiraTicketAction) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const ticketAction = getJiraTicketAction(column.name);
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-h-0 w-[min(22rem,82vw)] shrink-0 flex-col rounded-2xl border border-border/65 bg-muted/25",
        isOver && "border-primary/60 bg-primary/5 ring-2 ring-primary/15",
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/55 px-3">
        <h2 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          {column.name}
        </h2>
        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-xs">
          {issues.length}
        </span>
      </header>
      <div className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {issues.map((issue) => (
          <JiraIssueCard
            key={issue.key}
            issue={issue}
            action={ticketAction}
            transitioning={transitioningIssueKeys.has(issue.key)}
            canStartThread={canStartThread}
            onStartThread={onStartThread}
          />
        ))}
      </div>
    </section>
  );
}

function KanbanRouteView() {
  const projects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const [assigneeFilter, setAssigneeFilter] = useState<"all" | "mine">("all");
  const [epicFilter, setEpicFilter] = useState("all");
  const [transitioningIssueKeys, setTransitioningIssueKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [startingIssueKeys, setStartingIssueKeys] = useState<ReadonlySet<string>>(() => new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const loadBoard = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const status = await fetchJiraIntegrationStatus();
      if (!status.configured) {
        setState({
          status: "error",
          message: "Jira is not configured for this environment.",
          configPath: status.configPath,
        });
        return;
      }
      setState({ status: "ready", board: await fetchJiraBoard() });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error), configPath: null });
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const board = state.status === "ready" ? state.board : null;
  const project = board
    ? (projects.find((candidate) => candidate.workspaceRoot === board.projectPath) ?? null)
    : null;
  const epics = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const issue of board?.issues ?? []) {
      if (issue.epic) byKey.set(issue.epic.key, issue.epic.summary);
    }
    return [...byKey].sort(([left], [right]) => left.localeCompare(right));
  }, [board]);
  const visibleIssues = useMemo(
    () =>
      (board?.issues ?? []).filter(
        (issue) =>
          (assigneeFilter === "all" || issue.assignee?.accountId === board?.currentUserAccountId) &&
          (epicFilter === "all" ||
            (epicFilter === "none" ? issue.epic === null : issue.epic?.key === epicFilter)),
      ),
    [assigneeFilter, board, epicFilter],
  );
  const busyIssueKeys = useMemo(
    () => new Set([...transitioningIssueKeys, ...startingIssueKeys]),
    [startingIssueKeys, transitioningIssueKeys],
  );

  const startThread = useCallback(
    (issue: JiraBoardIssue, action: JiraTicketAction) => {
      if (!board || !project) return;
      setStartingIssueKeys((current) => new Set(current).add(issue.key));
      void (async () => {
        let ticket = issue;
        if (shouldAssignJiraTicket(issue, action)) {
          const assignment = await assignJiraIssue({ issueKey: issue.key });
          ticket = { ...issue, assignee: assignment.assignee };
          setState((current) =>
            current.status === "ready"
              ? {
                  status: "ready",
                  board: {
                    ...current.board,
                    issues: current.board.issues.map((candidate) =>
                      candidate.key === issue.key ? ticket : candidate,
                    ),
                  },
                }
              : current,
          );
        }

        await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
          branch: board.baseBranch,
          envMode: "worktree",
          initialPrompt: buildJiraTicketPrompt(ticket, action),
        });
      })()
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: `Could not start ${issue.key}`,
              description: errorMessage(error),
            }),
          );
        })
        .finally(() => {
          setStartingIssueKeys((current) => {
            const next = new Set(current);
            next.delete(issue.key);
            return next;
          });
        });
    },
    [board, handleNewThread, project],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!board || !event.over) return;
      const issueKey = String(event.active.id);
      const targetColumnId = String(event.over.id);
      const issue = board.issues.find((candidate) => candidate.key === issueKey);
      const targetColumn = board.columns.find((candidate) => candidate.id === targetColumnId);
      if (!issue || !targetColumn || targetColumn.statusIds.includes(issue.statusId)) return;

      const previousBoard = board;
      const optimisticStatusId = targetColumn.statusIds[0];
      if (!optimisticStatusId) return;
      setTransitioningIssueKeys((current) => new Set(current).add(issueKey));
      setState({
        status: "ready",
        board: {
          ...board,
          issues: board.issues.map((candidate) =>
            candidate.key === issueKey
              ? { ...candidate, statusId: optimisticStatusId, statusName: targetColumn.name }
              : candidate,
          ),
        },
      });

      void transitionJiraIssue({ issueKey, targetColumnId })
        .then((result) => {
          setState((current) =>
            current.status !== "ready"
              ? current
              : {
                  status: "ready",
                  board: {
                    ...current.board,
                    issues: current.board.issues.map((candidate) =>
                      candidate.key === issueKey
                        ? {
                            ...candidate,
                            statusId: result.statusId,
                            statusName: result.statusName,
                          }
                        : candidate,
                    ),
                  },
                },
          );
        })
        .catch((error) => {
          setState({ status: "ready", board: previousBoard });
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: `Could not move ${issueKey}`,
              description: errorMessage(error),
            }),
          );
        })
        .finally(() => {
          setTransitioningIssueKeys((current) => {
            const next = new Set(current);
            next.delete(issueKey);
            return next;
          });
        });
    },
    [board],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header
          className={cn(
            "flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-xs">
              <TicketIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{board?.name ?? "Tickets"}</h1>
              <p className="truncate text-[11px] text-muted-foreground">
                {board
                  ? `${visibleIssues.length} of ${board.issues.length} issues`
                  : state.status === "loading"
                    ? "Loading Jira board…"
                    : "Jira integration"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {board ? (
              <>
                <div className="flex rounded-lg border border-border bg-muted/35 p-0.5">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground",
                      assigneeFilter === "all" && "bg-background text-foreground shadow-xs",
                    )}
                    onClick={() => setAssigneeFilter("all")}
                  >
                    All work
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground",
                      assigneeFilter === "mine" && "bg-background text-foreground shadow-xs",
                    )}
                    onClick={() => setAssigneeFilter("mine")}
                  >
                    My work
                  </button>
                </div>
                <select
                  value={epicFilter}
                  onChange={(event) => setEpicFilter(event.currentTarget.value)}
                  className="h-8 max-w-52 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Filter by Epic"
                >
                  <option value="all">All Epics</option>
                  <option value="none">No Epic</option>
                  {epics.map(([key, summary]) => (
                    <option key={key} value={key}>
                      {key} · {summary}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" onClick={() => void loadBoard()}>
                  <RefreshCwIcon className="size-3.5" />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  render={<a href={board.url} target="_blank" rel="noreferrer" />}
                >
                  Open Jira
                  <ArrowUpRightIcon className="size-3.5" />
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              aria-label="Jira settings"
              title="Jira settings"
              render={<Link to="/settings/integrations" />}
            >
              <SettingsIcon className="size-3.5" />
            </Button>
          </div>
        </header>

        {state.status === "loading" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8">
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading tickets from Jira…
            </div>
          </div>
        ) : state.status === "error" ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm">
              <CircleAlertIcon className="size-5 text-destructive" />
              <h2 className="mt-4 text-lg font-semibold">Jira tickets are unavailable</h2>
              <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
              {state.configPath ? (
                <p className="mt-4 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                  {state.configPath}
                </p>
              ) : null}
              <div className="mt-5 flex items-center gap-2">
                <Button size="sm" onClick={() => void loadBoard()}>
                  Try again
                </Button>
                <Button size="sm" variant="outline" render={<Link to="/settings/integrations" />}>
                  Jira settings
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {!project ? (
              <div className="border-b border-warning/30 bg-warning/8 px-4 py-2 text-xs text-warning-foreground">
                Add the configured project path ({state.board.projectPath}) to T3 before starting a
                thread from a ticket.
              </div>
            ) : null}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragEnd={handleDragEnd}
            >
              <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
                {state.board.columns.map((column) => (
                  <JiraColumn
                    key={column.id}
                    column={column}
                    issues={visibleIssues.filter((issue) =>
                      column.statusIds.includes(issue.statusId),
                    )}
                    transitioningIssueKeys={busyIssueKeys}
                    canStartThread={project !== null}
                    onStartThread={startThread}
                  />
                ))}
              </div>
            </DndContext>
          </>
        )}
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/kanban")({
  component: KanbanRouteView,
});
