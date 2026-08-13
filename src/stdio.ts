import { readFile } from "node:fs/promises";

type Contribution = { id: string; title: string };
type Manifest = {
  id: string;
  displayName: string;
  contributes?: {
    navigation?: Contribution[];
    panels?: Contribution[];
    workflows?: Contribution[];
  };
};

const manifest = JSON.parse(
  await readFile(new URL("../t3-plugin.json", import.meta.url), "utf8"),
) as Manifest;
const now = () => new Date().toISOString();
const navigation = manifest.contributes?.navigation ?? [];
const panels = manifest.contributes?.panels ?? [];
const workflows = manifest.contributes?.workflows ?? [];

function surface(navigationId?: string) {
  const navigationItem = navigation.find((item) => item.id === navigationId) ?? navigation[0];
  return {
    pluginId: manifest.id,
    navigationId: navigationItem?.id ?? navigationId ?? manifest.id,
    title: navigationItem?.title ?? manifest.displayName,
    refreshedAt: now(),
    cards: [
      {
        kind: "notice",
        id: `${manifest.id}.status`,
        title: "Plugin surface ready",
        message: `${manifest.displayName} is installed and its dedicated surface is available.`,
        status: "neutral",
      },
    ],
  };
}

function panel(panelId?: string) {
  const panelItem = panels.find((item) => item.id === panelId) ?? panels[0];
  return {
    pluginId: manifest.id,
    panelId: panelItem?.id ?? panelId ?? manifest.id,
    title: panelItem?.title ?? manifest.displayName,
    kind: "verification",
    refreshedAt: now(),
    content: {
      kind: "verification",
      status: "idle",
      summary: `${manifest.displayName} panel is connected.`,
      runs: [],
    },
  };
}

function workflow(workflowId?: string) {
  const workflowItem = workflows.find((item) => item.id === workflowId) ?? workflows[0];
  return {
    pluginId: manifest.id,
    workflowId: workflowItem?.id ?? workflowId ?? manifest.id,
    title: workflowItem?.title ?? manifest.displayName,
    currentStage: "inspect",
    refreshedAt: now(),
    steps: [
      {
        id: `${manifest.id}.inspect`,
        stage: "inspect",
        title: "Inspect plugin state",
        state: "active",
        detail: "The plugin runtime is connected and ready for provider-specific work.",
      },
    ],
    actions: [],
  };
}

async function handle(method: string, payload: Record<string, unknown>) {
  if (method === "surface.get") return { ok: true as const, result: surface(typeof payload.navigationId === "string" ? payload.navigationId : undefined) };
  if (method === "panel.get") return { ok: true as const, result: panel(typeof payload.panelId === "string" ? payload.panelId : undefined) };
  if (method === "workflow.get") return { ok: true as const, result: workflow(typeof payload.workflowId === "string" ? payload.workflowId : undefined) };
  if (method === "action.execute") {
    return { ok: true as const, result: { status: "accepted", message: `${manifest.displayName} action accepted by the plugin runtime.` } };
  }
  return { ok: false as const, error: `unsupported plugin RPC method: ${method}` };
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    void (async () => {
      try {
        const request = JSON.parse(line) as {
          requestId: string;
          method: string;
          payload?: Record<string, unknown>;
        };
        const result = await handle(request.method, request.payload ?? {});
        process.stdout.write(
          `${JSON.stringify({ type: "plugin.response", requestId: request.requestId, ...result })}\n`,
        );
      } catch (error) {
        process.stdout.write(
          `${JSON.stringify({
            type: "plugin.response",
            requestId: "unknown",
            ok: false,
            error: error instanceof Error ? error.message : "plugin request failed",
          })}\n`,
        );
      }
    })();
  }
});

