import { describe, expect, it } from "bun:test";

import { loadConfig, webHost } from "./config.ts";

describe("config", () => {
  it("defaults to public GitHub and clamps the poll interval", () => {
    expect(loadConfig({})).toEqual({ apiUrl: "https://api.github.com", pollSeconds: 30 });
    expect(loadConfig({ GITHUB_TOKEN: " t ", GITHUB_API_URL: "https://ghe.corp/api/v3/", GITHUB_POLL_SECONDS: "1" })).toEqual({ apiUrl: "https://ghe.corp/api/v3", token: "t", pollSeconds: 15 });
  });

  it("rejects an endpoint that is not an http(s) URL", () => {
    expect(() => loadConfig({ GITHUB_API_URL: "api.github.com" })).toThrow("GITHUB_API_URL must be an http(s) URL");
  });

  it("maps the API endpoint to the host used in git remotes", () => {
    expect(webHost("https://api.github.com")).toBe("github.com");
    expect(webHost("https://ghe.corp/api/v3")).toBe("ghe.corp");
  });
});
