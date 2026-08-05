import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  selectPullRequestLayerThreadState,
  usePullRequestLayerStateStore,
} from "./pullRequestLayerStateStore";

const REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("pull request layer state", () => {
  beforeEach(() => usePullRequestLayerStateStore.setState({ byThreadKey: {} }));

  it("keeps the selected and viewed layers with the review thread", () => {
    usePullRequestLayerStateStore.getState().selectLayer(REF, "domain");
    usePullRequestLayerStateStore.getState().toggleViewed(REF, "domain");

    expect(
      selectPullRequestLayerThreadState(usePullRequestLayerStateStore.getState().byThreadKey, REF),
    ).toMatchObject({ selectedLayerId: "domain", viewedLayerIds: ["domain"] });
  });
});
