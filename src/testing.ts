// Test fixtures: a fake GitHub REST API on a local Bun.serve, a fake git, and
// an MCP client connected in memory to the real server and HTTP client.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createGitHubClient } from "./github.ts";
import type { Git } from "./repo.ts";
import { createGitHubMcpServer } from "./server.ts";

export const TOKEN = "test-token";
export const HEAD = "abc1234def5678";

type Review = { id: number; user: { login: string }; state: string; submitted_at: string; commit_id: string };

export function fakeGitHub() {
  const state = {
    failWith: 0,
    head: HEAD,
    prState: "open" as "open" | "closed",
    merged: false,
    reviews: [] as Review[],
    comments: [] as { user: { login: string }; created_at: string }[],
    requests: [] as string[],
    checkRuns: [
      { name: "build", status: "completed", conclusion: "success", html_url: "https://github.com/acme/repo/runs/1", started_at: "2026-11-01T10:00:00Z", completed_at: "2026-11-01T10:02:00Z" },
      { name: "test", status: "in_progress", conclusion: null, html_url: "https://github.com/acme/repo/runs/2", started_at: "2026-11-01T10:00:00Z" },
    ] as unknown[],
    statuses: [{ context: "deploy/preview", state: "failure", target_url: "https://preview.example/1" }] as unknown[],
  };
  const pull = () => ({
    number: 7,
    title: "Add <checks> panel",
    html_url: "https://github.com/acme/repo/pull/7",
    state: state.prState,
    merged_at: state.merged ? "2026-11-02T00:00:00Z" : null,
    draft: false,
    head: { sha: state.head, ref: "feature/checks" },
    user: { login: "author" },
    updated_at: "2026-11-01T09:00:00Z",
  });
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      state.requests.push(`${request.method} ${url.pathname}${url.search}`);
      if (state.failWith) return new Response("<html>upstream stack trace at http://internal.example/secret</html>", { status: state.failWith });
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ message: "Bad credentials" }, { status: 401 });
      const path = url.pathname;
      if (path === "/user") return Response.json({ login: "octo" });
      if (path === "/repos/acme/repo/pulls" && url.searchParams.get("head") === "acme:feature/checks") return Response.json([pull()]);
      if (path === "/repos/acme/repo/pulls") return Response.json([]);
      if (path === "/repos/acme/repo/pulls/7") return Response.json(pull());
      if (path === `/repos/acme/repo/commits/${state.head}/check-runs`) return Response.json({ total_count: state.checkRuns.length, check_runs: state.checkRuns });
      if (path === `/repos/acme/repo/commits/${state.head}/status`) return Response.json({ state: "pending", statuses: state.statuses });
      if (path === "/repos/acme/repo/pulls/7/comments") {
        const since = url.searchParams.get("since");
        return Response.json(state.comments.filter((comment) => !since || comment.created_at >= since));
      }
      if (path === "/repos/acme/repo/pulls/7/reviews" && request.method === "GET") return Response.json(state.reviews);
      if (path === "/repos/acme/repo/pulls/7/reviews" && request.method === "POST") {
        const body = (await request.json()) as { event: string; commit_id: string };
        if (body.event !== "APPROVE") return Response.json({ message: "Unexpected event" }, { status: 422 });
        const review = { id: state.reviews.length + 1, user: { login: "octo" }, state: "APPROVED", submitted_at: new Date().toISOString(), commit_id: body.commit_id };
        state.reviews.push(review);
        return Response.json(review);
      }
      return Response.json({ message: "Not Found" }, { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, state, stop: () => server.stop(true) };
}

// A checkout of acme/repo on feature/checks at /work/repo.
export const fakeGit: Git = async (cwd, args) => {
  if (cwd !== "/work/repo") throw new Error("not a git repository");
  if (args[0] === "remote") return "upstream\thttps://github.com/other/fork.git (fetch)\norigin\tgit@github.com:acme/repo.git (fetch)\norigin\tgit@github.com:acme/repo.git (push)";
  if (args[0] === "rev-parse") return "feature/checks";
  throw new Error(`unexpected git ${args.join(" ")}`);
};

export async function connectedClient(options: { apiUrl: string; token?: string | null }) {
  const token = options.token === null ? undefined : (options.token ?? TOKEN);
  const server = createGitHubMcpServer({
    client: createGitHubClient({ apiUrl: options.apiUrl, ...(token ? { token } : {}) }),
    git: fakeGit,
    host: "github.com",
    pollSeconds: 30,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}
