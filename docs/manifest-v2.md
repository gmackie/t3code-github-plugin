# GitHub manifest v2 (T3CODE-75)

`t3-plugin.json` follows the MCP-native plugin design from T3CODE-74, the same shape as the Bob plugin (`gmackie/t3code-bob-plugin` v0.2.1). T3 loads it into its server-owned MCP registry.

## Shape

- `mcpServer` reuses `McpServerConfig` and `McpServerVariable` from Settings → Tools (`packages/contracts/src/agentTools.ts`):
  - `name`: `github`.
  - `transport`: stdio, `bun ${pluginRoot}/src/mcp.ts`, with `env` as `McpServerVariable[]`.
  - `GITHUB_TOKEN` is `sensitive`. `GITHUB_API_URL` defaults to `https://api.github.com`. `GITHUB_POLL_SECONDS` defaults to 30.
- `contributes.panels[]`, both thread-scoped. Each finds the thread's pull request from `hostContext.t3.cwd` (the checkout's GitHub remote and current branch) and follows `host-context-changed`:
  - `github-checks` renders `ui://github/checks.html`: checks on the head commit, with the review inline.
  - `github-waits` renders `ui://github/waits.html`: the three wait conditions, re-checked every `GITHUB_POLL_SECONDS`.
- `contributes.commands[]` open those panels.
- `t3Tools` is `[]` (see below).

The review workflow needs no manifest entry: `github_pr_review` declares `_meta.ui.resourceUri: ui://github/pr-review.html` and renders inline wherever the host shows tool calls as MCP Apps.

## v1 → v2 mapping

The v1 manifest is at commit 6415faa.

| v1 | v2 |
|---|---|
| `runtime` (managed-app, `bun src/stdio.ts`, plugin RPC) | `mcpServer.transport` (stdio, `bun ${pluginRoot}/src/mcp.ts`) |
| `panels[github.checks]` (thread.sidePanel) | `panels[github-checks]`, `scope: thread`; tool `github_pr_checks` |
| `panels[github.waitpoints]` (thread.main) | `panels[github-waits]`, `scope: thread`; tool `github_pr_waits` |
| `workflows[github.pull-request-review]` | Tool `github_pr_review` with its own `ui://github/pr-review.html` view |
| Workflow action `approve` | Tool `github_pr_approve`, `visibility: ["app"]`: submits an APPROVE review on GitHub |
| Workflow stage `execute` (dispatch the approved response) | The view's "Send to agent" posts the review into the thread with `ui/message` |
| `hooks: thread.created, turn.settled` | Dropped (see below) |
| `capabilities.events.read` | Dropped with the hooks |
| `capabilities.threads.read`, `threads.dispatch` | `t3Tools: []`. If the plugin ever needs T3, the upper limit is `t3_thread_read` (threads.read) and `t3_thread_send` (threads.dispatch). |
| `capabilities.network.connect` (`api.github.com`) | Dropped: the server process calls `GITHUB_API_URL`, views go through `tools/call` |
| `capabilities.ui.embed` | Implied by `panels` |
| (no settings in v1) | `mcpServer.transport.env`: `GITHUB_TOKEN`, `GITHUB_API_URL`, `GITHUB_POLL_SECONDS` |

## Server rules

- **Visibility.**
  - `github_pr_checks`, `github_pr_review` and `github_pr_waits` are `["model", "app"]`: agents read them, and the views call them.
  - `github_pr_approve` is `["app"]`, so only a human in the review view can approve. It refuses a closed pull request, and refuses when the head moved since the review was loaded.
- **No T3 token needed.** Only the pool copy gets `T3_MCP_URL`/`T3_MCP_TOKEN`. The plugin never calls T3, so every copy behaves the same.
- **Stateless processes.** Nothing is kept in memory or on disk. "Approved" is read back from GitHub: your latest non-comment review is APPROVED on the current head commit. So an approval made from the pool copy is visible to every session copy.
- **Network.** Every GitHub call has a 15 s timeout. 5xx responses become `GitHub is temporarily unavailable (<status>)`; response bodies and URLs never reach results or views. A missing `GITHUB_TOKEN` is reported per tool call, so the server still starts and lists its tools.
- **Local git.** With `cwd`, the server runs read-only `git remote -v` and `git rev-parse --abbrev-ref HEAD` there (5 s timeout). It prefers `origin`, and then finds the branch's pull request (open first) in that repository. Pull requests from forks need `repository` and `pullRequest`.

## Removed v1 features

- **Hooks (`thread.created`, `turn.settled`) and durable waitpoints.** v1 declared these hooks to poll checks after each turn and to deliver GitHub waitpoints (`checks_settled`, `new_review_activity`, `pull_request_closed`, with expiry) into a thread through `threads.dispatch`. The v1 runtime never implemented them: its stdio handler returned a placeholder. v2 has no hooks or background delivery. The closest honest equivalent is `github_pr_waits`, which evaluates the same three conditions against GitHub on demand. The waits panel re-checks them every `GITHUB_POLL_SECONDS` while it is visible, and an agent can poll the tool. Nothing is delivered into a thread unprompted, and waits do not expire, because nothing is stored.
- **Thread reads.** v1 asked for `threads.read`, but nothing used it. The thread's checkout now comes from `hostContext.t3.cwd`, or from the agent passing `cwd`.

## Open questions

1. **Fork pull requests.** Branch lookup uses `owner:branch` on the checkout's own repository. A checkout of a fork whose pull request targets upstream needs `repository` and `pullRequest`.
2. **GitHub App tokens.** Installation tokens cannot read `/user`. The review still loads, but cannot tell whether you have approved it. Approving still works if the token has pull request write access.
