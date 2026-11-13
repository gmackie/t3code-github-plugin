#!/usr/bin/env bun
// Stdio entry point for the MCP-native GitHub plugin (manifest v2 `mcpServer`).
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadConfig, webHost } from "./config.ts";
import { createGitHubClient } from "./github.ts";
import { runGit } from "./repo.ts";
import { createGitHubMcpServer } from "./server.ts";

// A missing token is not fatal here: tools report it, so the server still
// lists its tools and views in Settings → Tools.
const config = loadConfig();
const server = createGitHubMcpServer({
  client: createGitHubClient({ apiUrl: config.apiUrl, ...(config.token ? { token: config.token } : {}) }),
  git: runGit,
  host: webHost(config.apiUrl),
  pollSeconds: config.pollSeconds,
});
await server.connect(new StdioServerTransport());
