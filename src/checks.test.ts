import { describe, expect, it } from "bun:test";

import { parseChecks } from "./checks.ts";

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
});
