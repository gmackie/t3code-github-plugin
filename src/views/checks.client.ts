import { renderChecks, type ChecksData } from "./render.ts";
import { mountPanel, mountReview } from "./shared.client.ts";

let review: ReturnType<typeof mountReview> | undefined;

// Polls while checks are still running; "Review" opens the review inline.
mountPanel<ChecksData>({
  name: "github-checks",
  tool: "github_pr_checks",
  render: renderChecks,
  shouldPoll: (data) => data.pullRequest.state === "open" && (data.snapshot.summary.pending > 0 || data.snapshot.summary.total === 0),
  onReview: (bridge, pane, data) => {
    review ??= mountReview(bridge, pane);
    void review.load(data.pullRequest);
  },
});
