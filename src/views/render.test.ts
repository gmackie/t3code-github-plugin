import { describe, expect, it } from "bun:test";

import { buildPullRequestWorkflow, parseChecks } from "../checks.ts";
import type { PullRequestInfo } from "../types.ts";
import { renderChecks, renderReview, renderTargetForm, renderWaits, reviewMessage } from "./render.ts";

const pr: PullRequestInfo = { repository: "acme/repo", number: 7, title: "Fix <script>alert(1)</script>", url: "https://github.com/acme/repo/pull/7", state: "open", draft: false, headSha: "abc1234def", headRef: "fix" };
const snapshot = parseChecks([{ name: "build", state: "SUCCESS", link: "https://gh/runs/1" }, { name: "e2e <x>", state: "FAILURE" }], "acme/repo", 7);

describe("view renderers", () => {
  it("escapes GitHub content and opens links through the host", () => {
    const html = renderChecks({ pullRequest: pr, snapshot, pollSeconds: 30, refreshedAt: "2026-11-01T00:00:00Z" });
    expect(html).toContain("Fix &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("e2e &lt;x&gt;");
    expect(html).toContain('data-action="open-link" data-url="https://gh/runs/1"');
    expect(html).not.toContain("<a ");
    expect(html).toContain("1 failed");
  });

  it("says when a commit has no checks", () => {
    expect(renderChecks({ pullRequest: pr, snapshot: parseChecks([], "acme/repo", 7), pollSeconds: 30, refreshedAt: "2026-11-01T00:00:00Z" })).toContain("No checks reported for this commit yet.");
  });

  it("offers approve on open pull requests, then sending to the agent", () => {
    const approve = renderReview({ pullRequest: pr, snapshot, workflow: buildPullRequestWorkflow(snapshot), approved: false, viewer: "octo" });
    expect(approve).toContain('data-action="approve"');
    expect(renderReview({ pullRequest: { ...pr, state: "merged" }, snapshot, workflow: buildPullRequestWorkflow(snapshot), approved: false })).not.toContain('data-action="approve"');
    const dispatch = renderReview({ pullRequest: pr, snapshot, workflow: buildPullRequestWorkflow(snapshot, { approved: true }), approved: true }, { busy: true, error: "GitHub <down>" });
    expect(dispatch).toContain('data-action="dispatch" disabled');
    expect(dispatch).toContain('role="alert">GitHub &lt;down&gt;');
    expect(reviewMessage({ pullRequest: pr, snapshot, workflow: buildPullRequestWorkflow(snapshot, { approved: true }), approved: true })).toContain("Failing: e2e <x>.");
  });

  it("renders waits and the manual target form", () => {
    const html = renderWaits({ pullRequest: pr, waits: [{ condition: "checks_settled", met: true, detail: "1 passed" }], pollSeconds: 30, refreshedAt: "2026-11-01T00:00:00Z" });
    expect(html).toContain('data-condition="checks_settled"');
    expect(html).toContain(">met<");
    expect(renderTargetForm("No <remote>", "acme/repo")).toContain('role="alert">No &lt;remote&gt;');
  });
});
