export type CheckState = "queued" | "in_progress" | "success" | "failure" | "cancelled" | "skipped" | "neutral";

export type GitHubCheck = {
  name: string;
  state: CheckState;
  workflow?: string;
  url?: string;
  durationMs?: number;
};

export type GitHubChecksSnapshot = {
  providerId: "github";
  repository: string;
  pullRequest: number;
  checks: readonly GitHubCheck[];
  summary: { total: number; passed: number; failed: number; pending: number };
  url?: string;
};

export type PullRequestInfo = {
  repository: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headSha: string;
  headRef: string;
  author?: string;
  updatedAt?: string;
};

export type PullRequestReview = {
  id: number;
  author?: string;
  state: string;
  submittedAt?: string;
  commitId?: string;
};

export type ReviewComment = { author?: string; createdAt: string };

export type WaitCondition = "checks_settled" | "new_review_activity" | "pull_request_closed";

export type WaitStatus = { condition: WaitCondition; met: boolean; detail: string };
