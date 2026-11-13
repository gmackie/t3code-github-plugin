import { toolData } from "./bridge.ts";
import type { ReviewData } from "./render.ts";
import { mountReview, startView } from "./shared.client.ts";

const bridge = startView("github-pr-review");
const review = mountReview(bridge, document.getElementById("app")!);

bridge.onToolResult = (result) => {
  try {
    review.show(toolData<ReviewData>(result));
  } catch (cause) {
    review.fail(cause instanceof Error ? cause.message : String(cause));
  }
};
void bridge.connect();
