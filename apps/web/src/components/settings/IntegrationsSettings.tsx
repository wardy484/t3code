import {
  EnvironmentId,
  OrganizationId,
  type JiraAvailableBoard,
  type KanbanBoardSummary,
  type KanbanOrganization,
  type ProjectId,
} from "@t3tools/contracts";
import {
  Building2Icon,
  Columns3Icon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import * as Option from "effect/Option";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createJiraKanbanBoard,
  createKanbanOrganization,
  createNativeKanbanBoard,
  deleteKanbanBoard,
  deleteKanbanOrganization,
  discoverEnvironmentJiraBoards,
  fetchKanbanCatalog,
  notifyKanbanCatalogChanged,
  updateKanbanBoard,
  updateKanbanOrganization,
} from "../../kanban";
import { useActiveEnvironmentId, useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { usePreparedConnection } from "../../state/session";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

type Feedback = { readonly type: "success" | "error"; readonly message: string };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The board server returned an unexpected error.";

function ProjectChecklist({
  projects,
  selected,
  disabled = false,
  onChange,
}: {
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  readonly selected: ReadonlyArray<ProjectId>;
  readonly disabled?: boolean;
  readonly onChange: (projectIds: ReadonlyArray<ProjectId>) => void;
}) {
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  return (
    <div className="grid gap-1 rounded-lg border border-border/65 bg-muted/20 p-2">
      {projects.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          This environment has no projects yet.
        </p>
      ) : (
        projects.map((project) => (
          <label
            key={project.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
          >
            <Checkbox
              checked={selectedIds.has(project.id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...selected, project.id]
                    : selected.filter((projectId) => projectId !== project.id),
                )
              }
            />
            <span className="truncate">{project.title}</span>
          </label>
        ))
      )}
    </div>
  );
}

function BoardCard({
  board,
  projects,
  busy,
  onUpdate,
  onDelete,
}: {
  readonly board: KanbanBoardSummary;
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  readonly busy: boolean;
  readonly onUpdate: (projectIds: ReadonlyArray<ProjectId>) => void;
  readonly onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/65 bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{board.name}</p>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              {board.source === "native" ? "T3" : "Jira"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Starts work from {board.baseBranch}</p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={busy}
          aria-label={`Delete ${board.name}`}
          onClick={onDelete}
        >
          <Trash2Icon className="text-destructive" />
        </Button>
      </div>
      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Visible in projects</p>
        <ProjectChecklist
          projects={projects}
          selected={board.projectIds}
          disabled={busy}
          onChange={onUpdate}
        />
      </div>
    </div>
  );
}

export function IntegrationsSettings() {
  const { environments } = useEnvironments();
  const activeEnvironmentId = useActiveEnvironmentId();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(
    activeEnvironmentId ?? primaryEnvironmentId,
  );
  const [organizations, setOrganizations] = useState<ReadonlyArray<KanbanOrganization>>([]);
  const [boards, setBoards] = useState<ReadonlyArray<KanbanBoardSummary>>([]);
  const [organizationName, setOrganizationName] = useState("");
  const [nativeName, setNativeName] = useState("");
  const [nativeOrganizationId, setNativeOrganizationId] = useState<OrganizationId | null>(null);
  const [nativeProjectIds, setNativeProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const [nativeBaseBranch, setNativeBaseBranch] = useState("main");
  const [jiraOrganizationId, setJiraOrganizationId] = useState<OrganizationId | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [jiraRemoteBoards, setJiraRemoteBoards] = useState<ReadonlyArray<JiraAvailableBoard>>([]);
  const [jiraBoardId, setJiraBoardId] = useState("");
  const [jiraProjectIds, setJiraProjectIds] = useState<ReadonlyArray<ProjectId>>([]);
  const [jiraBaseBranch, setJiraBaseBranch] = useState("main");
  const [jiraJql, setJiraJql] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const preparedConnection = usePreparedConnection(environmentId);
  const environmentConnected =
    environmentId === primaryEnvironmentId || Option.isSome(preparedConnection);

  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const organizationById = useMemo(
    () => new Map(organizations.map((organization) => [organization.id, organization])),
    [organizations],
  );

  useEffect(() => {
    if (
      environmentId &&
      environments.some((environment) => environment.environmentId === environmentId)
    ) {
      return;
    }
    setEnvironmentId(
      activeEnvironmentId ?? primaryEnvironmentId ?? environments[0]?.environmentId ?? null,
    );
  }, [activeEnvironmentId, environmentId, environments, primaryEnvironmentId]);

  const loadCatalog = useCallback(async () => {
    if (!environmentId || !environmentConnected) {
      setOrganizations([]);
      setBoards([]);
      return;
    }
    setLoading(true);
    try {
      const catalog = await fetchKanbanCatalog(environmentId);
      setOrganizations(catalog.organizations);
      setBoards(catalog.boards);
      setNativeOrganizationId((current) => current ?? catalog.organizations[0]?.id ?? null);
      setJiraOrganizationId((current) => current ?? catalog.organizations[0]?.id ?? null);
    } catch (error) {
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [environmentConnected, environmentId]);

  useEffect(() => {
    setNativeOrganizationId(null);
    setJiraOrganizationId(null);
    setNativeProjectIds([]);
    setJiraProjectIds([]);
    setJiraRemoteBoards([]);
    setFeedback(null);
    void loadCatalog();
  }, [loadCatalog]);

  const mutate = useCallback(
    async (operation: () => Promise<unknown>, success: string) => {
      setBusy(true);
      setFeedback(null);
      try {
        await operation();
        await loadCatalog();
        notifyKanbanCatalogChanged();
        setFeedback({ type: "success", message: success });
      } catch (error) {
        setFeedback({ type: "error", message: errorMessage(error) });
      } finally {
        setBusy(false);
      }
    },
    [loadCatalog],
  );

  const createOrganization = useCallback(() => {
    const name = organizationName.trim();
    if (!environmentId || !name) return;
    void mutate(async () => {
      const organization = await createKanbanOrganization(environmentId, { name });
      setOrganizationName("");
      setNativeOrganizationId(organization.id);
      setJiraOrganizationId(organization.id);
    }, `${name} created.`);
  }, [environmentId, mutate, organizationName]);

  const discoverJira = useCallback(async () => {
    if (!environmentId || !jiraBaseUrl.trim() || !jiraEmail.trim() || !jiraApiToken.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await discoverEnvironmentJiraBoards(environmentId, {
        baseUrl: jiraBaseUrl.trim(),
        email: jiraEmail.trim(),
        apiToken: jiraApiToken.trim(),
      });
      setJiraRemoteBoards(result.boards);
      setFeedback({
        type: "success",
        message: `Connected as ${result.accountDisplayName}. Found ${result.boards.length} boards.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [environmentId, jiraApiToken, jiraBaseUrl, jiraEmail]);

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("boards-organizations")}
        icon={<Building2Icon className="size-4 text-muted-foreground" />}
      >
        <div className="space-y-5 px-3 py-2 sm:px-4">
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="boards-environment">
              Hosted on
            </label>
            <select
              id="boards-environment"
              value={environmentId ?? ""}
              onChange={(event) => setEnvironmentId(EnvironmentId.make(event.currentTarget.value))}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {environments.map((environment) => (
                <option key={environment.environmentId} value={environment.environmentId}>
                  {environment.label}
                  {environment.displayUrl ? ` · ${environment.displayUrl}` : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Organisations and boards live on this T3 environment. Remote clients see the same data
              through that connection.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              nativeInput
              value={organizationName}
              onChange={(event) => setOrganizationName(event.currentTarget.value)}
              placeholder="Organisation name"
              aria-label="Organisation name"
            />
            <Button
              disabled={busy || !environmentId || !environmentConnected || !organizationName.trim()}
              onClick={createOrganization}
            >
              <PlusIcon className="size-3.5" />
              Add organisation
            </Button>
          </div>

          {loading ? (
            <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading boards
            </div>
          ) : organizations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-5 text-center">
              <p className="text-sm font-medium">Create your first organisation</p>
              <p className="mt-1 text-xs text-muted-foreground">
                For example, T3 Code or Tutorful. Projects can belong to one organisation only.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {organizations.map((organization) => {
                const organizationProjects = projects.filter((project) =>
                  organization.projectIds.includes(project.id),
                );
                const organizationBoards = boards.filter(
                  (board) => board.organizationId === organization.id,
                );
                return (
                  <div key={organization.id} className="rounded-xl border border-border/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">{organization.name}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {organizationBoards.length}{" "}
                          {organizationBoards.length === 1 ? "board" : "boards"}
                        </p>
                      </div>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        disabled={busy || organizationBoards.length > 0}
                        title={
                          organizationBoards.length > 0 ? "Delete its boards first" : undefined
                        }
                        aria-label={`Delete ${organization.name}`}
                        onClick={() => {
                          if (!environmentId) return;
                          void mutate(
                            () =>
                              deleteKanbanOrganization(environmentId, {
                                organizationId: organization.id,
                              }),
                            `${organization.name} deleted.`,
                          );
                        }}
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                    <div className="mt-3">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Projects</p>
                      <ProjectChecklist
                        projects={projects}
                        selected={organization.projectIds}
                        disabled={busy}
                        onChange={(projectIds) => {
                          if (!environmentId) return;
                          void mutate(
                            () =>
                              updateKanbanOrganization(environmentId, {
                                organizationId: organization.id,
                                name: organization.name,
                                projectIds: [...projectIds],
                              }),
                            `${organization.name} projects updated.`,
                          );
                        }}
                      />
                    </div>
                    {organizationBoards.length > 0 ? (
                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        {organizationBoards.map((board) => (
                          <BoardCard
                            key={board.id}
                            board={board}
                            projects={organizationProjects}
                            busy={busy}
                            onUpdate={(projectIds) => {
                              if (!environmentId) return;
                              void mutate(
                                () =>
                                  updateKanbanBoard(environmentId, {
                                    boardId: board.id,
                                    name: board.name,
                                    projectIds: [...projectIds],
                                    baseBranch: board.baseBranch,
                                  }),
                                `${board.name} projects updated.`,
                              );
                            }}
                            onDelete={() => {
                              if (!environmentId) return;
                              void mutate(
                                () => deleteKanbanBoard(environmentId, { boardId: board.id }),
                                `${board.name} deleted.`,
                              );
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        {...searchableSetting("native-boards")}
        icon={<Columns3Icon className="size-4 text-muted-foreground" />}
      >
        <div className="grid gap-4 px-3 py-2 sm:px-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm font-medium">
              Organisation
              <select
                value={nativeOrganizationId ?? ""}
                onChange={(event) => {
                  setNativeOrganizationId(OrganizationId.make(event.currentTarget.value));
                  setNativeProjectIds([]);
                }}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  Select an organisation
                </option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Board name
              <Input
                nativeInput
                value={nativeName}
                onChange={(event) => setNativeName(event.currentTarget.value)}
                placeholder="Product"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Base branch
              <Input
                nativeInput
                value={nativeBaseBranch}
                onChange={(event) => setNativeBaseBranch(event.currentTarget.value)}
              />
            </label>
          </div>
          <ProjectChecklist
            projects={projects.filter((project) =>
              nativeOrganizationId
                ? organizationById.get(nativeOrganizationId)?.projectIds.includes(project.id)
                : false,
            )}
            selected={nativeProjectIds}
            disabled={busy}
            onChange={setNativeProjectIds}
          />
          <div className="flex justify-end">
            <Button
              disabled={
                busy ||
                !environmentId ||
                !nativeOrganizationId ||
                !nativeName.trim() ||
                !nativeBaseBranch.trim()
              }
              onClick={() => {
                if (!environmentId || !nativeOrganizationId) return;
                const name = nativeName.trim();
                void mutate(async () => {
                  await createNativeKanbanBoard(environmentId, {
                    organizationId: nativeOrganizationId,
                    name,
                    projectIds: [...nativeProjectIds],
                    baseBranch: nativeBaseBranch.trim(),
                  });
                  setNativeName("");
                  setNativeProjectIds([]);
                }, `${name} created.`);
              }}
            >
              <PlusIcon className="size-3.5" />
              Add T3 board
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        {...searchableSetting("jira-boards")}
        icon={<Columns3Icon className="size-4 text-muted-foreground" />}
      >
        <div className="grid gap-4 px-3 py-2 sm:px-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Organisation
              <select
                value={jiraOrganizationId ?? ""}
                onChange={(event) => {
                  setJiraOrganizationId(OrganizationId.make(event.currentTarget.value));
                  setJiraProjectIds([]);
                }}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  Select an organisation
                </option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Jira site URL
              <Input
                nativeInput
                type="url"
                value={jiraBaseUrl}
                onChange={(event) => setJiraBaseUrl(event.currentTarget.value)}
                placeholder="https://company.atlassian.net"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Account email
              <Input
                nativeInput
                type="email"
                value={jiraEmail}
                onChange={(event) => setJiraEmail(event.currentTarget.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              API token
              <Input
                nativeInput
                type="password"
                value={jiraApiToken}
                onChange={(event) => setJiraApiToken(event.currentTarget.value)}
                placeholder="Stored on this T3 server"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              disabled={
                busy ||
                !environmentId ||
                !jiraBaseUrl.trim() ||
                !jiraEmail.trim() ||
                !jiraApiToken.trim()
              }
              onClick={() => void discoverJira()}
            >
              {busy ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
              Load Jira boards
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Jira board
              <select
                value={jiraBoardId}
                onChange={(event) => setJiraBoardId(event.currentTarget.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">Load and select a board</option>
                {jiraRemoteBoards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name} · #{board.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Base branch
              <Input
                nativeInput
                value={jiraBaseBranch}
                onChange={(event) => setJiraBaseBranch(event.currentTarget.value)}
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            JQL override <span className="font-normal text-muted-foreground">Optional</span>
            <Textarea
              value={jiraJql}
              onChange={(event) => setJiraJql(event.currentTarget.value)}
              placeholder="project = KG ORDER BY Rank ASC"
              className="font-mono text-xs"
            />
          </label>
          <ProjectChecklist
            projects={projects.filter((project) =>
              jiraOrganizationId
                ? organizationById.get(jiraOrganizationId)?.projectIds.includes(project.id)
                : false,
            )}
            selected={jiraProjectIds}
            disabled={busy}
            onChange={setJiraProjectIds}
          />
          <div className="flex justify-end">
            <Button
              disabled={
                busy ||
                !environmentId ||
                !jiraOrganizationId ||
                !jiraBoardId ||
                !jiraBaseBranch.trim()
              }
              onClick={() => {
                if (!environmentId || !jiraOrganizationId) return;
                const remoteBoard = jiraRemoteBoards.find(
                  (board) => String(board.id) === jiraBoardId,
                );
                void mutate(
                  async () => {
                    await createJiraKanbanBoard(environmentId, {
                      organizationId: jiraOrganizationId,
                      baseUrl: jiraBaseUrl.trim(),
                      email: jiraEmail.trim(),
                      ...(jiraApiToken.trim() ? { apiToken: jiraApiToken.trim() } : {}),
                      jiraBoardId: Number(jiraBoardId),
                      jql: jiraJql.trim(),
                      projectIds: [...jiraProjectIds],
                      baseBranch: jiraBaseBranch.trim(),
                    });
                    setJiraBoardId("");
                    setJiraProjectIds([]);
                    setJiraApiToken("");
                  },
                  `${remoteBoard?.name ?? "Jira board"} added.`,
                );
              }}
            >
              <PlusIcon className="size-3.5" />
              Add Jira board
            </Button>
          </div>
          {feedback ? (
            <p
              role={feedback.type === "error" ? "alert" : "status"}
              className={`text-sm ${feedback.type === "error" ? "text-destructive" : "text-success"}`}
            >
              {feedback.message}
            </p>
          ) : null}
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
