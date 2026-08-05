"use client";

import {
  EnvironmentFileId,
  type EnvironmentFileReadResult,
  type EnvironmentFileRegistration,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  EyeIcon,
  EyeOffIcon,
  FileKey2Icon,
  LoaderIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatFileMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function AddEnvironmentFileDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const settings = usePrimarySettings();
  const primaryEnvironment = usePrimaryEnvironment();
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const [label, setLabel] = useState("");
  const [filePath, setFilePath] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const reset = () => {
    setLabel("");
    setFilePath("");
    setIsSaving(false);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const addFile = () => {
    const environmentId = primaryEnvironment?.environmentId;
    const normalizedLabel = label.trim();
    const normalizedPath = filePath.trim();
    if (!environmentId || !normalizedLabel || !normalizedPath || isSaving) return;
    if (settings.environmentFiles.some((file) => file.path === normalizedPath)) {
      toastManager.add({
        type: "error",
        title: "File already added",
        description: "That path is already registered in this environment.",
      });
      return;
    }

    const registration: EnvironmentFileRegistration = {
      id: EnvironmentFileId.make(window.crypto.randomUUID()),
      label: normalizedLabel,
      path: normalizedPath,
    };
    setIsSaving(true);
    void (async () => {
      const result = await updateSettings({
        environmentId,
        input: {
          patch: { environmentFiles: [...settings.environmentFiles, registration] },
        },
      });
      setIsSaving(false);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        toastManager.add({
          type: "error",
          title: "Could not add env file",
          description: errorMessage(squashAtomCommandFailure(result), "The file was not added."),
        });
        return;
      }
      toastManager.add({
        type: "success",
        title: "Env file added",
        description: normalizedPath,
      });
      close();
    })();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add env file</DialogTitle>
          <DialogDescription>
            Register an existing file on {primaryEnvironment?.label ?? "this environment"}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            Name
            <Input
              value={label}
              onValueChange={setLabel}
              placeholder="Braze"
              autoComplete="off"
              autoFocus
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            Absolute file path
            <Input
              value={filePath}
              onValueChange={setFilePath}
              placeholder="/root/.config/codex/braze.env"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === "Enter") addFile();
              }}
            />
          </label>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={addFile}
            disabled={isSaving || !label.trim() || !filePath.trim() || !primaryEnvironment}
          >
            {isSaving ? <LoaderIcon className="animate-spin" /> : <PlusIcon />}
            Add file
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function EnvironmentFilesSettings() {
  const settings = usePrimarySettings();
  const primaryEnvironment = usePrimaryEnvironment();
  const readEnvironmentFile = useAtomCommand(serverEnvironment.readEnvironmentFile, {
    reportFailure: false,
  });
  const writeEnvironmentFile = useAtomCommand(serverEnvironment.writeEnvironmentFile, {
    reportFailure: false,
  });
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const [selectedId, setSelectedId] = useState<EnvironmentFileId | null>(null);
  const [snapshot, setSnapshot] = useState<EnvironmentFileReadResult | null>(null);
  const [draft, setDraft] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUntracking, setIsUntracking] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const editorVersionRef = useRef(0);

  const files = settings.environmentFiles;
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const isSupported =
    primaryEnvironment?.serverConfig?.environment.capabilities.environmentFiles === true;
  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedId) ?? null,
    [files, selectedId],
  );
  const isDirty = snapshot !== null && draft !== snapshot.contents;

  useEffect(() => {
    const selectedStillExists = files.some((file) => file.id === selectedId);
    if (selectedStillExists) return;
    editorVersionRef.current += 1;
    setSelectedId(files[0]?.id ?? null);
    setSnapshot(null);
    setDraft("");
  }, [files, selectedId]);

  useEffect(() => {
    editorVersionRef.current += 1;
    setSelectedId(null);
    setSnapshot(null);
    setDraft("");
    setIsReading(false);
    setIsSaving(false);
    setIsUntracking(false);
    setIsAddDialogOpen(false);
  }, [environmentId]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  const clearEditor = () => {
    editorVersionRef.current += 1;
    setSnapshot(null);
    setDraft("");
    setIsReading(false);
    setIsSaving(false);
    setIsUntracking(false);
  };

  const hideEditor = () => {
    if (isDirty && !window.confirm("Hide this file and discard your unsaved changes?")) return;
    clearEditor();
  };

  const selectFile = (nextId: string | null) => {
    if (!nextId || nextId === selectedId) return;
    if (isDirty && !window.confirm("Discard your unsaved env file changes?")) return;
    clearEditor();
    setSelectedId(EnvironmentFileId.make(nextId));
  };

  const reveal = () => {
    const environmentId = primaryEnvironment?.environmentId;
    if (!environmentId || !selectedFile || isReading) return;
    const requestVersion = editorVersionRef.current + 1;
    editorVersionRef.current = requestVersion;
    setIsReading(true);
    void (async () => {
      const result = await readEnvironmentFile({
        environmentId,
        input: { id: selectedFile.id },
      });
      if (editorVersionRef.current !== requestVersion) return;
      setIsReading(false);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        toastManager.add({
          type: "error",
          title: "Could not open env file",
          description: errorMessage(squashAtomCommandFailure(result), "The file was not opened."),
        });
        return;
      }
      setSnapshot(result.value);
      setDraft(result.value.contents);
    })();
  };

  const save = () => {
    const environmentId = primaryEnvironment?.environmentId;
    if (!environmentId || !selectedFile || !snapshot || !isDirty || isSaving) return;
    const requestVersion = editorVersionRef.current;
    setIsSaving(true);
    void (async () => {
      const result = await writeEnvironmentFile({
        environmentId,
        input: {
          id: selectedFile.id,
          contents: draft,
          expectedRevision: snapshot.revision,
        },
      });
      if (editorVersionRef.current !== requestVersion) return;
      setIsSaving(false);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        toastManager.add({
          type: "error",
          title: "Could not save env file",
          description: errorMessage(squashAtomCommandFailure(result), "The file was not saved."),
        });
        return;
      }
      setSnapshot({ contents: draft, revision: result.value.revision, mode: result.value.mode });
      toastManager.add({ type: "success", title: "Env file saved" });
    })();
  };

  const untrack = () => {
    if (!environmentId || !selectedFile || isUntracking) return;
    if (isDirty && !window.confirm("Untrack this file and discard your unsaved changes?")) return;
    const remaining = files.filter((file) => file.id !== selectedFile.id);
    const requestVersion = editorVersionRef.current;
    setIsUntracking(true);
    void (async () => {
      const result = await updateSettings({
        environmentId,
        input: { patch: { environmentFiles: remaining } },
      });
      if (editorVersionRef.current !== requestVersion) return;
      setIsUntracking(false);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        toastManager.add({
          type: "error",
          title: "Could not untrack env file",
          description: errorMessage(
            squashAtomCommandFailure(result),
            "The file is still registered.",
          ),
        });
        return;
      }
      clearEditor();
      setSelectedId(remaining[0]?.id ?? null);
      toastManager.add({
        type: "success",
        title: "Env file untracked",
        description: "The file was not deleted from the environment host.",
      });
    })();
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="environment-files"
        title="Env files"
        icon={<FileKey2Icon className="size-5" />}
        headerAction={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAddDialogOpen(true)}
            disabled={!isSupported}
          >
            <PlusIcon />
            Add file
          </Button>
        }
      >
        <div className="rounded-xl px-3 py-3 sm:px-4">
          {!isSupported ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">Server update required</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Update this environment's T3 Code server to manage env files.
              </p>
            </div>
          ) : files.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No env files added</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add an existing file path from this environment.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="grid min-w-0 flex-1 gap-1.5 text-xs font-medium text-foreground">
                  File
                  <Select
                    value={selectedId}
                    onValueChange={selectFile}
                    disabled={isSaving || isUntracking}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {selectedFile
                          ? `${selectedFile.label} — ${selectedFile.path}`
                          : "Select file"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {files.map((file) => (
                        <SelectItem key={file.id} value={file.id}>
                          {file.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={untrack}
                  disabled={!selectedFile || isSaving || isUntracking}
                >
                  {isUntracking ? <LoaderIcon className="animate-spin" /> : <Trash2Icon />}
                  {isUntracking ? "Untracking" : "Untrack"}
                </Button>
              </div>

              {selectedFile ? (
                <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/10 p-3 sm:p-4">
                  <div className="min-w-0">
                    <code className="block truncate text-xs text-muted-foreground">
                      {selectedFile.path}
                    </code>
                    {snapshot ? (
                      <span className="mt-1 block text-[11px] text-muted-foreground/70">
                        Permissions {formatFileMode(snapshot.mode)}
                      </span>
                    ) : null}
                  </div>

                  {snapshot === null ? (
                    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md bg-background px-4 text-center">
                      <p className="max-w-md text-xs text-muted-foreground">
                        Contents stay hidden until you choose to load them on this client.
                      </p>
                      <Button type="button" onClick={reveal} disabled={isReading}>
                        {isReading ? <LoaderIcon className="animate-spin" /> : <EyeIcon />}
                        {isReading ? "Opening" : "Reveal and edit"}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Textarea
                        value={draft}
                        onChange={(event) => setDraft(event.currentTarget.value)}
                        className="min-h-80 font-mono text-xs"
                        aria-label={`${selectedFile.label} contents`}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={isSaving || isUntracking}
                      />
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={hideEditor}
                          disabled={isSaving || isUntracking}
                        >
                          <EyeOffIcon />
                          Hide
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setDraft(snapshot.contents)}
                          disabled={!isDirty || isSaving || isUntracking}
                        >
                          <RotateCcwIcon />
                          Discard
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={save}
                          disabled={!isDirty || isSaving || isUntracking}
                        >
                          {isSaving ? <LoaderIcon className="animate-spin" /> : <SaveIcon />}
                          {isSaving ? "Saving" : "Save"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </SettingsSection>

      <AddEnvironmentFileDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
    </SettingsPageContainer>
  );
}
