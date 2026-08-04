import { Columns3Icon, LoaderCircleIcon, PlugZapIcon, SearchIcon, UnplugIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JiraAvailableBoard, JiraIntegrationStatus } from "@t3tools/contracts";

import {
  discoverJiraBoards,
  disconnectJira,
  fetchJiraIntegrationStatus,
  notifyJiraConfigurationChanged,
  saveJiraConfiguration,
} from "../../jira";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

type JiraFormState = {
  readonly baseUrl: string;
  readonly email: string;
  readonly apiToken: string;
  readonly boardId: string;
  readonly jql: string;
  readonly projectPath: string;
  readonly baseBranch: string;
};

const EMPTY_FORM: JiraFormState = {
  baseUrl: "",
  email: "",
  apiToken: "",
  boardId: "",
  jql: "",
  projectPath: "",
  baseBranch: "main",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Jira returned an unexpected error.";
}

function formFromStatus(status: JiraIntegrationStatus): JiraFormState {
  const configuration = status.configuration;
  return configuration
    ? {
        baseUrl: configuration.baseUrl,
        email: configuration.email,
        apiToken: "",
        boardId: String(configuration.boardId),
        jql: configuration.jql,
        projectPath: configuration.projectPath,
        baseBranch: configuration.baseBranch,
      }
    : EMPTY_FORM;
}

function configurationError(form: JiraFormState, hasApiToken: boolean): string | null {
  try {
    const url = new URL(form.baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "Enter a valid Jira URL.";
    }
  } catch {
    return "Enter a valid Jira URL.";
  }
  if (!form.email.trim()) return "Enter the Jira account email.";
  if (!hasApiToken && !form.apiToken.trim()) return "Enter a Jira API token.";
  if (!Number.isSafeInteger(Number(form.boardId)) || Number(form.boardId) <= 0) {
    return "Select a Jira board.";
  }
  if (!form.projectPath.trim()) return "Select a T3 project.";
  if (!form.baseBranch.trim()) return "Enter the branch new work should start from.";
  return null;
}

function FormField({
  label,
  description,
  containsInteractiveControl = false,
  children,
}: {
  readonly label: string;
  readonly description?: string;
  readonly containsInteractiveControl?: boolean;
  readonly children: React.ReactNode;
}) {
  const content = (
    <>
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {description ? (
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      ) : null}
    </>
  );
  return containsInteractiveControl ? (
    <div className="grid gap-1.5">{content}</div>
  ) : (
    <label className="grid gap-1.5">{content}</label>
  );
}

export function IntegrationsSettings() {
  const primaryEnvironment = usePrimaryEnvironment();
  const projects = useProjects();
  const primaryProjects = useMemo(
    () => projects.filter((project) => project.environmentId === primaryEnvironment?.environmentId),
    [primaryEnvironment?.environmentId, projects],
  );
  const [form, setForm] = useState<JiraFormState>(EMPTY_FORM);
  const [boards, setBoards] = useState<ReadonlyArray<JiraAvailableBoard>>([]);
  const [boardQuery, setBoardQuery] = useState("");
  const [hasApiToken, setHasApiToken] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [accountDisplayName, setAccountDisplayName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"test" | "save" | "disconnect" | null>(null);
  const [feedback, setFeedback] = useState<{
    readonly type: "success" | "error";
    readonly message: string;
  } | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const updateForm = useCallback(
    <K extends keyof JiraFormState>(key: K, value: JiraFormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
      setFeedback(null);
    },
    [],
  );

  const discover = useCallback(async (nextForm: JiraFormState, nextHasApiToken: boolean) => {
    const validationError = configurationError(nextForm, nextHasApiToken);
    if (validationError && validationError !== "Select a Jira board.") {
      throw new Error(validationError);
    }
    const result = await discoverJiraBoards({
      baseUrl: nextForm.baseUrl,
      email: nextForm.email,
      ...(nextForm.apiToken.trim() ? { apiToken: nextForm.apiToken.trim() } : {}),
    });
    setBoards(result.boards);
    setAccountDisplayName(result.accountDisplayName);
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    void fetchJiraIntegrationStatus()
      .then(async (status) => {
        if (!active) return;
        const nextForm = formFromStatus(status);
        const nextHasApiToken = status.configuration?.hasApiToken ?? false;
        setForm(nextForm);
        setHasApiToken(nextHasApiToken);
        setConfigured(status.configured);
        if (status.configuration && nextHasApiToken) {
          try {
            await discover(nextForm, nextHasApiToken);
          } catch (error) {
            if (active) setFeedback({ type: "error", message: errorMessage(error) });
          }
        }
      })
      .catch((error) => {
        if (active) setFeedback({ type: "error", message: errorMessage(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [discover]);

  const handleTest = useCallback(async () => {
    setBusyAction("test");
    setFeedback(null);
    try {
      const result = await discover(form, hasApiToken);
      setFeedback({
        type: "success",
        message: `Connected as ${result.accountDisplayName}. Found ${result.boards.length} ${result.boards.length === 1 ? "board" : "boards"}.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }, [discover, form, hasApiToken]);

  const handleSave = useCallback(async () => {
    const validationError = configurationError(form, hasApiToken);
    if (validationError) {
      setFeedback({ type: "error", message: validationError });
      return;
    }
    setBusyAction("save");
    setFeedback(null);
    try {
      const status = await saveJiraConfiguration({
        baseUrl: form.baseUrl,
        email: form.email,
        ...(form.apiToken.trim() ? { apiToken: form.apiToken.trim() } : {}),
        boardId: Number(form.boardId),
        jql: form.jql,
        projectPath: form.projectPath,
        baseBranch: form.baseBranch,
      });
      setForm(formFromStatus(status));
      setHasApiToken(status.configuration?.hasApiToken ?? false);
      setConfigured(status.configured);
      notifyJiraConfigurationChanged();
      setFeedback({ type: "success", message: "Jira integration saved." });
    } catch (error) {
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }, [form, hasApiToken]);

  const handleDisconnect = useCallback(async () => {
    setBusyAction("disconnect");
    setFeedback(null);
    try {
      await disconnectJira();
      setForm(EMPTY_FORM);
      setBoards([]);
      setBoardQuery("");
      setHasApiToken(false);
      setConfigured(false);
      setAccountDisplayName(null);
      notifyJiraConfigurationChanged();
      setDisconnectOpen(false);
      setFeedback({ type: "success", message: "Jira integration disconnected." });
    } catch (error) {
      setFeedback({ type: "error", message: errorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }, []);

  const configuredBoardMissing =
    form.boardId.length > 0 && !boards.some((board) => String(board.id) === form.boardId);
  const configuredProjectMissing =
    form.projectPath.length > 0 &&
    !primaryProjects.some((project) => project.workspaceRoot === form.projectPath);
  const selectedBoard = boards.find((board) => String(board.id) === form.boardId);
  const selectedProject = primaryProjects.find(
    (project) => project.workspaceRoot === form.projectPath,
  );
  const boardOptions = [
    ...(configuredBoardMissing
      ? [
          {
            value: form.boardId,
            label: `Configured board (${form.boardId})`,
            detail: `Board ID ${form.boardId}`,
          },
        ]
      : []),
    ...boards.map((board) => {
      const project =
        board.location?.projectName ?? board.location?.displayName ?? board.location?.projectKey;
      const projectKey = board.location?.projectKey;
      return {
        value: String(board.id),
        label: board.name,
        detail: [
          project && projectKey && project !== projectKey ? `${project} (${projectKey})` : project,
          board.type,
          `#${board.id}`,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }),
  ];
  const normalizedBoardQuery = boardQuery.trim().toLocaleLowerCase();
  const filteredBoardOptions = boardOptions.filter(
    (board) =>
      normalizedBoardQuery.length === 0 ||
      `${board.label} ${board.detail}`.toLocaleLowerCase().includes(normalizedBoardQuery) ||
      board.value.includes(normalizedBoardQuery),
  );
  const filteredBoardValues = filteredBoardOptions.map((board) => board.value);

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("jira-integration")}
        icon={<Columns3Icon className="size-4 text-muted-foreground" />}
        headerAction={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={`size-2 rounded-full ${configured ? "bg-success" : "bg-muted-foreground/40"}`}
            />
            {configured ? "Connected" : "Not connected"}
          </span>
        }
      >
        <div className="px-3 py-2 sm:px-4">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading Jira settings
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Jira site URL"
                    description="For example, https://company.atlassian.net"
                  >
                    <Input
                      nativeInput
                      type="url"
                      autoComplete="url"
                      value={form.baseUrl}
                      onChange={(event) => updateForm("baseUrl", event.currentTarget.value)}
                      placeholder="https://company.atlassian.net"
                    />
                  </FormField>
                  <FormField label="Account email">
                    <Input
                      nativeInput
                      type="email"
                      autoComplete="username"
                      value={form.email}
                      onChange={(event) => updateForm("email", event.currentTarget.value)}
                      placeholder="you@example.com"
                    />
                  </FormField>
                </div>
                <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <FormField
                    label="API token"
                    description={
                      hasApiToken
                        ? "A token is configured. Leave this blank to keep it, or enter a replacement."
                        : "Stored only on the T3 server and never returned to clients."
                    }
                  >
                    <Input
                      nativeInput
                      type="password"
                      autoComplete="new-password"
                      value={form.apiToken}
                      onChange={(event) => updateForm("apiToken", event.currentTarget.value)}
                      placeholder={hasApiToken ? "Configured token" : "Enter API token"}
                    />
                  </FormField>
                  <div className="flex items-end sm:pb-5">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busyAction !== null}
                      onClick={() => void handleTest()}
                    >
                      {busyAction === "test" ? (
                        <LoaderCircleIcon className="size-3.5 animate-spin" />
                      ) : (
                        <PlugZapIcon className="size-3.5" />
                      )}
                      Test connection
                    </Button>
                  </div>
                </div>
              </div>

              <div className="border-t border-border/60 pt-4">
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-foreground">Board and work</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Choose which Jira work appears in Tickets and where new work starts.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Board" containsInteractiveControl>
                    <div className="grid gap-2">
                      <div className="relative">
                        <SearchIcon
                          aria-hidden="true"
                          className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground/60"
                        />
                        <Input
                          nativeInput
                          type="search"
                          aria-label="Search Jira boards"
                          value={boardQuery}
                          onChange={(event) => setBoardQuery(event.currentTarget.value)}
                          placeholder="Search boards by name or project"
                          className="[&_input]:ps-8"
                        />
                      </div>
                      <Select
                        value={form.boardId || null}
                        onValueChange={(value) => {
                          if (!value) return;
                          updateForm("boardId", value);
                          setBoardQuery("");
                        }}
                      >
                        <SelectTrigger aria-label="Jira board">
                          <SelectValue placeholder="Test connection to load boards">
                            {selectedBoard
                              ? [
                                  selectedBoard.name,
                                  selectedBoard.location?.projectKey ?? selectedBoard.type,
                                ].join(" · ")
                              : form.boardId
                                ? `Configured board (${form.boardId})`
                                : null}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {filteredBoardOptions.map((board) => (
                            <SelectItem key={board.value} value={board.value} className="py-1.5">
                              <div className="min-w-0">
                                <div className="truncate">{board.label}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {board.detail}
                                </div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      {normalizedBoardQuery && filteredBoardValues.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No matching boards.</span>
                      ) : null}
                    </div>
                  </FormField>
                  <FormField
                    label="T3 project"
                    description="New ticket threads start in this project."
                    containsInteractiveControl
                  >
                    <Select
                      value={form.projectPath || null}
                      onValueChange={(value) => value && updateForm("projectPath", value)}
                    >
                      <SelectTrigger aria-label="T3 project">
                        <SelectValue placeholder="Select a project">
                          {selectedProject?.title ?? (form.projectPath || null)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {configuredProjectMissing ? (
                          <SelectItem value={form.projectPath}>{form.projectPath}</SelectItem>
                        ) : null}
                        {primaryProjects.map((project) => (
                          <SelectItem key={project.id} value={project.workspaceRoot}>
                            {project.title}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </FormField>
                  <FormField
                    label="Base branch"
                    description="Used when Start work creates a worktree."
                  >
                    <Input
                      nativeInput
                      value={form.baseBranch}
                      onChange={(event) => updateForm("baseBranch", event.currentTarget.value)}
                      placeholder="main"
                    />
                  </FormField>
                  <FormField
                    label="JQL override"
                    description="Optional. Leave blank to use the board's active sprint or saved filter."
                  >
                    <Textarea
                      value={form.jql}
                      onChange={(event) => updateForm("jql", event.currentTarget.value)}
                      placeholder="project = KG AND statusCategory != Done ORDER BY Rank ASC"
                      className="font-mono text-xs"
                    />
                  </FormField>
                </div>
              </div>

              {feedback ? (
                <p
                  role={feedback.type === "error" ? "alert" : "status"}
                  className={`text-sm ${feedback.type === "error" ? "text-destructive" : "text-success"}`}
                >
                  {feedback.message}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                <div className="flex min-w-0 items-center gap-3">
                  {configured ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busyAction !== null}
                      onClick={() => setDisconnectOpen(true)}
                    >
                      <UnplugIcon className="size-3.5" />
                      Disconnect
                    </Button>
                  ) : null}
                  {!feedback && accountDisplayName ? (
                    <span className="truncate text-xs text-muted-foreground">
                      Connected as {accountDisplayName}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => void handleSave()}
                >
                  {busyAction === "save" ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Jira?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved Jira configuration and API token from this T3 environment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={busyAction === "disconnect"}
              onClick={() => void handleDisconnect()}
            >
              {busyAction === "disconnect" ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : null}
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsPageContainer>
  );
}
