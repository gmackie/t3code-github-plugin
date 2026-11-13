import { describe, expect, it } from "bun:test";

import { parseChecks } from "./checks.ts";
import { checkRowsFromRest } from "./github.ts";

describe("REST check mapping", () => {
  it("maps check runs and commit statuses onto the gh rows parseChecks reads", () => {
    const rows = checkRowsFromRest(
      [
        { name: "build", status: "completed", conclusion: "success", html_url: "https://gh/runs/1", started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z" },
        { name: "slow", status: "completed", conclusion: "timed_out" },
        { name: "lint", status: "queued" },
        { name: "e2e", status: "in_progress", details_url: "https://ci/e2e" },
        { name: "stale", status: "completed", conclusion: "stale" },
      ],
      [
        { context: "deploy", state: "pending", target_url: "https://deploy/1" },
        { context: "legacy", state: "error" },
      ],
    );
    const snapshot = parseChecks(rows, "acme/repo", 1);
    expect(snapshot.checks.map((check) => [check.name, check.state])).toEqual([
      ["build", "success"],
      ["slow", "failure"],
      ["lint", "queued"],
      ["e2e", "in_progress"],
      ["stale", "neutral"],
      ["deploy", "in_progress"],
      ["legacy", "failure"],
    ]);
    expect(snapshot.checks[0]).toMatchObject({ url: "https://gh/runs/1", durationMs: 60_000 });
    expect(snapshot.checks[3]?.url).toBe("https://ci/e2e");
    expect(snapshot.summary).toEqual({ total: 7, passed: 1, failed: 2, pending: 3 });
  });
});
