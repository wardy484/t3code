import type { EnvironmentId, KanbanProjectCard, ProjectId, ThreadId } from "@t3tools/contracts";
import { ArrowUpRightIcon, LoaderCircleIcon, RefreshCwIcon, TicketIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { getJiraTicketAction } from "~/jira";
import type { JiraThreadTicketRelationship } from "~/jiraThreadTickets";
import { lookupProjectKanbanCards } from "~/kanban";

interface JiraTicketsPanelProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly issueKeys: readonly string[];
  readonly relationships: ReadonlyMap<string, JiraThreadTicketRelationship>;
  readonly onStartWork: (match: KanbanProjectCard) => Promise<ThreadId>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly matches: readonly KanbanProjectCard[] };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Jira returned an unexpected error.";

export function JiraTicketsPanel(props: JiraTicketsPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [startingKeys, setStartingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const startingKeysRef = useRef(new Set<string>());
  const [startErrors, setStartErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [startedThreads, setStartedThreads] = useState<ReadonlyMap<string, ThreadId>>(
    () => new Map(),
  );
  const issueKeySignature = props.issueKeys.join(",");

  useEffect(() => {
    let active = true;
    if (props.issueKeys.length === 0) {
      setLoadState({ status: "empty" });
      return () => {
        active = false;
      };
    }
    setLoadState({ status: "loading" });
    void lookupProjectKanbanCards(props.environmentId, {
      projectId: props.projectId,
      issueKeys: [...props.issueKeys],
    })
      .then((result) => {
        if (!active) return;
        const jiraMatches = result.matches.filter(
          (
            match,
          ): match is KanbanProjectCard & { card: KanbanProjectCard["card"] & { url: string } } =>
            match.board.source === "jira" && match.card.url !== null,
        );
        const order = new Map(props.issueKeys.map((key, index) => [key.toUpperCase(), index]));
        setLoadState({
          status: "ready",
          matches: jiraMatches.toSorted(
            (left, right) =>
              (order.get(left.card.key.toUpperCase()) ?? Number.MAX_SAFE_INTEGER) -
              (order.get(right.card.key.toUpperCase()) ?? Number.MAX_SAFE_INTEGER),
          ),
        });
      })
      .catch((error) => {
        if (active) setLoadState({ status: "error", message: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [issueKeySignature, props.environmentId, props.projectId, refreshKey]);

  const relationships = useMemo(() => {
    const next = new Map(props.relationships);
    for (const [issueKey, workThreadId] of startedThreads) {
      next.set(issueKey, { issueKey, workThreadId });
    }
    return next;
  }, [props.relationships, startedThreads]);

  const startWork = useCallback(
    async (match: KanbanProjectCard) => {
      const operationKey = `${match.board.id}:${match.card.key}`;
      if (startingKeysRef.current.has(operationKey) || relationships.has(match.card.key)) return;
      startingKeysRef.current.add(operationKey);
      setStartingKeys((current) => new Set(current).add(operationKey));
      setStartErrors((current) => {
        const next = new Map(current);
        next.delete(operationKey);
        return next;
      });
      try {
        const workThreadId = await props.onStartWork(match);
        setStartedThreads((current) => new Map(current).set(match.card.key, workThreadId));
      } catch (error) {
        setStartErrors((current) => new Map(current).set(operationKey, errorMessage(error)));
      } finally {
        startingKeysRef.current.delete(operationKey);
        setStartingKeys((current) => {
          const next = new Set(current);
          next.delete(operationKey);
          return next;
        });
      }
    },
    [props.onStartWork, relationships],
  );

  if (loadState.status === "loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" /> Loading tickets
      </div>
    );
  }
  if (loadState.status === "empty") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-xs">
          <TicketIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No Jira tickets in this thread</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Tickets appear here when the agent mentions their Jira key.
          </p>
        </div>
      </div>
    );
  }
  if (loadState.status === "error") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-xs">
          <TicketIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Could not load tickets</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{loadState.message}</p>
          <Button
            className="mt-4"
            size="sm"
            variant="outline"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <p className="text-xs text-muted-foreground">
          {loadState.matches.length} {loadState.matches.length === 1 ? "ticket" : "tickets"}{" "}
          assigned to this project
        </p>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh Jira tickets"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid gap-2">
          {loadState.matches.map((match) => {
            const { board, card } = match;
            const operationKey = `${board.id}:${card.key}`;
            const relationship = relationships.get(card.key);
            const starting = startingKeys.has(operationKey);
            const startError = startErrors.get(operationKey);
            const canStart = getJiraTicketAction(card.statusName) !== null;
            return (
              <article
                key={operationKey}
                className="min-w-0 rounded-lg border border-border/80 bg-card p-3 shadow-xs dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <a
                    href={card.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {card.key} · {board.name}
                    <ArrowUpRightIcon className="size-3" />
                  </a>
                  <span className="max-w-36 shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {card.statusName}
                  </span>
                </div>
                <h3 className="mt-2 min-w-0 break-words text-sm leading-snug font-medium [overflow-wrap:anywhere]">
                  {card.summary}
                </h3>
                {relationship || canStart ? (
                  <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
                    {relationship ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => props.onOpenThread(relationship.workThreadId)}
                      >
                        Open thread
                      </Button>
                    ) : (
                      <Button size="sm" disabled={starting} onClick={() => void startWork(match)}>
                        {starting ? <LoaderCircleIcon className="animate-spin" /> : null} Start work
                      </Button>
                    )}
                  </div>
                ) : null}
                {startError ? (
                  <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">
                    {startError}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
