import { useNavigation, usePreventRemove } from "@react-navigation/native";
import {
  EnvironmentFileId,
  type EnvironmentFileReadResult,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { uuidv4 } from "../../lib/uuid";
import { useThemeColor } from "../../lib/useThemeColor";
import { useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ActionButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly loading?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className={
        props.destructive
          ? "min-h-11 flex-1 items-center justify-center rounded-full bg-destructive px-4 active:opacity-70 disabled:opacity-45"
          : "min-h-11 flex-1 items-center justify-center rounded-full bg-primary px-4 active:opacity-70 disabled:opacity-45"
      }
    >
      {props.loading ? (
        <ActivityIndicator />
      ) : (
        <Text
          className={
            props.destructive
              ? "font-t3-bold text-destructive-foreground"
              : "font-t3-bold text-primary-foreground"
          }
        >
          {props.label}
        </Text>
      )}
    </Pressable>
  );
}

function ChoiceRow(props: {
  readonly label: string;
  readonly detail?: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const iconColor = useThemeColor("--color-icon");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      className="flex-row items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 active:opacity-70"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-base font-t3-medium" numberOfLines={1}>
          {props.label}
        </Text>
        {props.detail ? (
          <Text className="font-mono text-xs text-foreground-muted" numberOfLines={1}>
            {props.detail}
          </Text>
        ) : null}
      </View>
      {props.selected ? (
        <SymbolView name="checkmark" size={16} tintColor={iconColor} type="monochrome" />
      ) : null}
    </Pressable>
  );
}

export function SettingsEnvironmentFilesRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const serverConfigs = useServerConfigs();
  const { presentationById } = useEnvironments();
  const environments = useMemo(() => [...serverConfigs.entries()], [serverConfigs]);
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<EnvironmentFileId | null>(null);
  const [snapshot, setSnapshot] = useState<EnvironmentFileReadResult | null>(null);
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("");
  const [filePath, setFilePath] = useState("");
  const [operation, setOperation] = useState<"add" | "read" | "save" | "untrack" | null>(null);
  const editorVersionRef = useRef(0);
  const allowRemovalRef = useRef(false);
  const readEnvironmentFile = useAtomCommand(serverEnvironment.readEnvironmentFile, {
    reportFailure: false,
  });
  const writeEnvironmentFile = useAtomCommand(serverEnvironment.writeEnvironmentFile, {
    reportFailure: false,
  });
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });

  const config = environmentId ? (serverConfigs.get(environmentId) ?? null) : null;
  const files = config?.settings.environmentFiles ?? [];
  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null;
  const isSupported = config?.environment.capabilities.environmentFiles === true;
  const isDirty = snapshot !== null && draft !== snapshot.contents;

  const resetEditor = () => {
    editorVersionRef.current += 1;
    setSnapshot(null);
    setDraft("");
    setOperation(null);
  };

  useEffect(() => {
    if (environmentId && serverConfigs.has(environmentId)) return;
    setEnvironmentId(environments[0]?.[0] ?? null);
  }, [environmentId, environments, serverConfigs]);

  useEffect(() => {
    const selectedStillExists = files.some((file) => file.id === selectedFileId);
    if (selectedStillExists) return;
    editorVersionRef.current += 1;
    setSelectedFileId(files[0]?.id ?? null);
    setSnapshot(null);
    setDraft("");
    setOperation(null);
  }, [files, selectedFileId]);

  useEffect(() => {
    editorVersionRef.current += 1;
    setSelectedFileId(null);
    setSnapshot(null);
    setDraft("");
    setOperation(null);
  }, [environmentId]);

  usePreventRemove(isDirty && !allowRemovalRef.current, ({ data }) => {
    Alert.alert("Discard secret changes?", "Your unsaved changes will be lost.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          allowRemovalRef.current = true;
          setDraft(snapshot?.contents ?? "");
          requestAnimationFrame(() => navigation.dispatch(data.action));
        },
      },
    ]);
  });

  const confirmDiscard = (action: () => void) => {
    if (!isDirty) {
      action();
      return;
    }
    Alert.alert("Discard secret changes?", "Your unsaved changes will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: action },
    ]);
  };

  const chooseEnvironment = (nextEnvironmentId: EnvironmentId) => {
    if (nextEnvironmentId === environmentId) return;
    confirmDiscard(() => {
      resetEditor();
      setEnvironmentId(nextEnvironmentId);
    });
  };

  const chooseFile = (nextFileId: EnvironmentFileId) => {
    if (nextFileId === selectedFileId) return;
    confirmDiscard(() => {
      resetEditor();
      setSelectedFileId(nextFileId);
    });
  };

  const addFile = () => {
    const normalizedLabel = label.trim();
    const normalizedPath = filePath.trim();
    if (!environmentId || !config || !normalizedLabel || !normalizedPath || operation) return;
    if (files.some((file) => file.path === normalizedPath)) {
      Alert.alert("File already added", "That path is already registered in this environment.");
      return;
    }
    const id = EnvironmentFileId.make(uuidv4());
    const requestVersion = editorVersionRef.current;
    setOperation("add");
    void (async () => {
      const result = await updateSettings({
        environmentId,
        input: {
          patch: {
            environmentFiles: [...files, { id, label: normalizedLabel, path: normalizedPath }],
          },
        },
      });
      if (editorVersionRef.current !== requestVersion) return;
      setOperation(null);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          Alert.alert(
            "Could not add secret file",
            message(squashAtomCommandFailure(result), "The file was not added."),
          );
        }
        return;
      }
      setLabel("");
      setFilePath("");
      setSelectedFileId(id);
    })();
  };

  const reveal = () => {
    if (!environmentId || !selectedFile || operation) return;
    const requestVersion = editorVersionRef.current + 1;
    editorVersionRef.current = requestVersion;
    setOperation("read");
    void (async () => {
      const result = await readEnvironmentFile({ environmentId, input: { id: selectedFile.id } });
      if (editorVersionRef.current !== requestVersion) return;
      setOperation(null);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          Alert.alert(
            "Could not open secret file",
            message(squashAtomCommandFailure(result), "The file was not opened."),
          );
        }
        return;
      }
      setSnapshot(result.value);
      setDraft(result.value.contents);
    })();
  };

  const save = () => {
    if (!environmentId || !selectedFile || !snapshot || !isDirty || operation) return;
    const requestVersion = editorVersionRef.current;
    const savedContents = draft;
    setOperation("save");
    void (async () => {
      const result = await writeEnvironmentFile({
        environmentId,
        input: {
          id: selectedFile.id,
          contents: savedContents,
          expectedRevision: snapshot.revision,
        },
      });
      if (editorVersionRef.current !== requestVersion) return;
      setOperation(null);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          Alert.alert(
            "Could not save secret file",
            message(squashAtomCommandFailure(result), "The file was not saved."),
          );
        }
        return;
      }
      setSnapshot({
        contents: savedContents,
        revision: result.value.revision,
        mode: result.value.mode,
      });
      Alert.alert("Secret file saved");
    })();
  };

  const untrack = () => {
    if (!environmentId || !selectedFile || operation) return;
    Alert.alert(
      "Untrack secret file?",
      `${isDirty ? "Your unsaved changes will be discarded. " : ""}This removes it from T3 Code. The file will not be deleted from the environment host.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Untrack",
          style: "destructive",
          onPress: () => {
            const remaining = files.filter((file) => file.id !== selectedFile.id);
            const requestVersion = editorVersionRef.current;
            setOperation("untrack");
            void (async () => {
              const result = await updateSettings({
                environmentId,
                input: { patch: { environmentFiles: remaining } },
              });
              if (editorVersionRef.current !== requestVersion) return;
              setOperation(null);
              if (result._tag === "Failure") {
                if (!isAtomCommandInterrupted(result)) {
                  Alert.alert(
                    "Could not untrack secret file",
                    message(squashAtomCommandFailure(result), "The file is still registered."),
                  );
                }
                return;
              }
              resetEditor();
              setSelectedFileId(remaining[0]?.id ?? null);
            })();
          },
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {environments.length === 0 ? (
          <Text className="rounded-[24px] bg-card px-5 py-8 text-center text-foreground-muted">
            Connect an environment before adding secret files.
          </Text>
        ) : (
          <>
            <SettingsSection title="Environment" card>
              {environments.map(([id, environmentConfig]) => (
                <ChoiceRow
                  key={id}
                  label={
                    presentationById.get(id)?.entry.target.label ??
                    environmentConfig.environment.label
                  }
                  detail={environmentConfig.environment.serverVersion}
                  selected={id === environmentId}
                  onPress={() => chooseEnvironment(id)}
                />
              ))}
            </SettingsSection>

            {!isSupported ? (
              <Text className="rounded-[24px] bg-card px-5 py-8 text-center text-foreground-muted">
                Update this environment's T3 Code server to manage secrets.
              </Text>
            ) : (
              <>
                <SettingsSection title="Add file" card>
                  <View className="gap-3 p-4">
                    <TextInput
                      value={label}
                      onChangeText={setLabel}
                      placeholder="Name, for example Braze"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TextInput
                      value={filePath}
                      onChangeText={setFilePath}
                      placeholder="Absolute path on the environment host"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <ActionButton
                      label="Add file"
                      loading={operation === "add"}
                      disabled={!label.trim() || !filePath.trim() || operation !== null}
                      onPress={addFile}
                    />
                  </View>
                </SettingsSection>

                <SettingsSection title="Files" card>
                  {files.length === 0 ? (
                    <Text className="px-4 py-6 text-center text-foreground-muted">
                      No secret files added.
                    </Text>
                  ) : (
                    files.map((file) => (
                      <ChoiceRow
                        key={file.id}
                        label={file.label}
                        detail={file.path}
                        selected={file.id === selectedFileId}
                        onPress={() => chooseFile(file.id)}
                      />
                    ))
                  )}
                </SettingsSection>

                {selectedFile ? (
                  <SettingsSection title={selectedFile.label} card>
                    <View className="gap-3 p-4">
                      <Text selectable className="font-mono text-xs text-foreground-muted">
                        {selectedFile.path}
                      </Text>
                      {snapshot === null ? (
                        <ActionButton
                          label="Reveal and edit"
                          loading={operation === "read"}
                          disabled={operation !== null}
                          onPress={reveal}
                        />
                      ) : (
                        <>
                          <TextInput
                            value={draft}
                            onChangeText={setDraft}
                            multiline
                            scrollEnabled
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={operation === null}
                            className="min-h-72 font-mono text-sm"
                            textAlignVertical="top"
                          />
                          <View className="flex-row gap-2">
                            <ActionButton
                              label="Hide"
                              disabled={operation !== null}
                              onPress={() => confirmDiscard(resetEditor)}
                            />
                            <ActionButton
                              label="Discard"
                              disabled={!isDirty || operation !== null}
                              onPress={() => setDraft(snapshot.contents)}
                            />
                            <ActionButton
                              label="Save"
                              loading={operation === "save"}
                              disabled={!isDirty || operation !== null}
                              onPress={save}
                            />
                          </View>
                        </>
                      )}
                      <ActionButton
                        label="Untrack"
                        destructive
                        loading={operation === "untrack"}
                        disabled={operation !== null}
                        onPress={untrack}
                      />
                    </View>
                  </SettingsSection>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
