# T3 Code GitHub plugin

Pull request checks, review and waits for T3 Code threads. The plugin owns GitHub authentication and calls the GitHub REST API itself. T3 gets bounded check snapshots and MCP Apps views.

The plugin is an MCP server (`src/mcp.ts`, stdio) described by a v2 manifest (`t3-plugin.json`). The managed-app runtime and plugin RPC from 0.1.0 were removed in T3CODE-75. T3 builds that only load v1 manifests cannot load this version.

## MCP server

The server is built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). Views are MCP Apps: `ui://` HTML resources with the `text/html;profile=mcp-app` MIME type.

Every tool takes `repository` (`owner/name`) and `pullRequest`. Instead, you can pass `cwd`, the path of a local checkout: the server reads its GitHub remote and uses the current branch's pull request.

- `github_pr_checks` lists check runs and commit statuses on the head commit, with a summary, and renders `ui://github/checks.html`.
- `github_pr_review` shows the review workflow (check evidence, whether you approved the current head, next step) and renders `ui://github/pr-review.html`.
- `github_pr_approve` submits an APPROVE review on GitHub. Only the review view can call it (`_meta.ui.visibility: ["app"]`), and only for the head commit you reviewed.
- `github_pr_waits` evaluates `checks_settled`, `new_review_activity` (after `since`) and `pull_request_closed` against GitHub right now, and renders `ui://github/waits.html`. To wait, poll it.

After you approve, the review view's "Send to agent" posts a summary of the review into the thread.

### Panels

Both panels are thread-scoped. They use the thread's checkout (`hostContext.t3.cwd`) and follow thread switches. If the thread has no GitHub checkout, you can enter a repository and pull request number by hand.

- **Pull request checks** (`github-checks`) refreshes while checks are running. Use **Review** to open the review inline.
- **GitHub waits** (`github-waits`) re-checks the conditions every `GITHUB_POLL_SECONDS`. It counts new review activity from when the panel opened.

### Configuration

| Env var | Notes |
|---|---|
| `GITHUB_TOKEN` | Secret. Needs read access to pull requests, checks and commit statuses. Approving also needs pull request write access. |
| `GITHUB_API_URL` | Default `https://api.github.com`. For GitHub Enterprise Server, use `https://<host>/api/v3`. |
| `GITHUB_POLL_SECONDS` | 15–3600, default 30. |

Without a token, the server still starts, and each tool call explains what is missing.

### Run it

```sh
bun install
bun test                 # domain, MCP client, view DOM, AppBridge interop and install tests
bun run typecheck
GITHUB_TOKEN=... bun run inspect   # the official MCP Inspector (Apps tab)
```

Install this directory with T3’s plugin installer after running `bun install --frozen-lockfile`. Then set `GITHUB_TOKEN` on the connected server. Web, desktop and mobile can open the panels; mobile uses the server's installation.

See `docs/manifest-v2.md` for the v1 → v2 mapping, the removed v1 features, and the open questions.
