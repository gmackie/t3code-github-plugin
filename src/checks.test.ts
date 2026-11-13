import { describe, expect, it } from "bun:test";

import { buildPullRequestWorkflow, parseChecks } from "./checks.ts";

describe("GitHub checks plugin", () => {
  it("normalizes bounded gh check rows and summarizes state", () => {
    expect(parseChecks([
      { name: "build", state: "SUCCESS", workflow: "CI", link: "https://github.com/a/b/actions/1" },
      { name: "lint", state: "IN_PROGRESS" },
      { name: "deploy", state: "FAILURE" },
      { name: 42, state: "SUCCESS" },
    ], "acme/repo", 17)).toEqual({
      providerId: "github",
      repository: "acme/repo",
      pullRequest: 17,
      checks: [
        { name: "build", state: "success", workflow: "CI", url: "https://github.com/a/b/actions/1" },
        { name: "lint", state: "in_progress" },
        { name: "deploy", state: "failure" },
      ],
      summary: { total: 3, passed: 1, failed: 1, pending: 1 },
    });
  });

  it("does not trust malformed rows or negative durations", () => {
    expect(parseChecks([{ name: "build", state: "weird", startedAt: "2026-01-02T00:00:00Z", completedAt: "2026-01-01T00:00:00Z" }], "acme/repo", 1).checks[0]).toEqual({ name: "build", state: "neutral", durationMs: 0 });
  });

  it("builds a pull request review workflow from check evidence", () => {
    const snapshot = parseChecks([{ name: "build", state: "SUCCESS" }], "acme/repo", 1);
    const workflow = buildPullRequestWorkflow(snapshot);
    expect(workflow.currentStage).toBe("review");
    expect(workflow.evidence?.[0]?.status).toBe("positive");
    expect(workflow.actions?.[0]?.id).toBe("approve");
  });

  it("offers sending the review to the agent once approved", () => {
    const snapshot = parseChecks([{ name: "build", state: "SUCCESS" }], "acme/repo", 1);
    const workflow = buildPullRequestWorkflow(snapshot, { approved: true });
    expect(workflow.currentStage).toBe("execute");
    expect(workflow.actions?.map((action) => action.id)).toEqual(["dispatch"]);
  });
});
