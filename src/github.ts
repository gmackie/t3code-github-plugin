import type { PullRequestInfo, PullRequestReview, ReviewComment } from "./types.ts";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MISSING_TOKEN = "GITHUB_TOKEN is not set. Add a GitHub token to the github server in Settings → Tools.";
const TIMEOUT_MS = 15_000;

// A gh-style check row (`gh pr checks --json name,state,link,startedAt,completedAt`),
// which is what the domain's parseChecks normalizes.
export type CheckRow = { name: string; state: string; link?: string; startedAt?: string; completedAt?: string };

export type GitHubClient = {
  viewer(): Promise<{ login: string }>;
  pullRequest(repository: string, number: number): Promise<PullRequestInfo>;
  pullRequestForBranch(repository: string, branch: string): Promise<PullRequestInfo | undefined>;
  checkRows(repository: string, sha: string): Promise<CheckRow[]>;
  reviews(repository: string, number: number): Promise<PullRequestReview[]>;
  reviewComments(repository: string, number: number, since?: string): Promise<ReviewComment[]>;
  approve(repository: string, number: number, commitId: string, body?: string): Promise<PullRequestReview>;
};

const SEGMENT = /^(?!\.\.?$)[A-Za-z0-9_.-]+$/;

export function isRepository(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => SEGMENT.test(part));
}

export function assertRepository(repository: string): string {
  if (!isRepository(repository)) throw new Error(`"${repository}" is not a GitHub repository; use owner/name`);
  return repository;
}

// GitHub REST API (v3). Works against api.github.com and GitHub Enterprise
// Server (`https://<host>/api/v3`).
export function createGitHubClient(options: { apiUrl: string; token?: string; fetch?: Fetch }): GitHubClient {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = options.apiUrl.replace(/\/+$/, "");

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!options.token) throw new Error(MISSING_TOKEN);
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "t3code-github-plugin",
          authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new GitHubApiError(0, `GitHub did not respond within ${TIMEOUT_MS / 1000}s`);
      throw new GitHubApiError(0, "Could not reach the GitHub API");
    }
    // 5xx bodies are HTML or noise: keep the message short and never echo them.
    if (response.status >= 500) throw new GitHubApiError(response.status, `GitHub is temporarily unavailable (${response.status})`);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) throw new GitHubApiError(response.status, describe(response.status, method, json));
    return json as T;
  }

  const repoPath = (repository: string) => {
    const [owner, name] = assertRepository(repository).split("/") as [string, string];
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  };

  return {
    async viewer() {
      const user = await call<{ login: string }>("GET", "/user");
      return { login: user.login };
    },
    async pullRequest(repository, number) {
      return toPullRequest(repository, await call<RestPull>("GET", `${repoPath(repository)}/pulls/${number}`));
    },
    async pullRequestForBranch(repository, branch) {
      const owner = repository.split("/")[0]!;
      const head = encodeURIComponent(`${owner}:${branch}`);
      const pulls = await call<RestPull[]>("GET", `${repoPath(repository)}/pulls?head=${head}&state=all&sort=updated&direction=desc&per_page=5`);
      // Prefer an open pull request over older closed ones for the same branch.
      const pull = pulls.find((item) => item.state === "open") ?? pulls[0];
      return pull ? toPullRequest(repository, pull) : undefined;
    },
    async checkRows(repository, sha) {
      const ref = encodeURIComponent(sha);
      const [runs, status] = await Promise.all([
        call<{ check_runs?: RestCheckRun[] }>("GET", `${repoPath(repository)}/commits/${ref}/check-runs?per_page=100`),
        call<{ statuses?: RestStatus[] }>("GET", `${repoPath(repository)}/commits/${ref}/status?per_page=100`),
      ]);
      return checkRowsFromRest(runs.check_runs ?? [], status.statuses ?? []);
    },
    async reviews(repository, number) {
      const reviews = await call<RestReview[]>("GET", `${repoPath(repository)}/pulls/${number}/reviews?per_page=100`);
      return reviews.map(toReview);
    },
    async reviewComments(repository, number, since) {
      const query = since ? `&since=${encodeURIComponent(since)}` : "";
      const comments = await call<{ user?: { login?: string } | null; created_at: string }[]>(
        "GET",
        `${repoPath(repository)}/pulls/${number}/comments?per_page=100&sort=created&direction=desc${query}`,
      );
      return comments.map((comment) => ({ ...(comment.user?.login ? { author: comment.user.login } : {}), createdAt: comment.created_at }));
    },
    async approve(repository, number, commitId, body) {
      const review = await call<RestReview>("POST", `${repoPath(repository)}/pulls/${number}/reviews`, {
        event: "APPROVE",
        commit_id: commitId,
        ...(body ? { body } : {}),
      });
      return toReview(review);
    },
  };
}

function describe(status: number, method: string, json: unknown): string {
  const raw = json && typeof json === "object" && "message" in json ? String(json.message) : "";
  const message = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
  if (status === 401) return "GitHub rejected GITHUB_TOKEN (401). Check the token in Settings → Tools.";
  if (status === 404) return "GitHub returned 404: check the repository, pull request number and that GITHUB_TOKEN can read it.";
  return `GitHub ${method} failed (${status})${message ? `: ${message}` : ""}`;
}

type RestPull = {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  merged_at?: string | null;
  draft?: boolean;
  head: { sha: string; ref: string };
  user?: { login?: string } | null;
  updated_at?: string;
};

type RestReview = { id: number; user?: { login?: string } | null; state: string; submitted_at?: string | null; commit_id?: string | null };

export type RestCheckRun = {
  name: string;
  status: string;
  conclusion?: string | null;
  html_url?: string | null;
  details_url?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

export type RestStatus = { context: string; state: string; target_url?: string | null };

function toPullRequest(repository: string, pull: RestPull): PullRequestInfo {
  return {
    repository,
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    state: pull.merged_at ? "merged" : pull.state,
    draft: pull.draft === true,
    headSha: pull.head.sha,
    headRef: pull.head.ref,
    ...(pull.user?.login ? { author: pull.user.login } : {}),
    ...(pull.updated_at ? { updatedAt: pull.updated_at } : {}),
  };
}

function toReview(review: RestReview): PullRequestReview {
  return {
    id: review.id,
    state: review.state,
    ...(review.user?.login ? { author: review.user.login } : {}),
    ...(review.submitted_at ? { submittedAt: review.submitted_at } : {}),
    ...(review.commit_id ? { commitId: review.commit_id } : {}),
  };
}

const CONCLUSION_STATE: Record<string, string> = {
  success: "SUCCESS",
  failure: "FAILURE",
  timed_out: "FAILURE",
  action_required: "FAILURE",
  startup_failure: "FAILURE",
  cancelled: "CANCELLED",
  skipped: "SKIPPED",
};

const STATUS_STATE: Record<string, string> = { success: "SUCCESS", failure: "FAILURE", error: "FAILURE", pending: "IN_PROGRESS" };

// Maps REST check runs and legacy commit statuses onto gh-style rows so the
// domain's parseChecks stays the single normalizer.
export function checkRowsFromRest(runs: readonly RestCheckRun[], statuses: readonly RestStatus[]): CheckRow[] {
  const fromRuns = runs.map((run): CheckRow => {
    const state = run.status === "completed" ? (CONCLUSION_STATE[run.conclusion ?? ""] ?? "NEUTRAL") : run.status === "in_progress" ? "IN_PROGRESS" : "QUEUED";
    const link = run.html_url ?? run.details_url;
    return {
      name: run.name,
      state,
      ...(link ? { link } : {}),
      ...(run.started_at ? { startedAt: run.started_at } : {}),
      ...(run.completed_at ? { completedAt: run.completed_at } : {}),
    };
  });
  const fromStatuses = statuses.map((status): CheckRow => ({
    name: status.context,
    state: STATUS_STATE[status.state] ?? "NEUTRAL",
    ...(status.target_url ? { link: status.target_url } : {}),
  }));
  return [...fromRuns, ...fromStatuses];
}
