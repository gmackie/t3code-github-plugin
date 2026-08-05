import type { CheckState, GitHubCheck, GitHubChecksSnapshot } from "./types.ts";

type GhCheck = { name?: unknown; state?: unknown; workflow?: unknown; link?: unknown; startedAt?: unknown; completedAt?: unknown };

const states = new Set<CheckState>(["queued", "in_progress", "success", "failure", "cancelled", "skipped", "neutral"]);

export function parseChecks(input: unknown, repository: string, pullRequest: number): GitHubChecksSnapshot {
  const rows = Array.isArray(input) ? input : [];
  const checks = rows.flatMap((row): GitHubCheck[] => {
    if (!row || typeof row !== "object") return [];
    const value = row as GhCheck;
    if (typeof value.name !== "string") return [];
    const state = normalizeState(value.state);
    const started = parseTime(value.startedAt);
    const completed = parseTime(value.completedAt);
    return [{
      name: value.name,
      state,
      ...(typeof value.workflow === "string" ? { workflow: value.workflow } : {}),
      ...(typeof value.link === "string" ? { url: value.link } : {}),
      ...(started !== undefined && completed !== undefined ? { durationMs: Math.max(0, completed - started) } : {}),
    }];
  });
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.state === "success").length,
    failed: checks.filter((check) => check.state === "failure" || check.state === "cancelled").length,
    pending: checks.filter((check) => check.state === "queued" || check.state === "in_progress").length,
  };
  return { providerId: "github", repository, pullRequest, checks, summary };
}

function normalizeState(value: unknown): CheckState {
  if (typeof value !== "string") return "neutral";
  const normalized = value.toLowerCase().replace(/[- ]/g, "_");
  return states.has(normalized as CheckState) ? normalized as CheckState : "neutral";
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}
