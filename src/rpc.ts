import { buildPullRequestWorkflow } from "./checks.ts";
import type { GitHubChecksSnapshot } from "./types.ts";

export function createGitHubRpcHandler(coordinator: { snapshot: GitHubChecksSnapshot | null; refresh(): Promise<GitHubChecksSnapshot> }) {
  return async (method: string, _payload?: { workflowId?: string; actionId?: string }) => {
    if (method !== "workflow.get") return { ok: false as const, error: `unsupported GitHub RPC method: ${method}` };
    return { ok: true as const, result: buildPullRequestWorkflow(coordinator.snapshot ?? (await coordinator.refresh())) };
  };
}
