import { createFileRoute } from "@tanstack/react-router";

import { EnvironmentFilesSettings } from "../components/settings/EnvironmentFilesSettings";

export const Route = createFileRoute("/settings/secrets")({
  component: EnvironmentFilesSettings,
});
