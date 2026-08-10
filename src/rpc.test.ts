import { describe, expect, it } from "bun:test";

import { createGitHubRpcHandler } from "./rpc.ts";

describe("GitHub workflow RPC", () => {
  it("serves pull request review workflows", async () => {
    const handler = createGitHubRpcHandler({
      snapshot: { providerId: "github", repository: "acme/repo", pullRequest: 1, checks: [], summary: { total: 0, passed: 0, failed: 0, pending: 0 } },
      refresh: async () => ({ providerId: "github", repository: "acme/repo", pullRequest: 1, checks: [], summary: { total: 0, passed: 0, failed: 0, pending: 0 } }),
    });
    await expect(handler("workflow.get", { workflowId: "github.pull-request-review" })).resolves.toMatchObject({ ok: true, result: { workflowId: "github.pull-request-review" } });
  });
});
