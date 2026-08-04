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
import type {
  KanbanBoard,
  KanbanBoardSummary,
  KanbanCard,
  KanbanColumn,
  KanbanProjectBoards,
  ProjectId,
} from "@t3tools/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  TicketIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import {
  assignKanbanCard,
  createKanbanCard,
  deleteKanbanCard,
  fetchKanbanBoard,
  fetchProjectKanbanBoards,
  moveKanbanCard,
} from "../kanban";
import { buildJiraTicketPrompt, getJiraTicketAction } from "../jira";
import { cn } from "../lib/utils";
import { useActiveEnvironmentId, useProjects } from "../state/entities";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";

type BoardState =
  | { readonly status: "empty" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly board: KanbanBoard };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The board server returned an unexpected error.";

function cardPrompt(card: KanbanCard, board: KanbanBoard, action: "review" | "work"): string {
  if (board.source === "jira" && card.url) {
    return buildJiraTicketPrompt({ ...card, url: card.url }, action);
  }
  const description = card.description.trim() || "No description was provided.";
  return [
    `<!-- t3-worktree-branch:${card.branchName} -->`,
    `${action === "review" ? "Review" : "Work"} this T3 card: ${card.key} — ${card.summary}`,
    "",
    "Description:",
    description,
    "",
    "Delivery conventions:",
    `- Use the exact branch \`${card.branchName}\`.`,
    `- Open the pull request as \`${card.pullRequestTitle}\`.`,
    action === "review"
      ? "- Review the implementation against the card and run relevant verification."
      : "- Implement the card, verify the behavior, and report blockers instead of inventing requirements.",
  ].join("\n");
}

function Card({
  card,
  action,
  busy,
  canStartThread,
  onStartThread,
  onDelete,
}: {
  readonly card: KanbanCard;
  readonly action: "review" | "work" | null;
  readonly busy: boolean;
  readonly canStartThread: boolean;
  readonly onStartThread: (card: KanbanCard, action: "review" | "work") => void;
  readonly onDelete: (card: KanbanCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "group relative rounded-xl border border-border/70 bg-card p-3 shadow-xs transition-[border-color,box-shadow,opacity]",
        "hover:border-border hover:shadow-sm",
        isDragging && "z-20 opacity-70 shadow-xl",
        busy && "pointer-events-none opacity-60",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        {card.url ? (
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold tracking-wide text-muted-foreground hover:text-foreground"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {card.key}
            <ArrowUpRightIcon className="size-3" />
          </a>
        ) : (
          <span className="font-mono text-[11px] font-semibold tracking-wide text-muted-foreground">
            {card.key}
          </span>
        )}
        <div className="flex items-center gap-1">
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {card.issueType}
          </span>
          {!card.url ? (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Delete ${card.key}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(card);
              }}
            >
              <Trash2Icon className="size-3" />
            </button>
          ) : null}
        </div>
      </div>
      <h3 className="mt-2 min-w-0 text-sm leading-snug font-medium text-card-foreground wrap-anywhere">
        {card.summary}
      </h3>
      {card.epic ? (
        <p className="mt-2 truncate text-[11px] text-muted-foreground/80">
          {card.epic.key} · {card.epic.summary}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/55 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {card.assignee?.avatarUrl ? (
            <img
              src={card.assignee.avatarUrl}
              alt=""
              className="size-5 rounded-full"
              draggable={false}
            />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-full bg-muted">
              <UserRoundIcon className="size-3" />
            </span>
          )}
          <span className="truncate">{card.assignee?.displayName ?? "Unassigned"}</span>
        </div>
        {action ? (
          <Button
            size="xs"
            variant="outline"
            disabled={!canStartThread || busy}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onStartThread(card, action);
            }}
          >
            {action === "review" ? "Review" : "Start"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function Column({
  column,
  cards,
  busyCardIds,
  canStartThread,
  onStartThread,
  onDelete,
}: {
  readonly column: KanbanColumn;
  readonly cards: ReadonlyArray<KanbanCard>;
  readonly busyCardIds: ReadonlySet<string>;
  readonly canStartThread: boolean;
  readonly onStartThread: (card: KanbanCard, action: "review" | "work") => void;
  readonly onDelete: (card: KanbanCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const action = getJiraTicketAction(column.name);
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
          {cards.length}
        </span>
      </header>
      <div className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            action={action}
            busy={busyCardIds.has(card.id)}
            canStartThread={canStartThread}
            onStartThread={onStartThread}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function KanbanRouteView() {
  const environmentId = useActiveEnvironmentId();
  const allProjects = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const handleNewThread = useNewThreadHandler();
  const [projectBoards, setProjectBoards] = useState<KanbanProjectBoards | null>(null);
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [boardId, setBoardId] = useState<KanbanBoardSummary["id"] | null>(null);
  const [state, setState] = useState<BoardState>({ status: "empty" });
  const [newCardSummary, setNewCardSummary] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<"all" | "mine">("all");
  const [busyCardIds, setBusyCardIds] = useState<ReadonlySet<string>>(() => new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    setProjectId((current) =>
      current && projects.some((project) => project.id === current)
        ? current
        : (projects[0]?.id ?? null),
    );
  }, [projects]);

  const loadProjectBoards = useCallback(async () => {
    if (!environmentId || !projectId) {
      setProjectBoards(null);
      setBoardId(null);
      setState({ status: "empty" });
      return;
    }
    try {
      const result = await fetchProjectKanbanBoards(environmentId, { projectId });
      setProjectBoards(result);
      setBoardId((current) =>
        current && result.boards.some((board) => board.id === current)
          ? current
          : (result.boards[0]?.id ?? null),
      );
      if (result.boards.length === 0) setState({ status: "empty" });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }, [environmentId, projectId]);

  useEffect(() => {
    void loadProjectBoards();
  }, [loadProjectBoards]);

  const loadBoard = useCallback(async () => {
    if (!environmentId || !boardId) return;
    setState({ status: "loading" });
    try {
      setState({ status: "ready", board: await fetchKanbanBoard(environmentId, { boardId }) });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }, [boardId, environmentId]);

  useEffect(() => {
    if (boardId) void loadBoard();
  }, [boardId, loadBoard]);

  const board = state.status === "ready" ? state.board : null;
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const visibleCards = useMemo(
    () =>
      (board?.cards ?? []).filter(
        (card) =>
          assigneeFilter === "all" || card.assignee?.accountId === board?.currentUserAccountId,
      ),
    [assigneeFilter, board],
  );

  const withBusyCard = useCallback(async (card: KanbanCard, operation: () => Promise<void>) => {
    setBusyCardIds((current) => new Set(current).add(card.id));
    try {
      await operation();
    } finally {
      setBusyCardIds((current) => {
        const next = new Set(current);
        next.delete(card.id);
        return next;
      });
    }
  }, []);

  const startThread = useCallback(
    (card: KanbanCard, action: "review" | "work") => {
      if (!environmentId || !board || !project) return;
      void withBusyCard(card, async () => {
        let ticket = card;
        if (board.source === "jira" && action === "work" && card.assignee === null) {
          ticket = await assignKanbanCard(environmentId, { boardId: board.id, cardId: card.id });
          setState((current) =>
            current.status === "ready"
              ? {
                  status: "ready",
                  board: {
                    ...current.board,
                    cards: current.board.cards.map((candidate) =>
                      candidate.id === card.id ? ticket : candidate,
                    ),
                  },
                }
              : current,
          );
        }
        await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
          branch: board.baseBranch,
          envMode: "worktree",
          initialPrompt: cardPrompt(ticket, board, action),
        });
      }).catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not start ${card.key}`,
            description: errorMessage(error),
          }),
        );
      });
    },
    [board, environmentId, handleNewThread, project, withBusyCard],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!environmentId || !board || !event.over) return;
      const cardId = String(event.active.id);
      const targetColumnId = String(event.over.id);
      const card = board.cards.find((candidate) => candidate.id === cardId);
      const targetColumn = board.columns.find((candidate) => candidate.id === targetColumnId);
      if (!card || !targetColumn || targetColumn.statusIds.includes(card.statusId)) return;
      const previousBoard = board;
      const optimisticStatusId = targetColumn.statusIds[0];
      if (!optimisticStatusId) return;
      setState({
        status: "ready",
        board: {
          ...board,
          cards: board.cards.map((candidate) =>
            candidate.id === card.id
              ? { ...candidate, statusId: optimisticStatusId, statusName: targetColumn.name }
              : candidate,
          ),
        },
      });
      void withBusyCard(card, async () => {
        const moved = await moveKanbanCard(environmentId, {
          boardId: board.id,
          cardId: card.id,
          targetColumnId,
        });
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                board: {
                  ...current.board,
                  cards: current.board.cards.map((candidate) =>
                    candidate.id === card.id ? moved : candidate,
                  ),
                },
              }
            : current,
        );
      }).catch((error) => {
        setState({ status: "ready", board: previousBoard });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not move ${card.key}`,
            description: errorMessage(error),
          }),
        );
      });
    },
    [board, environmentId, withBusyCard],
  );

  const createCard = useCallback(async () => {
    const summary = newCardSummary.trim();
    if (!environmentId || !board || board.source !== "native" || !summary) return;
    setNewCardSummary("");
    try {
      const card = await createKanbanCard(environmentId, {
        boardId: board.id,
        summary,
        description: "",
      });
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", board: { ...current.board, cards: [...current.board.cards, card] } }
          : current,
      );
    } catch (error) {
      setNewCardSummary(summary);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not create card",
          description: errorMessage(error),
        }),
      );
    }
  }, [board, environmentId, newCardSummary]);

  const removeCard = useCallback(
    (card: KanbanCard) => {
      if (!environmentId || !board) return;
      void withBusyCard(card, async () => {
        await deleteKanbanCard(environmentId, { boardId: board.id, cardId: card.id });
        setState((current) =>
          current.status === "ready"
            ? {
                status: "ready",
                board: {
                  ...current.board,
                  cards: current.board.cards.filter((candidate) => candidate.id !== card.id),
                },
              }
            : current,
        );
      }).catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not delete ${card.key}`,
            description: errorMessage(error),
          }),
        );
      });
    },
    [board, environmentId, withBusyCard],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header
          className={cn(
            "flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-xs">
              <TicketIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{board?.name ?? "Boards"}</h1>
              <p className="truncate text-[11px] text-muted-foreground">
                {projectBoards?.organization?.name ?? "Choose a project board"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={projectId ?? ""}
              onChange={(event) => setProjectId(event.currentTarget.value as ProjectId)}
              className="h-8 max-w-48 rounded-lg border border-input bg-background px-2 text-xs"
              aria-label="Project"
            >
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
            {projectBoards && projectBoards.boards.length > 0 ? (
              <select
                value={boardId ?? ""}
                onChange={(event) =>
                  setBoardId(event.currentTarget.value as KanbanBoardSummary["id"])
                }
                className="h-8 max-w-48 rounded-lg border border-input bg-background px-2 text-xs"
                aria-label="Board"
              >
                {projectBoards.boards.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            ) : null}
            {board?.source === "jira" ? (
              <div className="flex rounded-lg border border-border bg-muted/35 p-0.5">
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground",
                    assigneeFilter === "all" && "bg-background text-foreground shadow-xs",
                  )}
                  onClick={() => setAssigneeFilter("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground",
                    assigneeFilter === "mine" && "bg-background text-foreground shadow-xs",
                  )}
                  onClick={() => setAssigneeFilter("mine")}
                >
                  Mine
                </button>
              </div>
            ) : null}
            {board ? (
              <Button size="sm" variant="ghost" onClick={() => void loadBoard()}>
                <RefreshCwIcon className="size-3.5" /> Refresh
              </Button>
            ) : null}
            {board?.url ? (
              <Button
                size="sm"
                variant="outline"
                render={<a href={board.url} target="_blank" rel="noreferrer" />}
              >
                Open Jira <ArrowUpRightIcon className="size-3.5" />
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              aria-label="Board settings"
              render={<Link to="/settings/integrations" />}
            >
              <SettingsIcon className="size-3.5" />
            </Button>
          </div>
        </header>

        {board?.source === "native" ? (
          <form
            className="flex shrink-0 gap-2 border-b border-border/60 px-4 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createCard();
            }}
          >
            <Input
              nativeInput
              value={newCardSummary}
              onChange={(event) => setNewCardSummary(event.currentTarget.value)}
              placeholder="Add a card…"
              className="max-w-xl"
            />
            <Button type="submit" size="sm" disabled={!newCardSummary.trim()}>
              <PlusIcon className="size-3.5" /> Add card
            </Button>
          </form>
        ) : null}

        {state.status === "loading" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" /> Loading board
          </div>
        ) : state.status === "error" ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm">
              <CircleAlertIcon className="size-5 text-destructive" />
              <h2 className="mt-4 text-lg font-semibold">Board unavailable</h2>
              <p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
              <Button className="mt-5" size="sm" onClick={() => void loadProjectBoards()}>
                Try again
              </Button>
            </div>
          </div>
        ) : state.status === "empty" ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-md">
              <TicketIcon className="mx-auto size-7 text-muted-foreground" />
              <h2 className="mt-3 text-base font-semibold">No board for this project</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Assign the project to an organisation, then add it to a T3 or Jira board.
              </p>
              <Button className="mt-4" size="sm" render={<Link to="/settings/integrations" />}>
                Configure boards
              </Button>
            </div>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragEnd={handleDragEnd}
          >
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
              {state.board.columns.map((column) => (
                <Column
                  key={column.id}
                  column={column}
                  cards={visibleCards.filter((card) => column.statusIds.includes(card.statusId))}
                  busyCardIds={busyCardIds}
                  canStartThread={project !== null}
                  onStartThread={startThread}
                  onDelete={removeCard}
                />
              ))}
            </div>
          </DndContext>
        )}
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/kanban")({ component: KanbanRouteView });
