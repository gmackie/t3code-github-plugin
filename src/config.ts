// The v1 plugin had no settings. v2 adds these env vars, declared under
// mcpServer.transport.env so T3's Tools registry can collect them and redact
// the token.
export type GitHubConfig = {
  readonly apiUrl: string;
  readonly token?: string;
  readonly pollSeconds: number;
};

export const DEFAULT_API_URL = "https://api.github.com";
export const POLL_SECONDS = { default: 30, min: 15, max: 3600 } as const;

export function loadConfig(env: Record<string, string | undefined> = process.env): GitHubConfig {
  const token = env.GITHUB_TOKEN?.trim();
  const apiUrl = (env.GITHUB_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");
  if (!URL.canParse(apiUrl) || !/^https?:$/.test(new URL(apiUrl).protocol)) throw new Error(`GITHUB_API_URL must be an http(s) URL, e.g. ${DEFAULT_API_URL}`);
  return {
    apiUrl,
    ...(token ? { token } : {}),
    pollSeconds: pollSeconds(env.GITHUB_POLL_SECONDS),
  };
}

function pollSeconds(raw: string | undefined): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return POLL_SECONDS.default;
  return Math.min(POLL_SECONDS.max, Math.max(POLL_SECONDS.min, Math.round(value)));
}

// The host that appears in git remotes for this API: github.com for the public
// API, the API's own host for GitHub Enterprise Server (https://ghe/api/v3).
export function webHost(apiUrl: string): string {
  const host = new URL(apiUrl).host;
  return host === "api.github.com" ? "github.com" : host;
}
