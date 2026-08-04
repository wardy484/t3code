import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { KanbanService } from "./KanbanService.ts";

export const kanbanHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "kanban",
  Effect.fnUntraced(function* (handlers) {
    const kanban = yield* KanbanService;
    const read = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.catch((cause) => failEnvironmentInternal("internal_error", cause)));

    return handlers
      .handle("catalog", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* read(kanban.catalog);
        }),
      )
      .handle("createOrganization", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.createOrganization(args.payload));
        }),
      )
      .handle("updateOrganization", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.updateOrganization(args.payload));
        }),
      )
      .handle("deleteOrganization", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.deleteOrganization(args.payload));
        }),
      )
      .handle("createNativeBoard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.createNativeBoard(args.payload));
        }),
      )
      .handle("createJiraBoard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.createJiraBoard(args.payload));
        }),
      )
      .handle("updateBoard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.updateBoard(args.payload));
        }),
      )
      .handle("deleteBoard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.deleteBoard(args.payload));
        }),
      )
      .handle("board", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* read(kanban.getBoard(args.payload));
        }),
      )
      .handle("projectBoards", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* read(kanban.getProjectBoards(args.payload));
        }),
      )
      .handle("lookupProjectCards", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* read(kanban.lookupProjectCards(args.payload));
        }),
      )
      .handle("createCard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.createCard(args.payload));
        }),
      )
      .handle("updateCard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.updateCard(args.payload));
        }),
      )
      .handle("moveCard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.moveCard(args.payload));
        }),
      )
      .handle("assignCard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.assignCard(args.payload));
        }),
      )
      .handle("deleteCard", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* read(kanban.deleteCard(args.payload));
        }),
      );
  }),
);
