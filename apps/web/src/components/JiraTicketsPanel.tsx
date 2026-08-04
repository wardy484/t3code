import type { JiraBoardIssue, JiraIntegrationConfiguration, ThreadId } from "@t3tools/contracts";
import { ArrowUpRightIcon, LoaderCircleIcon, RefreshCwIcon, TicketIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchJiraIntegrationStatus, getJiraTicketAction, lookupJiraIssues } from "~/jira";
import type { JiraThreadTicketRelationship } from "~/jiraThreadTickets";
import { Button } from "~/components/ui/button";

interface JiraTicketsPanelProps {
  issueKeys: readonly string[];
  relationships: ReadonlyMap<string, JiraThreadTicketRelationship>;
  onStartWork: (
    issue: JiraBoardIssue,
    configuration: JiraIntegrationConfiguration,
  ) => Promise<ThreadId>;
  onOpenThread: (threadId: ThreadId) => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      configuration: JiraIntegrationConfiguration;
      issues: readonly JiraBoardIssue[];
    };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Jira returned an unexpected error.";
}

export function JiraTicketsPanel(props: JiraTicketsPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [startingIssueKeys, setStartingIssueKeys] = useState<ReadonlySet<string>>(() => new Set());
  const startingIssueKeysRef = useRef(new Set<string>());
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
    void Promise.all([
      fetchJiraIntegrationStatus(),
      lookupJiraIssues({ issueKeys: [...props.issueKeys] }),
    ])
      .then(([integration, result]) => {
        if (!active) return;
        if (!integration.configuration) {
          setLoadState({ status: "error", message: "Configure Jira to load these tickets." });
          return;
        }
        const byKey = new Map(result.issues.map((issue) => [issue.key.toUpperCase(), issue]));
        setLoadState({
          status: "ready",
          configuration: integration.configuration,
          issues: props.issueKeys.flatMap((issueKey) => {
            const issue = byKey.get(issueKey);
            return issue ? [issue] : [];
          }),
        });
      })
      .catch((error) => {
        if (active) setLoadState({ status: "error", message: errorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [issueKeySignature, refreshKey]);

  const relationships = useMemo(() => {
    const next = new Map(props.relationships);
    for (const [issueKey, workThreadId] of startedThreads) {
      next.set(issueKey, { issueKey, workThreadId });
    }
    return next;
  }, [props.relationships, startedThreads]);

  const startWork = useCallback(
    async (issue: JiraBoardIssue, configuration: JiraIntegrationConfiguration) => {
      if (startingIssueKeysRef.current.has(issue.key) || relationships.has(issue.key)) return;
      startingIssueKeysRef.current.add(issue.key);
      setStartingIssueKeys((current) => new Set(current).add(issue.key));
      setStartErrors((current) => {
        const next = new Map(current);
        next.delete(issue.key);
        return next;
      });
      try {
        const workThreadId = await props.onStartWork(issue, configuration);
        setStartedThreads((current) => new Map(current).set(issue.key, workThreadId));
      } catch (error) {
        setStartErrors((current) => new Map(current).set(issue.key, errorMessage(error)));
      } finally {
        startingIssueKeysRef.current.delete(issue.key);
        setStartingIssueKeys((current) => {
          const next = new Set(current);
          next.delete(issue.key);
          return next;
        });
      }
    },
    [props.onStartWork, relationships],
  );

  if (loadState.status === "loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Loading tickets
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
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setRefreshKey((value) => value + 1)}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" render={<a href="/settings/integrations" />}>
              Jira settings
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <p className="text-xs text-muted-foreground">
          {loadState.issues.length} {loadState.issues.length === 1 ? "ticket" : "tickets"} from this
          thread
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
          {loadState.issues.map((issue) => {
            const relationship = relationships.get(issue.key);
            const starting = startingIssueKeys.has(issue.key);
            const startError = startErrors.get(issue.key);
            const canStart = getJiraTicketAction(issue.statusName) !== null;
            return (
              <article
                key={issue.key}
                className="min-w-0 rounded-lg border border-border/80 bg-card p-3 shadow-xs dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {issue.key}
                    <ArrowUpRightIcon className="size-3" />
                  </a>
                  <span className="max-w-36 shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {issue.statusName}
                  </span>
                </div>
                <h3 className="mt-2 min-w-0 break-words text-sm font-medium leading-snug [overflow-wrap:anywhere]">
                  {issue.summary}
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
                      <Button
                        size="sm"
                        disabled={starting}
                        onClick={() => void startWork(issue, loadState.configuration)}
                      >
                        {starting ? <LoaderCircleIcon className="animate-spin" /> : null}
                        Start work
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
