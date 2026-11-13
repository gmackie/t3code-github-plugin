import { describe, expect, it } from "bun:test";

import { parseChecks } from "./checks.ts";
import type { PullRequestInfo } from "./types.ts";
import { evaluateWaits } from "./waits.ts";

const pr: PullRequestInfo = { repository: "acme/repo", number: 1, title: "x", url: "https://github.com/acme/repo/pull/1", state: "open", draft: false, headSha: "abc", headRef: "b" };

describe("wait conditions", () => {
  it("does not treat a commit without checks as settled", () => {
    const [checks] = evaluateWaits({ pullRequest: pr, snapshot: parseChecks([], "acme/repo", 1), reviews: [], comments: [] });
    expect(checks).toEqual({ condition: "checks_settled", met: false, detail: "No checks reported yet" });
  });

  it("needs since to report new review activity", () => {
    const reviews = [{ id: 1, author: "r", state: "CHANGES_REQUESTED", submittedAt: "2026-01-02T00:00:00Z" }];
    const snapshot = parseChecks([{ name: "b", state: "FAILURE" }], "acme/repo", 1);
    const without = evaluateWaits({ pullRequest: pr, snapshot, reviews, comments: [] });
    expect(without[0]?.met).toBe(true);
    expect(without[1]).toMatchObject({ met: false, detail: expect.stringContaining("review changes requested by r") });
    expect(evaluateWaits({ pullRequest: pr, snapshot, reviews, comments: [], since: "2026-01-01T00:00:00Z" })[1]?.met).toBe(true);
    expect(evaluateWaits({ pullRequest: pr, snapshot, reviews, comments: [], since: "2026-01-03T00:00:00Z" })[1]?.met).toBe(false);
  });

  it("reports closed and merged pull requests", () => {
    const snapshot = parseChecks([], "acme/repo", 1);
    expect(evaluateWaits({ pullRequest: { ...pr, state: "closed" }, snapshot, reviews: [], comments: [] })[2]).toMatchObject({ met: true, detail: "Closed without merging" });
    expect(evaluateWaits({ pullRequest: pr, snapshot, reviews: [], comments: [] })[2]?.met).toBe(false);
  });
});
