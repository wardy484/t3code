import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const EnvironmentFileId = TrimmedNonEmptyString.pipe(Schema.brand("EnvironmentFileId"));
export type EnvironmentFileId = typeof EnvironmentFileId.Type;

export const EnvironmentFileRevision = TrimmedNonEmptyString.pipe(
  Schema.brand("EnvironmentFileRevision"),
);
export type EnvironmentFileRevision = typeof EnvironmentFileRevision.Type;

export const EnvironmentFileRegistration = Schema.Struct({
  id: EnvironmentFileId,
  label: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type EnvironmentFileRegistration = typeof EnvironmentFileRegistration.Type;

export const EnvironmentFileReadInput = Schema.Struct({
  id: EnvironmentFileId,
});
export type EnvironmentFileReadInput = typeof EnvironmentFileReadInput.Type;

export const EnvironmentFileReadResult = Schema.Struct({
  contents: Schema.String,
  revision: EnvironmentFileRevision,
  mode: NonNegativeInt,
});
export type EnvironmentFileReadResult = typeof EnvironmentFileReadResult.Type;

export const EnvironmentFileWriteInput = Schema.Struct({
  id: EnvironmentFileId,
  contents: Schema.String,
  expectedRevision: EnvironmentFileRevision,
});
export type EnvironmentFileWriteInput = typeof EnvironmentFileWriteInput.Type;

export const EnvironmentFileWriteResult = Schema.Struct({
  revision: EnvironmentFileRevision,
  mode: NonNegativeInt,
});
export type EnvironmentFileWriteResult = typeof EnvironmentFileWriteResult.Type;

export const EnvironmentFileOperation = Schema.Literals(["read", "write"]);
export type EnvironmentFileOperation = typeof EnvironmentFileOperation.Type;

export const EnvironmentFileFailure = Schema.Literals([
  "not-registered",
  "path-not-absolute",
  "not-found",
  "not-file",
  "too-large",
  "binary",
  "revision-conflict",
  "read-failed",
  "write-failed",
]);
export type EnvironmentFileFailure = typeof EnvironmentFileFailure.Type;

export class EnvironmentFileError extends Schema.TaggedErrorClass<EnvironmentFileError>()(
  "EnvironmentFileError",
  {
    id: EnvironmentFileId,
    operation: EnvironmentFileOperation,
    failure: EnvironmentFileFailure,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.failure) {
      case "not-registered":
        return "This environment file is no longer registered.";
      case "path-not-absolute":
        return "Environment file paths must be absolute paths on the environment host.";
      case "not-found":
        return "The registered environment file does not exist.";
      case "not-file":
        return "The registered environment file path is not a regular file.";
      case "too-large":
        return "Environment files larger than 1 MB cannot be edited in T3 Code.";
      case "binary":
        return "Binary files cannot be edited as environment files.";
      case "revision-conflict":
        return "This environment file changed outside T3 Code. Reload it before saving.";
      case "read-failed":
        return "T3 Code could not read this environment file.";
      case "write-failed":
        return "T3 Code could not save this environment file.";
    }
  }
}
