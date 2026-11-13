import type { PullRequestInfo } from "../types.ts";
import { createViewBridge, toolData, type CallToolResult, type HostContext, type ViewBridge } from "./bridge.ts";
import { esc, renderReview, renderTargetForm, reviewMessage, type ReviewData } from "./render.ts";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

// host-context-changed may carry only the changed fields, so merge them.
export function startView(name: string, onContext?: (context: HostContext, previous: HostContext) => void): ViewBridge {
  const bridge = createViewBridge(window as never, { name, version: "0.2.0" });
  let context: HostContext = {};
  bridge.onHostContext = (update) => {
    const previous = context;
    context = { ...context, ...update };
    if (context.theme) document.documentElement.dataset.theme = context.theme;
    onContext?.(context, previous);
  };
  new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);
  return bridge;
}

function openLinks(bridge: ViewBridge, root: HTMLElement, onError: (error: string) => void) {
  root.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action=open-link]");
    if (target?.dataset.url) bridge.openLink(target.dataset.url).catch((cause: unknown) => onError(message(cause)));
  });
}

type PanelData = { pullRequest: PullRequestInfo; pollSeconds: number };

/**
 * A thread panel about one pull request. It loads from the tool result the host
 * delivers, or else from the thread's checkout (hostContext.t3.cwd), and follows
 * the active thread. A pull request entered by hand pins the panel to it.
 */
export function mountPanel<T extends PanelData>(options: {
  name: string;
  tool: string;
  render: (data: T) => string;
  shouldPoll: (data: T) => boolean;
  defaults?: () => Record<string, unknown>;
  onReview?: (bridge: ViewBridge, pane: HTMLElement, data: T) => void;
}) {
  const root = document.getElementById("app")!;
  root.innerHTML = `<div data-role="main"></div><div data-role="review"></div>`;
  const main = root.querySelector<HTMLElement>("[data-role=main]")!;
  const pane = root.querySelector<HTMLElement>("[data-role=review]")!;
  let cwd: string | undefined;
  let args: Record<string, unknown> = {};
  let data: T | undefined;
  let received = false;
  let pinned = false;
  let connected = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const bridge = startView(options.name, (context, previous) => {
    cwd = context.t3?.cwd;
    if (connected && !pinned && cwd !== previous.t3?.cwd) {
      args = cwd ? { cwd } : {};
      data = undefined;
      pane.innerHTML = "";
      void refresh();
    }
  });

  const fail = (error: string) => {
    const status = main.querySelector("header .header-meta span");
    if (data && status) status.textContent = error;
    else main.innerHTML = renderTargetForm(error, typeof args.repository === "string" ? args.repository : "");
  };

  function show(result: CallToolResult) {
    received = true;
    try {
      data = toolData<T>(result);
      main.innerHTML = options.render(data);
    } catch (cause) {
      fail(message(cause));
    }
    clearTimeout(timer);
    if (data && options.shouldPoll(data)) timer = setTimeout(() => void refresh(), data.pollSeconds * 1000);
  }

  async function refresh() {
    if (!args.cwd && !(args.repository && args.pullRequest)) {
      main.innerHTML = renderTargetForm("Open this panel in a thread whose project is a GitHub checkout, or enter a pull request.");
      return;
    }
    if (document.visibilityState === "hidden") {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 5000);
      return;
    }
    try {
      show(await bridge.callTool(options.tool, { ...options.defaults?.(), ...args }));
    } catch (cause) {
      fail(`Refresh failed: ${message(cause)}`);
    }
  }

  openLinks(bridge, main, fail);
  main.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "refresh") void refresh();
    if (action === "review" && data) options.onReview?.(bridge, pane, data);
    if (action === "load-target") {
      const repository = main.querySelector<HTMLInputElement>("[data-role=repository]")?.value.trim() ?? "";
      const pullRequest = Number(main.querySelector<HTMLInputElement>("[data-role=number]")?.value.trim().replace(/^#/, ""));
      if (!repository || !Number.isInteger(pullRequest) || pullRequest <= 0) {
        fail("Enter a repository as owner/name and a pull request number.");
        return;
      }
      pinned = true;
      args = { repository, pullRequest };
      data = undefined;
      void refresh();
    }
  });

  bridge.onToolInput = (input) => {
    args = input;
  };
  bridge.onToolResult = show;
  // Inline after a tool call the host delivers the result; an opened panel
  // only loads the resource, so fetch for the thread's checkout instead.
  void bridge.connect().then(() => {
    connected = true;
    setTimeout(() => {
      if (received) return;
      if (!Object.keys(args).length && cwd) args = { cwd };
      void refresh();
    }, 250);
  });
  return bridge;
}

// Review workflow controller, shared by the standalone review view and the
// review pane of the checks panel.
export function mountReview(bridge: ViewBridge, root: HTMLElement) {
  let data: ReviewData | undefined;
  let busy = false;
  let error: string | undefined;
  let notice: string | undefined;

  const draw = () => {
    if (data) root.innerHTML = renderReview(data, { busy, ...(error ? { error } : {}), ...(notice ? { notice } : {}) });
    else if (error) root.innerHTML = `<p class="error" role="alert">${esc(error)}</p>`;
    else if (busy) root.innerHTML = `<p class="row-detail">Loading review…</p>`;
  };
  const run = async (task: () => Promise<void>) => {
    busy = true;
    error = undefined;
    notice = undefined;
    draw();
    try {
      await task();
    } catch (cause) {
      error = message(cause);
    }
    busy = false;
    draw();
  };
  const target = (pr: PullRequestInfo) => ({ repository: pr.repository, pullRequest: pr.number });
  const reload = async (pr: PullRequestInfo) => {
    data = toolData<ReviewData>(await bridge.callTool("github_pr_review", target(pr)));
  };

  openLinks(bridge, root, (failure) => {
    error = failure;
    draw();
  });
  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
    const current = data;
    if (!action || !current || busy) return;
    const pr = current.pullRequest;
    if (action === "refresh-review") void run(() => reload(pr));
    if (action === "approve")
      void run(async () => {
        toolData(await bridge.callTool("github_pr_approve", { ...target(pr), headSha: pr.headSha }));
        await reload(pr);
      });
    if (action === "dispatch")
      void run(async () => {
        await bridge.sendMessage(reviewMessage(current));
        notice = "Sent to the agent.";
      });
  });

  return {
    show(next: ReviewData) {
      data = next;
      error = undefined;
      draw();
    },
    fail(failure: string) {
      error = failure;
      draw();
    },
    load: (pr: PullRequestInfo) => run(() => reload(pr)),
  };
}
