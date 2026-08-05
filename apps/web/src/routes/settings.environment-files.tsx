import { createFileRoute } from "@tanstack/react-router";

import { EnvironmentFilesSettings } from "../components/settings/EnvironmentFilesSettings";

export const Route = createFileRoute("/settings/environment-files")({
  component: EnvironmentFilesSettings,
});
