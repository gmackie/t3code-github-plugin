import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";

import { connectedClient, fakeGitHub } from "../testing.ts";
import { createViewBridge, toolData, type BridgeWindow, type CallToolResult } from "./bridge.ts";

// Wires the view bridge to ext-apps' reference host (AppBridge) the way an
// iframe is wired to its parent: the host sends with postMessage into the view
// window, the view posts to window.parent.
function frame() {
  const listeners: ((event: { data: unknown; source?: unknown }) => void)[] = [];
  const parent = {
    postMessage(message: unknown) {
      queueMicrotask(() => hostTransport.onmessage?.(structuredClone(message) as never));
    },
  };
  const win: BridgeWindow = { parent, addEventListener: (_type, listener) => void listeners.push(listener) };
  const hostTransport = {
    onmessage: undefined as ((message: never) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
    async start() {},
    async close() {
      hostTransport.onclose?.();
    },
    async send(message: unknown) {
      queueMicrotask(() => listeners.forEach((listener) => listener({ data: structuredClone(message), source: parent })));
    },
  };
  return { win, hostTransport, inject: (data: unknown, source: unknown) => listeners.forEach((listener) => listener({ data, source })) };
}

let github: ReturnType<typeof fakeGitHub>;
beforeEach(() => {
  github = fakeGitHub();
});
afterEach(() => github.stop());

describe("view bridge against the ext-apps reference host", () => {
  it("initializes, receives the tool result and calls server tools through the host", async () => {
    const { client } = await connectedClient({ apiUrl: github.url });
    const host = new AppBridge(client as never, { name: "reference-host", version: "1.0.0" }, { serverTools: {} });
    const { win, hostTransport } = frame();
    const initialized = new Promise<void>((resolve) => {
      host.oninitialized = () => resolve();
    });
    await host.connect(hostTransport as never);

    const view = createViewBridge(win, { name: "github-checks", version: "0.2.0" });
    const received: CallToolResult[] = [];
    view.onToolResult = (result) => received.push(result);
    await view.connect();
    await initialized;

    const target = { repository: "acme/repo", pullRequest: 7 };
    const toolResult = await client.callTool({ name: "github_pr_checks", arguments: target });
    await host.sendToolResult(toolResult as never);
    await Bun.sleep(0);
    expect(toolData<{ snapshot: { checks: unknown[] } }>(received[0]!).snapshot.checks).toHaveLength(3);

    // View → host → MCP server round trip, as the Review button does.
    const review = toolData<{ workflow: { currentStage: string }; pullRequest: { headSha: string } }>(await view.callTool("github_pr_review", target));
    expect(review.workflow.currentStage).toBe("review");
    await expect(view.callTool("github_pr_approve", { ...target, headSha: review.pullRequest.headSha })).resolves.toMatchObject({ structuredContent: { approved: true } });
  });

  it("ignores messages that do not come from the host frame", () => {
    const { win, inject } = frame();
    const view = createViewBridge(win, { name: "github", version: "0" });
    let called = false;
    view.onToolResult = () => {
      called = true;
    };
    inject({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: {} }, { evil: true });
    expect(called).toBe(false);
  });

  it("surfaces tool errors from structured results", () => {
    expect(() => toolData({ isError: true, content: [{ type: "text", text: "GitHub is temporarily unavailable (502)" }] })).toThrow("GitHub is temporarily unavailable (502)");
  });
});
