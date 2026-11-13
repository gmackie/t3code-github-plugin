import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";

import { HEAD, connectedClient, fakeGitHub } from "../testing.ts";

let github: ReturnType<typeof fakeGitHub>;
beforeEach(() => {
  github = fakeGitHub();
});
afterEach(() => github.stop());

type HostMessage = { id?: number; method?: string; params?: { name: string; arguments: Record<string, unknown>; url?: string; content?: { text: string }[] } };

// Runs the real checks panel module against a DOM, with this test acting as
// the T3 host frame and forwarding tools/call to the GitHub MCP server.
async function openPanel(hostContext: Record<string, unknown>, query: string) {
  const { client } = await connectedClient({ apiUrl: github.url });
  const win = new Window({ url: `https://panel.invalid/${query}` });
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const messages: string[] = [];
  const links: string[] = [];
  const deliver = (data: unknown) => win.dispatchEvent(new win.MessageEvent("message", { data, source: parent as never }));
  const parent = {
    async postMessage(message: HostMessage) {
      if (message.method === "ui/initialize") deliver({ jsonrpc: "2.0", id: message.id, result: { hostContext } });
      if (message.method === "ui/open-link") {
        links.push(message.params!.url!);
        deliver({ jsonrpc: "2.0", id: message.id, result: {} });
      }
      if (message.method === "ui/message") {
        messages.push(message.params!.content![0]!.text);
        deliver({ jsonrpc: "2.0", id: message.id, result: {} });
      }
      if (message.method === "tools/call") {
        calls.push({ name: message.params!.name, arguments: message.params!.arguments });
        deliver({ jsonrpc: "2.0", id: message.id, result: await client.callTool({ name: message.params!.name, arguments: message.params!.arguments }) });
      }
    },
  };
  Object.defineProperty(win, "parent", { value: parent });
  win.document.body.innerHTML = `<main id="app">Loading…</main>`;
  Object.assign(globalThis, { window: win, document: win.document, ResizeObserver: class { observe() {} } });
  await import(`./checks.client.ts${query}`);
  await Bun.sleep(400);
  const click = async (selector: string) => {
    (win.document.querySelector(selector) as unknown as HTMLElement).click();
    await Bun.sleep(60);
  };
  return { win, doc: win.document, calls, messages, links, deliver, click };
}

describe("checks panel in a DOM", () => {
  it("loads the thread checkout's pull request, approves it and sends the review to the agent", async () => {
    const { win, doc, calls, messages, links, click } = await openPanel({ theme: "dark", t3: { threadId: "t1", cwd: "/work/repo" } }, "?review");
    expect(calls[0]).toEqual({ name: "github_pr_checks", arguments: { cwd: "/work/repo" } });
    expect(doc.documentElement.dataset.theme).toBe("dark");
    expect(doc.querySelector("[aria-label=Checks]")?.textContent).toContain("deploy/preview");
    expect(doc.querySelector(".summary")?.textContent).toContain("1 passed1 failed1 pending");

    await click('[data-role=main] [data-action="open-link"]');
    expect(links).toEqual(["https://github.com/acme/repo/pull/7"]);

    await click("[data-action=review]");
    expect(doc.querySelector("[data-role=review] strong")?.textContent).toBe("review");
    await click("[data-action=approve]");
    expect(github.state.reviews).toMatchObject([{ state: "APPROVED", commit_id: HEAD }]);
    expect(doc.querySelector("[data-role=review] strong")?.textContent).toBe("execute");

    await click("[data-action=dispatch]");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("I approved acme/repo#7");
    expect(doc.querySelector("[data-role=review] [role=status]")?.textContent).toBe("Sent to the agent.");
    expect(calls.map((call) => call.name)).toEqual(["github_pr_checks", "github_pr_review", "github_pr_approve", "github_pr_review"]);
    expect(calls[2]?.arguments).toEqual({ repository: "acme/repo", pullRequest: 7, headSha: HEAD });
    await win.happyDOM.abort();
  });

  it("shows the error and a manual target when the thread has no GitHub checkout", async () => {
    const { win, doc, calls, deliver, click } = await openPanel({ t3: { threadId: "t1", cwd: "/elsewhere" } }, "?manual");
    expect(doc.querySelector("[role=alert]")?.textContent).toBe("/elsewhere is not a git checkout");

    (doc.querySelector("[data-role=repository]") as unknown as HTMLInputElement).value = "acme/repo";
    (doc.querySelector("[data-role=number]") as unknown as HTMLInputElement).value = "#7";
    await click("[data-action=load-target]");
    expect(calls.at(-1)).toEqual({ name: "github_pr_checks", arguments: { repository: "acme/repo", pullRequest: 7 } });
    expect(doc.querySelector(".subject")?.textContent).toContain("acme/repo#7");

    // A pinned pull request does not follow thread switches.
    deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { t3: { threadId: "t2", cwd: "/work/repo" } } });
    await Bun.sleep(50);
    expect(calls).toHaveLength(2);
    await win.happyDOM.abort();
  });

  it("follows the active thread's checkout", async () => {
    const { win, doc, calls, deliver } = await openPanel({ t3: { threadId: "t1", cwd: "/elsewhere" } }, "?follow");
    deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { t3: { threadId: "t2", cwd: "/work/repo" } } });
    await Bun.sleep(60);
    expect(calls.map((call) => call.arguments)).toEqual([{ cwd: "/elsewhere" }, { cwd: "/work/repo" }]);
    expect(doc.querySelector(".subject")?.textContent).toContain("acme/repo#7");
    await win.happyDOM.abort();
  });

  it("asks for a pull request when the panel has no thread", async () => {
    const { win, doc, calls } = await openPanel({}, "?empty");
    expect(calls).toEqual([]);
    expect(doc.querySelector("[role=alert]")?.textContent).toContain("enter a pull request");
    await win.happyDOM.abort();
  });
});
