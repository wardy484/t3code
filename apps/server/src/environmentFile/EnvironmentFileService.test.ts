import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentFileId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSettings from "../serverSettings.ts";
import * as EnvironmentFileService from "./EnvironmentFileService.ts";

const BRAZE_ID = EnvironmentFileId.make("braze");

const withRegisteredFile = <A, E, R>(
  filePath: string,
  effect: Effect.Effect<A, E, R | EnvironmentFileService.EnvironmentFileService>,
) =>
  effect.pipe(
    Effect.provide(
      EnvironmentFileService.layer.pipe(
        Layer.provide(
          ServerSettings.ServerSettingsService.layerTest({
            environmentFiles: [{ id: BRAZE_ID, label: "Braze", path: filePath }],
          }),
        ),
      ),
    ),
  );

describe("EnvironmentFileService", () => {
  it.effect("reads a registered text file and returns a stable revision", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-env-file-read-" });
      const filePath = path.join(directory, "braze.env");
      yield* fs.writeFileString(filePath, "BRAZE_API_KEY=secret\n", { mode: 0o600 });

      const result = yield* withRegisteredFile(
        filePath,
        Effect.gen(function* () {
          const service = yield* EnvironmentFileService.EnvironmentFileService;
          return yield* service.read({ id: BRAZE_ID });
        }),
      );

      expect(result.contents).toBe("BRAZE_API_KEY=secret\n");
      expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
      expect(result.mode & 0o777).toBe(0o600);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("saves atomically without changing file permissions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-env-file-write-" });
      const filePath = path.join(directory, "braze.env");
      yield* fs.writeFileString(filePath, "BRAZE_API_KEY=old\n", { mode: 0o600 });

      const result = yield* withRegisteredFile(
        filePath,
        Effect.gen(function* () {
          const service = yield* EnvironmentFileService.EnvironmentFileService;
          const before = yield* service.read({ id: BRAZE_ID });
          return yield* service.write({
            id: BRAZE_ID,
            contents: "BRAZE_API_KEY=new\n",
            expectedRevision: before.revision,
          });
        }),
      );

      expect(yield* fs.readFileString(filePath)).toBe("BRAZE_API_KEY=new\n");
      expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
      expect(result.mode & 0o777).toBe(0o600);
      expect((yield* fs.stat(filePath)).mode & 0o777).toBe(0o600);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a save when the file changed after it was revealed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-env-file-conflict-" });
      const filePath = path.join(directory, "braze.env");
      yield* fs.writeFileString(filePath, "BRAZE_API_KEY=old\n", { mode: 0o600 });

      const error = yield* withRegisteredFile(
        filePath,
        Effect.gen(function* () {
          const service = yield* EnvironmentFileService.EnvironmentFileService;
          const before = yield* service.read({ id: BRAZE_ID });
          yield* fs.writeFileString(filePath, "BRAZE_API_KEY=external\n", { mode: 0o600 });
          return yield* service
            .write({
              id: BRAZE_ID,
              contents: "BRAZE_API_KEY=t3\n",
              expectedRevision: before.revision,
            })
            .pipe(Effect.flip);
        }),
      );

      expect(error.failure).toBe("revision-conflict");
      expect(error.message).toBe(
        "This secret file changed outside T3 Code. Reload it before saving.",
      );
      expect(yield* fs.readFileString(filePath)).toBe("BRAZE_API_KEY=external\n");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects unregistered ids without reading arbitrary paths", () =>
    Effect.gen(function* () {
      const service = yield* EnvironmentFileService.EnvironmentFileService;
      const error = yield* service
        .read({ id: EnvironmentFileId.make("unknown") })
        .pipe(Effect.flip);

      expect(error.failure).toBe("not-registered");
    }).pipe(
      Effect.provide(
        EnvironmentFileService.layer.pipe(
          Layer.provide(ServerSettings.ServerSettingsService.layerTest()),
          Layer.provide(NodeServices.layer),
        ),
      ),
    ),
  );

  it.effect("rejects binary files without returning their contents", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-env-file-binary-" });
      const filePath = path.join(directory, "braze.env");
      yield* fs.writeFile(filePath, Uint8Array.from([0x61, 0, 0x62]), { mode: 0o600 });

      const error = yield* withRegisteredFile(
        filePath,
        Effect.gen(function* () {
          const service = yield* EnvironmentFileService.EnvironmentFileService;
          return yield* service.read({ id: BRAZE_ID }).pipe(Effect.flip);
        }),
      );

      expect(error.failure).toBe("binary");
      expect("contents" in error).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects invalid UTF-8 instead of replacing bytes in the editor", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-env-file-encoding-" });
      const filePath = path.join(directory, "braze.env");
      yield* fs.writeFile(filePath, Uint8Array.from([0x42, 0x52, 0x41, 0x5a, 0x45, 0xff]), {
        mode: 0o600,
      });

      const error = yield* withRegisteredFile(
        filePath,
        Effect.gen(function* () {
          const service = yield* EnvironmentFileService.EnvironmentFileService;
          return yield* service.read({ id: BRAZE_ID }).pipe(Effect.flip);
        }),
      );

      expect(error.failure).toBe("binary");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
