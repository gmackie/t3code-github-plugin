import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { buildPullRequestWorkflow, parseChecks } from "./checks.ts";
import { assertRepository, type GitHubClient } from "./github.ts";
import { localCheckout, type Git } from "./repo.ts";
import type { GitHubChecksSnapshot, PullRequestInfo } from "./types.ts";
import { VIEWS, viewHtml, type ViewName } from "./views/html.ts";
import type { ChecksData, ReviewData, WaitsData } from "./views/render.ts";
import { evaluateWaits } from "./waits.ts";

export const SERVER_INFO = { name: "github", version: "0.2.0" } as const;

export type GitHubServerOptions = {
  client: GitHubClient;
  git: Git;
  /** Host that appears in git remotes, e.g. github.com. */
  host: string;
  pollSeconds: number;
};

const target = {
  repository: z.string().optional().describe("GitHub repository as owner/name; read from cwd's remote when omitted"),
  pullRequest: z.number().int().positive().optional().describe("Pull request number; found from cwd's current branch when omitted"),
  cwd: z.string().optional().describe("Absolute path of a local checkout, used to find the repository and the branch's pull request"),
};
type Target = { repository?: string | undefined; pullRequest?: number | undefined; cwd?: string | undefined };

export function createGitHubMcpServer(options: GitHubServerOptions): McpServer {
  const { client } = options;
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "GitHub pull request checks, review and waits. Pass repository and pullRequest, or cwd of a local checkout to use its current branch's pull request. github_pr_waits evaluates wait conditions now; poll it to wait. Approving on GitHub requires a human in the review view.",
  });

  async function pullRequest({ repository, pullRequest: number, cwd }: Target): Promise<PullRequestInfo> {
    if (repository && number) return client.pullRequest(assertRepository(repository), number);
    if (!cwd) throw new Error("Pass repository and pullRequest, or cwd of a local GitHub checkout");
    const local = await localCheckout(options.git, cwd, options.host);
    const repo = repository ? assertRepository(repository) : local.repository;
    if (number) return client.pullRequest(repo, number);
    const found = await client.pullRequestForBranch(repo, local.branch);
    if (!found) throw new Error(`No pull request for branch ${local.branch} in ${repo}`);
    return found;
  }

  async function checks(pr: PullRequestInfo): Promise<GitHubChecksSnapshot> {
    return { ...parseChecks(await client.checkRows(pr.repository, pr.headSha), pr.repository, pr.number), url: pr.url };
  }

  // Approval is read back from GitHub rather than kept here: T3 runs several
  // copies of this server, and GitHub is the shared source of truth.
  async function review(pr: PullRequestInfo): Promise<ReviewData> {
    const [snapshot, viewer, reviews] = await Promise.all([
      checks(pr),
      client.viewer().catch(() => undefined),
      client.reviews(pr.repository, pr.number),
    ]);
    const mine = viewer ? reviews.filter((item) => item.author === viewer.login && item.state !== "COMMENTED" && item.state !== "PENDING") : [];
    const latest = mine.at(-1);
    const approved = latest?.state === "APPROVED" && latest.commitId === pr.headSha;
    return { pullRequest: pr, snapshot, workflow: buildPullRequestWorkflow(snapshot, { approved }), approved, ...(viewer ? { viewer: viewer.login } : {}) };
  }

  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(name), _meta: { ui: { prefersBorder: true } } }],
    }));
  }

  registerAppTool(
    server,
    "github_pr_checks",
    {
      title: "GitHub pull request checks",
      description: "List the CI checks (check runs and commit statuses) on a pull request's head commit, with a passed/failed/pending summary. Renders the checks view.",
      inputSchema: z.object(target),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.checks.uri, visibility: ["model", "app"] } },
    },
    async (args) =>
      result(async () => {
        const pr = await pullRequest(args);
        const snapshot = await checks(pr);
        const data: ChecksData = { pullRequest: pr, snapshot, pollSeconds: options.pollSeconds, refreshedAt: new Date().toISOString() };
        const { passed, failed, pending, total } = snapshot.summary;
        const failing = snapshot.checks.filter((check) => check.state === "failure" || check.state === "cancelled").map((check) => `- ${check.name} [${check.state}]${check.url ? ` ${check.url}` : ""}`);
        return {
          data,
          text: `${pr.repository}#${pr.number} "${pr.title}" (${pr.state}): ${passed}/${total} passed, ${failed} failed, ${pending} pending.${failing.length ? `\nFailing:\n${failing.join("\n")}` : ""}`,
        };
      }),
  );

  registerAppTool(
    server,
    "github_pr_review",
    {
      title: "GitHub pull request review",
      description: "Review workflow for a pull request: check evidence, whether you have approved the current head on GitHub, and the next step. Renders the review view, where a human can approve.",
      inputSchema: z.object(target),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.review.uri, visibility: ["model", "app"] } },
    },
    async (args) =>
      result(async () => {
        const data = await review(await pullRequest(args));
        const next = data.workflow.actions?.[0]?.title ?? "none";
        return { data, text: `Review of ${data.pullRequest.repository}#${data.pullRequest.number}: stage ${data.workflow.currentStage}, ${data.workflow.evidence?.[0]?.detail ?? ""}, next action: ${next}.` };
      }),
  );

  // App-only: an agent cannot approve a pull request; T3 hides this tool from
  // the model and only lets the view call it.
  server.registerTool(
    "github_pr_approve",
    {
      title: "Approve pull request on GitHub",
      description: "Submit an APPROVE review on a pull request as the GITHUB_TOKEN user, for the head commit the human reviewed.",
      inputSchema: z.object({
        repository: z.string().describe("owner/name"),
        pullRequest: z.number().int().positive(),
        headSha: z.string().min(7).describe("Head commit the human reviewed; refused if new commits were pushed since"),
        body: z.string().max(2000).optional(),
      }),
      annotations: { idempotentHint: false, openWorldHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ repository, pullRequest: number, headSha, body }) =>
      result(async () => {
        const pr = await client.pullRequest(assertRepository(repository), number);
        if (pr.state !== "open") throw new Error(`${repository}#${number} is ${pr.state}; nothing to approve`);
        if (pr.headSha !== headSha) throw new Error("New commits were pushed since this review was loaded. Refresh and review again.");
        const submitted = await client.approve(pr.repository, pr.number, pr.headSha, body);
        return { data: { approved: submitted.state === "APPROVED", review: submitted }, text: `Approved ${repository}#${number} at ${pr.headSha.slice(0, 7)}.` };
      }),
  );

  registerAppTool(
    server,
    "github_pr_waits",
    {
      title: "GitHub pull request waits",
      description:
        "Evaluate wait conditions on a pull request right now: checks_settled, new_review_activity (needs since) and pull_request_closed. Nothing is scheduled; poll this tool to wait. Renders the waits view.",
      inputSchema: z.object({
        ...target,
        since: z.iso.datetime({ offset: true }).optional().describe("ISO time; new_review_activity is met by reviews or review comments after it"),
        condition: z.enum(["checks_settled", "new_review_activity", "pull_request_closed"]).optional().describe("Only report this condition"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.waits.uri, visibility: ["model", "app"] } },
    },
    async ({ since, condition, ...args }) =>
      result(async () => {
        const pr = await pullRequest(args);
        const [snapshot, reviews, comments] = await Promise.all([
          checks(pr),
          client.reviews(pr.repository, pr.number),
          client.reviewComments(pr.repository, pr.number, since),
        ]);
        const all = evaluateWaits({ pullRequest: pr, snapshot, reviews, comments, ...(since ? { since } : {}) });
        const waits = condition ? all.filter((wait) => wait.condition === condition) : all;
        const data: WaitsData = { pullRequest: pr, waits, ...(since ? { since } : {}), pollSeconds: options.pollSeconds, refreshedAt: new Date().toISOString() };
        return { data, text: `${pr.repository}#${pr.number}:\n${waits.map((wait) => `- ${wait.condition}: ${wait.met ? "met" : "not met"} (${wait.detail})`).join("\n")}` };
      }),
  );

  return server;
}

async function result(run: () => Promise<{ data: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { data, text } = await run();
    return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}
