// Pure HTML renderers shared by the ui:// views (bundled into the browser) and
// the tests. All dynamic text goes through esc().
import type { PullRequestWorkflowModel } from "../checks.ts";
import type { CheckState, GitHubChecksSnapshot, PullRequestInfo, WaitStatus } from "../types.ts";

export type ChecksData = { pullRequest: PullRequestInfo; snapshot: GitHubChecksSnapshot; pollSeconds: number; refreshedAt: string };

export type ReviewData = { pullRequest: PullRequestInfo; snapshot: GitHubChecksSnapshot; workflow: PullRequestWorkflowModel; approved: boolean; viewer?: string };

export type WaitsData = { pullRequest: PullRequestInfo; waits: readonly WaitStatus[]; since?: string; pollSeconds: number; refreshedAt: string };

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

function pill(label: string, tone: string): string {
  return `<span class="pill pill-${esc(tone)}">${esc(label)}</span>`;
}

const checkTone: Record<CheckState, string> = {
  queued: "active",
  in_progress: "active",
  success: "positive",
  failure: "negative",
  cancelled: "negative",
  skipped: "muted",
  neutral: "muted",
};

const prTone: Record<PullRequestInfo["state"], string> = { open: "positive", merged: "active", closed: "muted" };

const duration = (ms?: number) => (ms === undefined ? "" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

// Links open through the host (ui/open-link): the view's sandbox cannot navigate.
const link = (url: string, label: string) => `<button type="button" data-action="open-link" data-url="${esc(url)}">${esc(label)}</button>`;

export function renderSubject(pr: PullRequestInfo): string {
  return `<p class="subject">${esc(pr.title)} ${pill(pr.draft && pr.state === "open" ? "draft" : pr.state, prTone[pr.state])} <span class="mono">${esc(pr.repository)}#${esc(pr.number)}</span> <span class="mono">${esc(pr.headSha.slice(0, 7))}</span> ${link(pr.url, "Open on GitHub")}</p>`;
}

export function renderTargetForm(message?: string, repository = ""): string {
  return `${message ? `<p class="error" role="alert">${esc(message)}</p>` : ""}
<div class="target-form" data-role="target">
  <input data-role="repository" placeholder="owner/name" aria-label="Repository" value="${esc(repository)}" autocomplete="off">
  <input data-role="number" placeholder="PR #" aria-label="Pull request number" inputmode="numeric" size="6" autocomplete="off">
  <button type="button" data-action="load-target">Load</button>
</div>`;
}

export function renderChecks(data: ChecksData): string {
  const { snapshot, pullRequest } = data;
  const { summary } = snapshot;
  const rows = snapshot.checks.length
    ? snapshot.checks
        .map(
          (check) => `<li class="row">
  <div class="row-main">
    <div class="row-title">${esc(check.name)}</div>
    <div class="row-meta">${pill(check.state.replace("_", " "), checkTone[check.state])}${check.workflow ? `<span>${esc(check.workflow)}</span>` : ""}${check.durationMs !== undefined ? `<span>${esc(duration(check.durationMs))}</span>` : ""}</div>
  </div>
  ${check.url ? link(check.url, "Details") : ""}
</li>`,
        )
        .join("\n")
    : `<li class="empty">No checks reported for this commit yet.</li>`;
  return `<header>
  <h1>Pull request checks</h1>
  <div class="header-meta"><span>Refreshed ${esc(time(data.refreshedAt))}</span><button type="button" data-action="refresh">Refresh</button><button type="button" data-action="review">Review</button></div>
</header>
${renderSubject(pullRequest)}
<div class="summary">${pill(`${summary.passed} passed`, "positive")}${pill(`${summary.failed} failed`, summary.failed ? "negative" : "muted")}${pill(`${summary.pending} pending`, summary.pending ? "active" : "muted")}</div>
<section aria-label="Checks"><h2>Checks <span class="count">${summary.total}</span></h2><ul>${rows}</ul></section>`;
}

const conditionTitle: Record<WaitStatus["condition"], string> = {
  checks_settled: "Checks settled",
  new_review_activity: "New review activity",
  pull_request_closed: "Pull request closed",
};

export function renderWaits(data: WaitsData): string {
  const rows = data.waits
    .map(
      (wait) => `<li class="row" data-condition="${esc(wait.condition)}">
  <div class="row-main">
    <div class="row-title">${esc(conditionTitle[wait.condition])}</div>
    <div class="row-meta">${pill(wait.met ? "met" : "waiting", wait.met ? "positive" : "active")}<span>${esc(wait.detail)}</span></div>
  </div>
</li>`,
    )
    .join("\n");
  return `<header>
  <h1>GitHub waits</h1>
  <div class="header-meta"><span>Checked ${esc(time(data.refreshedAt))} · every ${esc(data.pollSeconds)}s</span><button type="button" data-action="refresh">Refresh</button></div>
</header>
${renderSubject(data.pullRequest)}
<section aria-label="Waits"><h2>Conditions${data.since ? ` since ${esc(time(data.since))}` : ""}</h2><ul>${rows}</ul></section>`;
}

const stepIcon: Record<PullRequestWorkflowModel["steps"][number]["state"], string> = {
  pending: "○",
  active: "◐",
  completed: "●",
  blocked: "◌",
  failed: "✕",
};

export function renderReview(data: ReviewData, options: { busy?: boolean; error?: string; notice?: string } = {}): string {
  const { workflow, pullRequest } = data;
  const steps = workflow.steps
    .map(
      (step) => `<li class="step step-${esc(step.state)}"><span class="step-icon" aria-hidden="true">${stepIcon[step.state]}</span><div><div class="row-title">${esc(step.title)}</div>${step.detail ? `<div class="row-detail">${esc(step.detail)}</div>` : ""}</div><span class="sr">${esc(step.state)}</span></li>`,
    )
    .join("\n");
  const evidence = (workflow.evidence ?? [])
    .map((item) => `<li class="row"><div class="row-main"><div class="row-title">${esc(item.title)}</div><div class="row-meta">${pill(item.status, item.status)}${item.detail ? `<span>${esc(item.detail)}</span>` : ""}</div></div></li>`)
    .join("\n");
  // Approving is only offered on an open pull request.
  const actions = (workflow.actions ?? [])
    .filter((action) => action.id !== "approve" || pullRequest.state === "open")
    .map((action) => `<button type="button" class="${action.tone === "primary" ? "primary" : ""}" data-action="${esc(action.id)}" ${options.busy ? "disabled" : ""}>${esc(action.title)}</button>`)
    .join("");
  return `<header>
  <h1>${esc(workflow.title)}</h1>
  <div class="header-meta"><span>Stage: <strong>${esc(workflow.currentStage)}</strong></span><button type="button" data-action="refresh-review">Refresh</button></div>
</header>
${renderSubject(pullRequest)}
${data.viewer ? `<p class="row-detail">Signed in to GitHub as ${esc(data.viewer)}${data.approved ? " · you approved this head commit" : ""}</p>` : ""}
${options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : ""}
${options.notice ? `<p class="row-detail" role="status">${esc(options.notice)}</p>` : ""}
<ol class="steps">${steps}</ol>
${evidence ? `<section aria-label="Evidence"><h2>Evidence</h2><ul>${evidence}</ul></section>` : ""}
${actions ? `<div class="actions">${actions}</div>` : ""}`;
}

// The message "Send to agent" posts into the thread (ui/message).
export function reviewMessage(data: ReviewData): string {
  const { pullRequest: pr, snapshot } = data;
  const failing = snapshot.checks.filter((check) => check.state === "failure" || check.state === "cancelled").map((check) => check.name);
  return [
    `I approved ${pr.repository}#${pr.number} "${pr.title}" on GitHub at ${pr.headSha.slice(0, 7)} (${pr.url}).`,
    `Checks: ${snapshot.summary.passed}/${snapshot.summary.total} passed, ${snapshot.summary.failed} failed, ${snapshot.summary.pending} pending.${failing.length ? ` Failing: ${failing.join(", ")}.` : ""}`,
    "Prepare the review response: follow up on any failing or pending checks and summarize what is left before merge.",
  ].join("\n");
}

export const STYLES = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: transparent; --line: #d0d7de; --accent: #0969da; --pos: #1a7f37; --neg: #cf222e; --warn: #9a6700; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:root[data-theme="dark"] { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--fg); background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.header-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); }
ul, ol { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; } .row-title { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 12px; margin-top: 2px; }
.row-detail { color: var(--muted); font-size: 12px; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.count { font-weight: 400; } .empty { color: var(--muted); padding: 8px 0; border-top: 1px solid var(--line); }
.pill { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 17px; }
.pill-active { color: var(--accent); } .pill-positive { color: var(--pos); } .pill-negative { color: var(--neg); } .pill-warning { color: var(--warn); } .pill-neutral, .pill-muted { color: var(--muted); }
button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
input { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
input[type="search"] { width: 100%; margin-top: 10px; }
.steps { margin-top: 10px; } .step { display: flex; gap: 10px; padding: 6px 0; align-items: flex-start; }
.step-icon { width: 14px; text-align: center; color: var(--muted); } .step-active .step-icon { color: var(--accent); } .step-completed .step-icon { color: var(--pos); } .step-failed .step-icon { color: var(--neg); }
.step-pending .row-title { color: var(--muted); font-weight: 400; }
.actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; flex-wrap: wrap; } .field { display: flex; gap: 6px; align-items: center; color: var(--muted); }
.subject { margin: 6px 0 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.error { color: var(--neg); } .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.target-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; } .target-form input { min-width: 0; }
.summary { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
[data-role="review"]:not(:empty) { margin-top: 16px; padding-top: 4px; border-top: 2px solid var(--line); }
`;
