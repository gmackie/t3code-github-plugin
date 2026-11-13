import { renderWaits, type WaitsData } from "./render.ts";
import { mountPanel } from "./shared.client.ts";

// "New review activity" counts from when the panel opened, unless the tool
// call that rendered it passed its own since.
const openedAt = new Date().toISOString();

mountPanel<WaitsData>({
  name: "github-waits",
  tool: "github_pr_waits",
  render: renderWaits,
  shouldPoll: (data) => data.waits.some((wait) => !wait.met),
  defaults: () => ({ since: openedAt }),
});
