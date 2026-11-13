import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import manifest from "../t3-plugin.json";

it("launches the installed manifest from another directory and serves its panels", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "github-install-"));
  const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  const transport = new StdioClientTransport({
    command: manifest.mcpServer.transport.command,
    args: manifest.mcpServer.transport.args.map((arg) => arg.replaceAll("${pluginRoot}", root)),
    cwd,
    // No GITHUB_TOKEN: the server still starts and reports it per tool call.
    env: { PATH: process.env.PATH ?? "", GITHUB_API_URL: "https://github.invalid/api/v3" },
  });
  const client = new Client({ name: "installation-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(["github_pr_checks", "github_pr_review", "github_pr_approve", "github_pr_waits"]));
    const resources = (await client.listResources()).resources;
    for (const panel of manifest.contributes.panels) {
      expect(resources.some((resource) => resource.uri === panel.resourceUri)).toBe(true);
      const view = await client.readResource({ uri: panel.resourceUri });
      expect(view.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
      expect(view.contents[0]).toHaveProperty("text", expect.stringContaining("ui/initialize"));
    }
    const result = await client.callTool({ name: "github_pr_checks", arguments: { repository: "acme/repo", pullRequest: 1 } });
    expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("GITHUB_TOKEN is not set") }] });
  } finally {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
