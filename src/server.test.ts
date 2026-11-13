import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { HEAD, connectedClient, fakeGitHub } from "./testing.ts";

type Structured<T> = { structuredContent?: T; isError?: boolean; content: { type: string; text?: string }[] };
type McpClient = Awaited<ReturnType<typeof connectedClient>>["client"];
const call = async <T = Record<string, unknown>>(client: McpClient, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Structured<T>;

let github: ReturnType<typeof fakeGitHub>;
beforeEach(() => {
  github = fakeGitHub();
});
afterEach(() => github.stop());

describe("GitHub MCP server", () => {
  it("links UI tools to ui:// views and hides approval from the model", async () => {
    const { client } = await connectedClient({ apiUrl: github.url });
    const byName = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual(["github_pr_approve", "github_pr_checks", "github_pr_review", "github_pr_waits"]);
    expect(byName.get("github_pr_checks")?._meta).toMatchObject({ ui: { resourceUri: "ui://github/checks.html", visibility: ["model", "app"] } });
    expect(byName.get("github_pr_review")?._meta).toMatchObject({ ui: { resourceUri: "ui://github/pr-review.html", visibility: ["model", "app"] } });
    expect(byName.get("github_pr_waits")?._meta).toMatchObject({ ui: { resourceUri: "ui://github/waits.html", visibility: ["model", "app"] } });
    expect(byName.get("github_pr_approve")?._meta).toEqual({ ui: { visibility: ["app"] } });
  });

  it("serves each view as a self-contained MCP App resource", async () => {
    const { client } = await connectedClient({ apiUrl: github.url });
    const { resources } = await client.listResources();
    expect(resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([
      ["ui://github/checks.html", RESOURCE_MIME_TYPE],
      ["ui://github/waits.html", RESOURCE_MIME_TYPE],
      ["ui://github/pr-review.html", RESOURCE_MIME_TYPE],
    ]);
    for (const resource of resources) {
      const html = ((await client.readResource({ uri: resource.uri })).contents[0] as { text: string }).text;
      expect(html).toStartWith("<!doctype html>");
      expect(html).toContain("ui/initialize");
      // T3's sandbox CSP is default-src 'none': nothing may load from outside.
      expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
      expect(html.length).toBeLessThan(100_000);
    }
  });

  it("finds the pull request for the checkout's branch and summarizes its checks", async () => {
    const { client } = await connectedClient({ apiUrl: github.url });
    const result = await call<{ pullRequest: { number: number; headSha: string }; snapshot: { summary: unknown; checks: { name: string; state: string; durationMs?: number }[] } }>(client, "github_pr_checks", { cwd: "/work/repo" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.pullRequest).toMatchObject({ number: 7, headSha: HEAD });
    expect(result.structuredContent?.snapshot.summary).toEqual({ total: 3, passed: 1, failed: 1, pending: 1 });
    expect(result.structuredContent?.snapshot.checks[0]).toMatchObject({ name: "build", state: "success", durationMs: 120_000 });
    expect(result.content[0]?.text).toContain('acme/repo#7 "Add <checks> panel" (open): 1/3 passed, 1 failed, 1 pending.');
    expect(result.content[0]?.text).toContain("- deploy/preview [failure] https://preview.example/1");
    expect(github.state.requests).toContain("GET /repos/acme/repo/pulls?head=acme%3Afeature%2Fchecks&state=all&sort=updated&direction=desc&per_page=5");
  });

  it("reports missing configuration and bad input as tool errors without calling GitHub", async () => {
    const { client } = await connectedClient({ apiUrl: github.url, token: null });
    const missing = await call(client, "github_pr_checks", { repository: "acme/repo", pullRequest: 7 });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain("GITHUB_TOKEN is not set");

    const configured = await connectedClient({ apiUrl: github.url });
    const noTarget = await call(configured.client, "github_pr_checks");
    expect(noTarget.content[0]?.text).toContain("Pass repository and pullRequest, or cwd");
    expect((await call(configured.client, "github_pr_checks", { cwd: "/elsewhere" })).content[0]?.text).toContain("/elsewhere is not a git checkout");
    expect((await call(configured.client, "github_pr_checks", { repository: "../etc", pullRequest: 1 })).content[0]?.text).toContain("is not a GitHub repository");
    expect(github.state.requests).toEqual([]);
  });

  it("keeps upstream failures short and never echoes their bodies or URLs", async () => {
    const { client } = await connectedClient({ apiUrl: github.url });
    github.state.failWith = 502;
    const down = await call(client, "github_pr_checks", { repository: "acme/repo", pullRequest: 7 });
    expect(down.isError).toBe(true);
    expect(down.content[0]?.text).toBe("GitHub is temporarily unavailable (502)");

    github.state.failWith = 0;
    const unauthorized = await call((await connectedClient({ apiUrl: github.url, token: "wrong" })).client, "github_pr_review", { repository: "acme/repo", pullRequest: 7 });
    expect(unauthorized.content[0]?.text).toContain("GitHub rejected GITHUB_TOKEN (401)");
    expect(unauthorized.content[0]?.text).not.toContain(github.url);

    const unreachable = await call((await connectedClient({ apiUrl: "http://127.0.0.1:9" })).client, "github_pr_checks", { repository: "acme/repo", pullRequest: 7 });
    expect(unreachable.content[0]?.text).toBe("Could not reach the GitHub API");
  });

  it("approves on GitHub from the review and reads approval back from GitHub", async () => {
    const { client } = await connectedClient({ apiUrl: github.url });
    const target = { repository: "acme/repo", pullRequest: 7 };
    const before = await call<{ approved: boolean; viewer: string; workflow: { currentStage: string; actions: { id: string }[] } }>(client, "github_pr_review", target);
    expect(before.structuredContent).toMatchObject({ approved: false, viewer: "octo", workflow: { currentStage: "review", actions: [{ id: "approve" }] } });

    const stale = await call(client, "github_pr_approve", { ...target, headSha: "0000000old" });
    expect(stale.content[0]?.text).toContain("New commits were pushed");
    expect(github.state.reviews).toEqual([]);

    expect((await call(client, "github_pr_approve", { ...target, headSha: HEAD })).isError).toBeFalsy();
    expect(github.state.reviews).toMatchObject([{ state: "APPROVED", commit_id: HEAD }]);

    // A second server copy sees the approval: the state lives on GitHub.
    const other = await connectedClient({ apiUrl: github.url });
    const after = await call<{ approved: boolean; workflow: { currentStage: string; actions: { id: string }[] } }>(other.client, "github_pr_review", target);
    expect(after.structuredContent).toMatchObject({ approved: true, workflow: { currentStage: "execute", actions: [{ id: "dispatch" }] } });

    // New commits make the approval stale again.
    github.state.head = "fff9999newhead";
    expect((await call<{ approved: boolean }>(client, "github_pr_review", target)).structuredContent?.approved).toBe(false);
  });

  it("refuses to approve a closed pull request", async () => {
    const { client } = await connectedClient({ apiUrl: github.url });
    github.state.prState = "closed";
    const result = await call(client, "github_pr_approve", { repository: "acme/repo", pullRequest: 7, headSha: HEAD });
    expect(result.content[0]?.text).toContain("is closed");
  });

  it("evaluates wait conditions on demand", async () => {
    const { client } = await connectedClient({ apiUrl: github.url });
    const since = "2026-11-01T12:00:00Z";
    type Waits = { waits: { condition: string; met: boolean; detail: string }[] };
    const first = await call<Waits>(client, "github_pr_waits", { cwd: "/work/repo", since });
    expect(first.structuredContent?.waits.map((wait) => [wait.condition, wait.met])).toEqual([
      ["checks_settled", false],
      ["new_review_activity", false],
      ["pull_request_closed", false],
    ]);

    github.state.checkRuns = [{ name: "build", status: "completed", conclusion: "success" }];
    github.state.statuses = [];
    github.state.comments.push({ user: { login: "reviewer" }, created_at: "2026-11-01T13:00:00Z" });
    github.state.prState = "closed";
    github.state.merged = true;
    const second = await call<Waits>(client, "github_pr_waits", { cwd: "/work/repo", since });
    expect(second.structuredContent?.waits.every((wait) => wait.met)).toBe(true);
    expect(second.structuredContent?.waits[2]?.detail).toBe("Merged");

    const one = await call<Waits>(client, "github_pr_waits", { repository: "acme/repo", pullRequest: 7, condition: "pull_request_closed" });
    expect(one.structuredContent?.waits).toHaveLength(1);
    expect(one.content[0]?.text).toContain("pull_request_closed: met (Merged)");
  });
});
