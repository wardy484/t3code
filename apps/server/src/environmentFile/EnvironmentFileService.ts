import {
  EnvironmentFileError,
  EnvironmentFileRevision,
  type EnvironmentFileOperation,
  type EnvironmentFileReadInput,
  type EnvironmentFileReadResult,
  type EnvironmentFileRegistration,
  type EnvironmentFileWriteInput,
  type EnvironmentFileWriteResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import * as ServerSettings from "../serverSettings.ts";

const MAX_ENVIRONMENT_FILE_BYTES = 1024 * 1024;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

interface EnvironmentFileSnapshot extends EnvironmentFileReadResult {
  readonly canonicalPath: string;
  readonly bytes: Uint8Array;
  readonly ownership: { readonly uid: number; readonly gid: number } | null;
}

export class EnvironmentFileService extends Context.Service<
  EnvironmentFileService,
  {
    readonly read: (
      input: EnvironmentFileReadInput,
    ) => Effect.Effect<EnvironmentFileReadResult, EnvironmentFileError>;
    readonly write: (
      input: EnvironmentFileWriteInput,
    ) => Effect.Effect<EnvironmentFileWriteResult, EnvironmentFileError>;
  }
>()("t3/environmentFile/EnvironmentFileService") {}

function ioFailure(input: {
  readonly id: EnvironmentFileReadInput["id"];
  readonly operation: EnvironmentFileOperation;
  readonly cause: PlatformError.PlatformError;
}): EnvironmentFileError {
  return new EnvironmentFileError({
    id: input.id,
    operation: input.operation,
    failure: input.cause.reason._tag === "NotFound" ? "not-found" : `${input.operation}-failed`,
    cause: input.cause,
  });
}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const settings = yield* ServerSettings.ServerSettingsService;

  const resolveRegistration = Effect.fn("EnvironmentFileService.resolveRegistration")(function* (
    id: EnvironmentFileReadInput["id"],
    operation: EnvironmentFileOperation,
  ): Effect.fn.Return<EnvironmentFileRegistration, EnvironmentFileError> {
    const currentSettings = yield* settings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new EnvironmentFileError({
            id,
            operation,
            failure: operation === "read" ? "read-failed" : "write-failed",
            cause,
          }),
      ),
    );
    const registered = currentSettings.environmentFiles.find((candidate) => candidate.id === id);
    if (!registered) {
      return yield* new EnvironmentFileError({
        id,
        operation,
        failure: "not-registered",
      });
    }
    if (!path.isAbsolute(registered.path)) {
      return yield* new EnvironmentFileError({
        id,
        operation,
        failure: "path-not-absolute",
      });
    }
    return registered;
  });

  const digest = Effect.fn("EnvironmentFileService.digest")(function* (
    id: EnvironmentFileReadInput["id"],
    operation: EnvironmentFileOperation,
    bytes: Uint8Array,
  ): Effect.fn.Return<EnvironmentFileRevision, EnvironmentFileError> {
    return yield* crypto.digest("SHA-256", bytes).pipe(
      Effect.map(Encoding.encodeHex),
      Effect.map(EnvironmentFileRevision.make),
      Effect.mapError(
        (cause) =>
          new EnvironmentFileError({
            id,
            operation,
            failure: `${operation}-failed`,
            cause,
          }),
      ),
    );
  });

  const readSnapshot = Effect.fn("EnvironmentFileService.readSnapshot")(function* (
    id: EnvironmentFileReadInput["id"],
    operation: EnvironmentFileOperation,
  ): Effect.fn.Return<EnvironmentFileSnapshot, EnvironmentFileError> {
    const registration = yield* resolveRegistration(id, operation);
    const canonicalPath = yield* fs
      .realPath(registration.path)
      .pipe(Effect.mapError((cause) => ioFailure({ id, operation, cause })));
    const stat = yield* fs
      .stat(canonicalPath)
      .pipe(Effect.mapError((cause) => ioFailure({ id, operation, cause })));
    if (stat.type !== "File") {
      return yield* new EnvironmentFileError({ id, operation, failure: "not-file" });
    }
    if (Number(stat.size) > MAX_ENVIRONMENT_FILE_BYTES) {
      return yield* new EnvironmentFileError({ id, operation, failure: "too-large" });
    }
    const bytes = yield* fs
      .readFile(canonicalPath)
      .pipe(Effect.mapError((cause) => ioFailure({ id, operation, cause })));
    if (bytes.byteLength > MAX_ENVIRONMENT_FILE_BYTES) {
      return yield* new EnvironmentFileError({ id, operation, failure: "too-large" });
    }
    if (bytes.includes(0)) {
      return yield* new EnvironmentFileError({ id, operation, failure: "binary" });
    }
    const contents = yield* Effect.try({
      try: () => textDecoder.decode(bytes),
      catch: () => new EnvironmentFileError({ id, operation, failure: "binary" }),
    });
    return {
      canonicalPath,
      bytes,
      contents,
      revision: yield* digest(id, operation, bytes),
      mode: stat.mode,
      ownership:
        Option.isSome(stat.uid) && Option.isSome(stat.gid)
          ? { uid: stat.uid.value, gid: stat.gid.value }
          : null,
    };
  });

  const read = Effect.fn("EnvironmentFileService.read")(function* (
    input: EnvironmentFileReadInput,
  ): Effect.fn.Return<EnvironmentFileReadResult, EnvironmentFileError> {
    const {
      canonicalPath: _canonicalPath,
      bytes: _bytes,
      ownership: _ownership,
      ...result
    } = yield* readSnapshot(input.id, "read");
    return result;
  });

  const write = Effect.fn("EnvironmentFileService.write")(function* (
    input: EnvironmentFileWriteInput,
  ): Effect.fn.Return<EnvironmentFileWriteResult, EnvironmentFileError> {
    const nextBytes = textEncoder.encode(input.contents);
    if (nextBytes.byteLength > MAX_ENVIRONMENT_FILE_BYTES) {
      return yield* new EnvironmentFileError({
        id: input.id,
        operation: "write",
        failure: "too-large",
      });
    }

    const current = yield* readSnapshot(input.id, "write");
    if (current.revision !== input.expectedRevision) {
      return yield* new EnvironmentFileError({
        id: input.id,
        operation: "write",
        failure: "revision-conflict",
      });
    }

    yield* Effect.scoped(
      Effect.gen(function* () {
        const tempPath = yield* fs
          .makeTempFileScoped({
            directory: path.dirname(current.canonicalPath),
            prefix: `.${path.basename(current.canonicalPath)}.t3-`,
          })
          .pipe(Effect.mapError((cause) => ioFailure({ id: input.id, operation: "write", cause })));
        yield* fs
          .writeFile(tempPath, nextBytes, { mode: current.mode & 0o7777 })
          .pipe(Effect.mapError((cause) => ioFailure({ id: input.id, operation: "write", cause })));
        if (current.ownership !== null) {
          yield* fs
            .chown(tempPath, current.ownership.uid, current.ownership.gid)
            .pipe(
              Effect.mapError((cause) => ioFailure({ id: input.id, operation: "write", cause })),
            );
        }
        yield* fs
          .chmod(tempPath, current.mode & 0o7777)
          .pipe(Effect.mapError((cause) => ioFailure({ id: input.id, operation: "write", cause })));

        const latest = yield* readSnapshot(input.id, "write");
        if (latest.revision !== input.expectedRevision) {
          return yield* new EnvironmentFileError({
            id: input.id,
            operation: "write",
            failure: "revision-conflict",
          });
        }

        yield* fs
          .rename(tempPath, current.canonicalPath)
          .pipe(Effect.mapError((cause) => ioFailure({ id: input.id, operation: "write", cause })));
      }),
    );

    return {
      revision: yield* digest(input.id, "write", nextBytes),
      mode: current.mode,
    };
  });

  return EnvironmentFileService.of({ read, write });
});

export const layer = Layer.effect(EnvironmentFileService, make);
