import type { GitHubChecksSnapshot, PullRequestInfo, PullRequestReview, ReviewComment, WaitStatus } from "./types.ts";

// On-demand replacement for v1's durable waitpoints: each condition is
// evaluated against GitHub now. Callers (the waits view, or an agent) poll.
export function evaluateWaits(input: {
  pullRequest: PullRequestInfo;
  snapshot: GitHubChecksSnapshot;
  reviews: readonly PullRequestReview[];
  comments: readonly ReviewComment[];
  since?: string;
}): WaitStatus[] {
  const { pullRequest, snapshot, since } = input;
  const { total, pending, failed, passed } = snapshot.summary;
  const checks: WaitStatus =
    total === 0
      ? { condition: "checks_settled", met: false, detail: "No checks reported yet" }
      : pending > 0
        ? { condition: "checks_settled", met: false, detail: `${pending} of ${total} checks still running` }
        : { condition: "checks_settled", met: true, detail: `${passed} passed · ${failed} failed of ${total}` };

  const activity = [
    ...input.reviews.flatMap((review) => (review.submittedAt ? [{ at: review.submittedAt, author: review.author, kind: `review ${review.state.toLowerCase().replaceAll("_", " ")}` }] : [])),
    ...input.comments.map((comment) => ({ at: comment.createdAt, author: comment.author, kind: "review comment" })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const sinceTime = since === undefined ? undefined : Date.parse(since);
  const latest = activity[0];
  const describeLatest = latest ? `latest: ${latest.kind}${latest.author ? ` by ${latest.author}` : ""} at ${latest.at}` : "no review activity yet";
  let review: WaitStatus;
  if (sinceTime === undefined || Number.isNaN(sinceTime)) {
    review = { condition: "new_review_activity", met: false, detail: `Pass since to wait for new activity; ${describeLatest}` };
  } else {
    const fresh = activity.filter((item) => Date.parse(item.at) > sinceTime);
    review = fresh.length
      ? { condition: "new_review_activity", met: true, detail: `${fresh.length} new since ${since}; ${describeLatest}` }
      : { condition: "new_review_activity", met: false, detail: `Nothing new since ${since}` };
  }

  const closed: WaitStatus =
    pullRequest.state === "open"
      ? { condition: "pull_request_closed", met: false, detail: pullRequest.draft ? "Open (draft)" : "Open" }
      : { condition: "pull_request_closed", met: true, detail: pullRequest.state === "merged" ? "Merged" : "Closed without merging" };

  return [checks, review, closed];
}
