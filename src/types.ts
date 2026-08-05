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

export type GitHubWait = {
  id: string;
  repository: string;
  pullRequest: number;
  condition: "checks_settled" | "new_review_activity" | "pull_request_closed";
  expiresAt: string;
};
