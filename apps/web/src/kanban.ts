import {
  buildEnvironmentAuthHeaders,
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiClient,
  withEnvironmentCredentials,
  type EnvironmentHttpAuthHeaders,
} from "@t3tools/client-runtime/rpc";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import type {
  EnvironmentId,
  KanbanAssignCardInput,
  KanbanBoard,
  KanbanBoardInput,
  KanbanBoardSummary,
  KanbanCard,
  KanbanCatalog,
  KanbanCreateCardInput,
  KanbanCreateJiraBoardInput,
  KanbanCreateNativeBoardInput,
  KanbanCreateOrganizationInput,
  KanbanDeleteCardInput,
  KanbanDeleteOrganizationInput,
  KanbanDeleteResult,
  KanbanLookupProjectCardsInput,
  KanbanLookupProjectCardsResult,
  KanbanMoveCardInput,
  KanbanOrganization,
  KanbanProjectBoards,
  KanbanProjectBoardsInput,
  KanbanUpdateBoardInput,
  KanbanUpdateCardInput,
  KanbanUpdateOrganizationInput,
  JiraBoardDiscoveryResult,
  JiraDiscoverBoardsInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as HttpMethod from "effect/unstable/http/HttpMethod";

import { PrimaryEnvironmentHttpClient } from "./environments/primary/httpClient";
import { runtime } from "./lib/runtime";
import { runPrimaryHttp } from "./lib/runtime";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "./state/primaryEnvironment";
import { readPreparedConnection } from "./state/session";

type EnvironmentClient = Effect.Success<ReturnType<typeof makeEnvironmentHttpApiClient>>;

const REQUEST_TIMEOUT_MS = 30_000;

export const KANBAN_CATALOG_CHANGED_EVENT = "t3:kanban-catalog-changed";

export function notifyKanbanCatalogChanged(): void {
  window.dispatchEvent(new Event(KANBAN_CATALOG_CHANGED_EVENT));
}

function endpointUrl(httpBaseUrl: string, path: string): string {
  const base = new URL(httpBaseUrl);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return new URL(path.replace(/^\//, ""), base).toString();
}

function runEnvironmentKanban<A, E>(
  environmentId: EnvironmentId,
  method: HttpMethod.HttpMethod,
  path: string,
  request: (client: EnvironmentClient, headers: EnvironmentHttpAuthHeaders) => Effect.Effect<A, E>,
): Promise<A> {
  if (appAtomRegistry.get(primaryEnvironmentIdAtom) === environmentId) {
    return runPrimaryHttp(
      PrimaryEnvironmentHttpClient.pipe(Effect.flatMap((client) => request(client, {}))),
    );
  }
  const prepared = readPreparedConnection(environmentId);
  if (!prepared) return Promise.reject(new Error("The board's environment is not connected."));
  const requestUrl = endpointUrl(prepared.httpBaseUrl, path);
  return runtime.runPromise(
    Effect.gen(function* () {
      const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
      const headers = yield* buildEnvironmentAuthHeaders(
        prepared.httpAuthorization,
        method,
        requestUrl,
        signer,
      );
      const client = yield* makeEnvironmentHttpApiClient(prepared.httpBaseUrl);
      return yield* executeEnvironmentHttpRequest(
        requestUrl,
        REQUEST_TIMEOUT_MS,
        withEnvironmentCredentials(prepared.httpAuthorization, request(client, headers)),
      );
    }),
  );
}

export const fetchKanbanCatalog = (environmentId: EnvironmentId): Promise<KanbanCatalog> =>
  runEnvironmentKanban(environmentId, "GET", "/api/kanban/catalog", (client, headers) =>
    client.kanban.catalog({ headers }),
  );

export const createKanbanOrganization = (
  environmentId: EnvironmentId,
  input: KanbanCreateOrganizationInput,
): Promise<KanbanOrganization> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/organizations", (client, headers) =>
    client.kanban.createOrganization({ headers, payload: input }),
  );

export const updateKanbanOrganization = (
  environmentId: EnvironmentId,
  input: KanbanUpdateOrganizationInput,
): Promise<KanbanOrganization> =>
  runEnvironmentKanban(
    environmentId,
    "POST",
    "/api/kanban/organizations/update",
    (client, headers) => client.kanban.updateOrganization({ headers, payload: input }),
  );

export const deleteKanbanOrganization = (
  environmentId: EnvironmentId,
  input: KanbanDeleteOrganizationInput,
): Promise<KanbanDeleteResult> =>
  runEnvironmentKanban(
    environmentId,
    "POST",
    "/api/kanban/organizations/delete",
    (client, headers) => client.kanban.deleteOrganization({ headers, payload: input }),
  );

export const createNativeKanbanBoard = (
  environmentId: EnvironmentId,
  input: KanbanCreateNativeBoardInput,
): Promise<KanbanBoardSummary> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/boards/native", (client, headers) =>
    client.kanban.createNativeBoard({ headers, payload: input }),
  );

export const createJiraKanbanBoard = (
  environmentId: EnvironmentId,
  input: KanbanCreateJiraBoardInput,
): Promise<KanbanBoardSummary> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/boards/jira", (client, headers) =>
    client.kanban.createJiraBoard({ headers, payload: input }),
  );

export const discoverEnvironmentJiraBoards = (
  environmentId: EnvironmentId,
  input: JiraDiscoverBoardsInput,
): Promise<JiraBoardDiscoveryResult> =>
  runEnvironmentKanban(environmentId, "POST", "/api/jira/discover", (client, headers) =>
    client.jira.discoverBoards({ headers, payload: input }),
  );

export const updateKanbanBoard = (
  environmentId: EnvironmentId,
  input: KanbanUpdateBoardInput,
): Promise<KanbanBoardSummary> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/boards/update", (client, headers) =>
    client.kanban.updateBoard({ headers, payload: input }),
  );

export const deleteKanbanBoard = (
  environmentId: EnvironmentId,
  input: KanbanBoardInput,
): Promise<KanbanDeleteResult> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/boards/delete", (client, headers) =>
    client.kanban.deleteBoard({ headers, payload: input }),
  );

export const fetchKanbanBoard = (
  environmentId: EnvironmentId,
  input: KanbanBoardInput,
): Promise<KanbanBoard> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/board", (client, headers) =>
    client.kanban.board({ headers, payload: input }),
  );

export const fetchProjectKanbanBoards = (
  environmentId: EnvironmentId,
  input: KanbanProjectBoardsInput,
): Promise<KanbanProjectBoards> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/project-boards", (client, headers) =>
    client.kanban.projectBoards({ headers, payload: input }),
  );

export const lookupProjectKanbanCards = (
  environmentId: EnvironmentId,
  input: KanbanLookupProjectCardsInput,
): Promise<KanbanLookupProjectCardsResult> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/project-cards", (client, headers) =>
    client.kanban.lookupProjectCards({ headers, payload: input }),
  );

export const createKanbanCard = (
  environmentId: EnvironmentId,
  input: KanbanCreateCardInput,
): Promise<KanbanCard> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/cards", (client, headers) =>
    client.kanban.createCard({ headers, payload: input }),
  );

export const updateKanbanCard = (
  environmentId: EnvironmentId,
  input: KanbanUpdateCardInput,
): Promise<KanbanCard> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/cards/update", (client, headers) =>
    client.kanban.updateCard({ headers, payload: input }),
  );

export const moveKanbanCard = (
  environmentId: EnvironmentId,
  input: KanbanMoveCardInput,
): Promise<KanbanCard> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/cards/move", (client, headers) =>
    client.kanban.moveCard({ headers, payload: input }),
  );

export const assignKanbanCard = (
  environmentId: EnvironmentId,
  input: KanbanAssignCardInput,
): Promise<KanbanCard> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/cards/assign", (client, headers) =>
    client.kanban.assignCard({ headers, payload: input }),
  );

export const deleteKanbanCard = (
  environmentId: EnvironmentId,
  input: KanbanDeleteCardInput,
): Promise<KanbanDeleteResult> =>
  runEnvironmentKanban(environmentId, "POST", "/api/kanban/cards/delete", (client, headers) =>
    client.kanban.deleteCard({ headers, payload: input }),
  );
