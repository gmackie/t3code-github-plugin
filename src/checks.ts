import type { CheckState, GitHubCheck, GitHubChecksSnapshot } from "./types.ts";

export type PullRequestWorkflowModel = { readonly pluginId: string; readonly workflowId: string; readonly title: string; readonly currentStage: "inspect" | "context" | "propose" | "review" | "approve" | "execute" | "verify" | "respond"; readonly refreshedAt: string; readonly steps: readonly { id: string; stage: PullRequestWorkflowModel["currentStage"]; title: string; state: "pending" | "active" | "completed" | "blocked" | "failed"; detail?: string }[]; readonly evidence?: readonly { id: string; title: string; kind: "check" | "artifact" | "diff" | "log" | "link"; status: "neutral" | "positive" | "warning" | "negative"; detail?: string }[]; readonly actions?: readonly { id: string; title: string; tone?: "primary" | "secondary" | "destructive" }[] };

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

export function buildPullRequestWorkflow(snapshot: GitHubChecksSnapshot, state: { readonly approved?: boolean } = {}): PullRequestWorkflowModel {
  const healthy = snapshot.summary.failed === 0 && snapshot.summary.pending === 0;
  const steps = [
    { id: "inspect", stage: "inspect" as const, title: "Inspect pull request", state: "completed" as const, detail: `${snapshot.repository}#${snapshot.pullRequest}` },
    { id: "context", stage: "context" as const, title: "Collect GitHub check context", state: "completed" as const, detail: `${snapshot.summary.total} checks` },
    { id: "propose", stage: "propose" as const, title: "Propose review response", state: "completed" as const },
    { id: "review", stage: "review" as const, title: "Review check evidence", state: state.approved ? "completed" as const : "active" as const },
    { id: "approve", stage: "approve" as const, title: "Approve PR response", state: state.approved ? "completed" as const : "pending" as const },
    { id: "execute", stage: "execute" as const, title: "Dispatch approved response", state: state.approved ? "active" as const : "pending" as const },
    { id: "verify", stage: "verify" as const, title: "Verify GitHub checks", state: "pending" as const, detail: healthy ? "All checks settled successfully" : `${snapshot.summary.failed} failed · ${snapshot.summary.pending} pending` },
    { id: "respond", stage: "respond" as const, title: "Prepare review response", state: "pending" as const },
  ];
  return { pluginId: "com.t3code.github", workflowId: "github.pull-request-review", title: "Pull request review", currentStage: state.approved ? "execute" : "review", refreshedAt: new Date().toISOString(), steps, evidence: [{ id: "github-checks", title: "GitHub checks", kind: "check", status: healthy ? "positive" : snapshot.summary.failed > 0 ? "negative" : "warning", detail: `${snapshot.summary.passed}/${snapshot.summary.total} passing` }], actions: state.approved ? [] : [{ id: "approve", title: "Approve PR response", tone: "primary" }] };
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
