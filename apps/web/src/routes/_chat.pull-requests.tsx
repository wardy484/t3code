import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { RelevantChangeRequest } from "@t3tools/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  SettingsIcon,
  UserRoundIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { usePreparePullRequestThreadAction } from "../lib/sourceControlActions";
import { newThreadId } from "../lib/utils";
import {
  buildPullRequestThreadPrompt,
  filterProjectPullRequests,
  hasShowMeSkill,
  mergeProjectPullRequests,
  selectPullRequestSourceProjects,
  type ProjectPullRequest,
  type PullRequestOwnershipFilter,
} from "../pullRequests";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useProjects } from "../state/entities";
import { gitEnvironment } from "../state/git";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../workspaceTitlebar";
import { cn } from "../lib/utils";

interface PullRequestSourceSnapshot {
  readonly project: EnvironmentProject;
  readonly pending: boolean;
  readonly error: string | null;
  readonly supported: boolean;
  readonly pullRequests: ReadonlyArray<RelevantChangeRequest>;
}

function ProjectPullRequestSource(props: {
  project: EnvironmentProject;
  refreshRequest: number;
  onChange: (key: string, snapshot: PullRequestSourceSnapshot) => void;
}) {
  const key = `${props.project.environmentId}:${props.project.id}`;
  const query = useEnvironmentQuery(
    gitEnvironment.relevantPullRequests({
      environmentId: props.project.environmentId,
      input: { cwd: props.project.workspaceRoot, limit: 100 },
    }),
  );

  useEffect(() => {
    props.onChange(key, {
      project: props.project,
      pending: query.isPending,
      error: query.error,
      supported: query.data?.supported ?? false,
      pullRequests: query.data?.pullRequests ?? [],
    });
  }, [key, props.onChange, props.project, query.data, query.error, query.isPending]);

  useEffect(() => {
    if (props.refreshRequest > 0) query.refresh();
  }, [props.refreshRequest, query.refresh]);

  return null;
}

function relationLabel(pullRequest: RelevantChangeRequest): string {
  if (pullRequest.authoredByViewer && pullRequest.reviewRequestedFromViewer) {
    return "Yours · review requested";
  }
  return pullRequest.authoredByViewer ? "Your PR" : "Review requested";
}

function PullRequestActions({
  item,
}: {
  item: ProjectPullRequest & { project: EnvironmentProject };
}) {
  const [startingAction, setStartingAction] = useState<"review" | "show-me" | null>(null);
  const handleNewThread = useNewThreadHandler();
  const providers = useAtomValue(serverEnvironment.providersValueAtom(item.project.environmentId));
  const preparePullRequest = usePreparePullRequestThreadAction({
    environmentId: item.project.environmentId,
    cwd: item.project.workspaceRoot,
  });
  const pullRequest = item.pullRequest;

  const startThread = useCallback(
    async (action: "review" | "show-me") => {
      if (startingAction !== null) return;
      setStartingAction(action);
      const threadId = newThreadId();
      try {
        const prepared = await preparePullRequest.run({
          reference: pullRequest.url,
          mode: "worktree",
          threadId,
        });
        if (prepared._tag === "Failure") {
          if (isAtomCommandInterrupted(prepared)) preparePullRequest.resetError();
          throw squashAtomCommandFailure(prepared);
        }
        await handleNewThread(scopeProjectRef(item.project.environmentId, item.project.id), {
          branch: prepared.value.branch,
          worktreePath: prepared.value.worktreePath,
          envMode: "worktree",
          forceNew: true,
          threadId,
          initialPrompt: buildPullRequestThreadPrompt(pullRequest, {
            showMe: action === "show-me",
            showMeSkillAvailable: hasShowMeSkill(providers),
          }),
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not open ${pullRequest.repositoryNameWithOwner}#${pullRequest.number}`,
            description:
              error instanceof Error ? error.message : "The PR worktree could not be prepared.",
          }),
        );
      } finally {
        setStartingAction(null);
      }
    },
    [handleNewThread, item.project, preparePullRequest, providers, pullRequest, startingAction],
  );

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={startingAction !== null}
        onClick={() => void startThread("show-me")}
      >
        {startingAction === "show-me" ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <PlayIcon />
        )}
        Show me
      </Button>
      <Button
        size="sm"
        disabled={startingAction !== null}
        onClick={() => void startThread("review")}
      >
        {startingAction === "review" ? <LoaderCircleIcon className="animate-spin" /> : null}
        Review
      </Button>
    </>
  );
}

function PullRequestCard({ item }: { item: ProjectPullRequest }) {
  const pullRequest = item.pullRequest;
  return (
    <article className="group rounded-xl border border-border/70 bg-card px-4 py-3.5 shadow-xs transition-[border-color,box-shadow] hover:border-border hover:shadow-sm dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/35 text-muted-foreground">
          <GitPullRequestIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-mono font-medium text-foreground/75">
              {pullRequest.repositoryNameWithOwner}#{pullRequest.number}
            </span>
            <span aria-hidden="true">·</span>
            <span>{relationLabel(pullRequest)}</span>
            {pullRequest.isDraft ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium">Draft</span>
            ) : null}
            {pullRequest.updatedAt ? (
              <span className="ml-auto shrink-0">
                {formatRelativeTimeLabel(pullRequest.updatedAt)}
              </span>
            ) : null}
          </div>
          <h2 className="mt-1.5 text-sm leading-snug font-medium text-card-foreground">
            {pullRequest.title}
          </h2>
          <div className="mt-2 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {pullRequest.headRefName && pullRequest.baseRefName ? (
              <>
                <span className="max-w-56 truncate">{pullRequest.headRefName}</span>
                <ArrowRightIcon className="size-3 shrink-0" />
                <span className="max-w-40 truncate">{pullRequest.baseRefName}</span>
              </>
            ) : null}
            {pullRequest.authorLogin ? (
              <span className="ml-2 inline-flex min-w-0 items-center gap-1 font-sans">
                <UserRoundIcon className="size-3 shrink-0" />
                <span className="truncate">{pullRequest.authorLogin}</span>
              </span>
            ) : null}
          </div>
          {item.project === null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Add this repository as a project to review it in a worktree.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            render={<a href={pullRequest.url} target="_blank" rel="noreferrer" />}
          >
            GitHub
            <ArrowUpRightIcon className="size-3.5" />
          </Button>
          {item.project ? (
            <PullRequestActions item={{ ...item, project: item.project }} />
          ) : (
            <>
              <Button size="sm" variant="outline" disabled>
                <PlayIcon />
                Show me
              </Button>
              <Button size="sm" disabled>
                Review
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function PullRequestsRouteView() {
  const projects = useProjects();
  const sourceProjects = useMemo(() => selectPullRequestSourceProjects(projects), [projects]);
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, PullRequestSourceSnapshot>>(
    () => new Map(),
  );
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [ownershipFilter, setOwnershipFilter] = useState<PullRequestOwnershipFilter>("relevant");
  const [repositoryFilter, setRepositoryFilter] = useState("all");
  const updateSnapshot = useCallback((key: string, snapshot: PullRequestSourceSnapshot) => {
    setSnapshots((current) => new Map(current).set(key, snapshot));
  }, []);
  const activeSnapshots = useMemo(
    () =>
      sourceProjects.flatMap((project) => {
        const snapshot = snapshots.get(`${project.environmentId}:${project.id}`);
        return snapshot ? [snapshot] : [];
      }),
    [snapshots, sourceProjects],
  );
  const items = useMemo(
    () =>
      mergeProjectPullRequests(
        activeSnapshots.map((snapshot) => ({
          project: snapshot.project,
          pullRequests: snapshot.pullRequests,
        })),
        projects,
      ),
    [activeSnapshots, projects],
  );
  const repositories = useMemo(
    () => [...new Set(items.map((item) => item.pullRequest.repositoryNameWithOwner))].toSorted(),
    [items],
  );
  const visibleItems = useMemo(
    () =>
      filterProjectPullRequests(items, {
        ownership: ownershipFilter,
        repository: repositoryFilter,
      }),
    [items, ownershipFilter, repositoryFilter],
  );
  const loading =
    sourceProjects.length > 0 &&
    (activeSnapshots.length < sourceProjects.length ||
      activeSnapshots.some((item) => item.pending));
  const errors = activeSnapshots.filter((snapshot) => snapshot.error !== null);
  const supportedSources = activeSnapshots.filter((snapshot) => snapshot.supported);

  useEffect(() => {
    if (repositoryFilter !== "all" && !repositories.includes(repositoryFilter)) {
      setRepositoryFilter("all");
    }
  }, [repositories, repositoryFilter]);

  return (
    <SidebarInset className="flex h-svh min-w-0 overflow-hidden bg-background text-foreground">
      {sourceProjects.map((project) => (
        <ProjectPullRequestSource
          key={`${project.environmentId}:${project.id}`}
          project={project}
          refreshRequest={refreshRequest}
          onChange={updateSnapshot}
        />
      ))}
      <div className="flex min-h-0 flex-1 flex-col">
        <header
          className={cn(
            "flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-xs">
              <GitPullRequestIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Pull requests</h1>
              <p className="truncate text-[11px] text-muted-foreground">
                {loading
                  ? "Checking your GitHub work…"
                  : `${visibleItems.length} relevant open PRs`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border bg-muted/35 p-0.5">
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground",
                  ownershipFilter === "relevant" && "bg-background text-foreground shadow-xs",
                )}
                onClick={() => setOwnershipFilter("relevant")}
              >
                Relevant
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground",
                  ownershipFilter === "mine" && "bg-background text-foreground shadow-xs",
                )}
                onClick={() => setOwnershipFilter("mine")}
              >
                My work
              </button>
            </div>
            <select
              value={repositoryFilter}
              onChange={(event) => setRepositoryFilter(event.currentTarget.value)}
              className="h-8 max-w-64 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Filter by repository"
            >
              <option value="all">All repositories</option>
              {repositories.map((repository) => (
                <option key={repository} value={repository}>
                  {repository}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRefreshRequest((value) => value + 1)}
            >
              <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Source control settings"
              title="Source control settings"
              render={<Link to="/settings/source-control" />}
            >
              <SettingsIcon className="size-3.5" />
            </Button>
          </div>
        </header>

        {errors.length > 0 && supportedSources.length > 0 ? (
          <div className="border-b border-warning/30 bg-warning/8 px-4 py-2 text-xs text-warning-foreground">
            {errors.length} {errors.length === 1 ? "repository" : "repositories"} could not be
            checked. Showing the results that loaded.
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto grid w-full max-w-5xl gap-2.5">
            {visibleItems.map((item) => (
              <PullRequestCard key={item.pullRequest.url} item={item} />
            ))}
          </div>

          {loading && items.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading pull requests
            </div>
          ) : sourceProjects.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <GitPullRequestIcon className="mx-auto size-6 text-muted-foreground" />
                <h2 className="mt-3 text-sm font-medium">Add a project first</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Pull requests are discovered from GitHub repositories attached to T3 projects.
                </p>
              </div>
            </div>
          ) : !loading && supportedSources.length === 0 && errors.length > 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
                <CircleAlertIcon className="mx-auto size-5 text-destructive" />
                <h2 className="mt-3 text-sm font-medium">GitHub pull requests are unavailable</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Check that GitHub CLI is installed and authenticated in the environment that owns
                  these projects.
                </p>
                <Button
                  className="mt-4"
                  size="sm"
                  variant="outline"
                  render={<Link to="/settings/source-control" />}
                >
                  Source control settings
                </Button>
              </div>
            </div>
          ) : !loading && visibleItems.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <GitPullRequestIcon className="mx-auto size-6 text-muted-foreground" />
                <h2 className="mt-3 text-sm font-medium">No matching pull requests</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  There are no open PRs authored by you or requesting your review for this filter.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/pull-requests")({
  component: PullRequestsRouteView,
});
