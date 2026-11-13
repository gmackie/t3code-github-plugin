import { describe, expect, it } from "bun:test";

import { localCheckout, parseRemote } from "./repo.ts";

describe("local checkout", () => {
  it("parses GitHub remotes in their usual forms", () => {
    expect(parseRemote("git@github.com:acme/repo.git", "github.com")).toBe("acme/repo");
    expect(parseRemote("https://github.com/acme/repo", "github.com")).toBe("acme/repo");
    expect(parseRemote("https://token@github.com/acme/repo.git/", "github.com")).toBe("acme/repo");
    expect(parseRemote("ssh://git@github.com:22/acme/repo.git", "github.com")).toBe("acme/repo");
    expect(parseRemote("git@ghe.corp:team/svc.git", "ghe.corp")).toBe("team/svc");
    expect(parseRemote("https://gitlab.com/acme/repo.git", "github.com")).toBeUndefined();
    expect(parseRemote("https://github.com/acme/repo/extra", "github.com")).toBeUndefined();
  });

  it("prefers origin and rejects relative paths and detached heads", async () => {
    const git = async (_cwd: string, args: readonly string[]) =>
      args[0] === "remote" ? "fork\thttps://github.com/me/repo (fetch)\norigin\thttps://github.com/acme/repo (fetch)" : "HEAD";
    await expect(localCheckout(git, "relative/path", "github.com")).rejects.toThrow("absolute");
    await expect(localCheckout(git, "/repo", "github.com")).rejects.toThrow("detached HEAD");
    const onBranch = async (_cwd: string, args: readonly string[]) => (args[0] === "remote" ? "fork\thttps://github.com/me/repo (fetch)\norigin\thttps://github.com/acme/repo (fetch)" : "main");
    expect(await localCheckout(onBranch, "/repo", "github.com")).toEqual({ repository: "acme/repo", branch: "main" });
  });
});

describe("runGit", () => {
  it("reads a real checkout", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { runGit } = await import("./repo.ts");
    const dir = await mkdtemp(join(tmpdir(), "github-plugin-git-"));
    try {
      const sh = (...args: string[]) => Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "ignore", stderr: "ignore" });
      sh("init", "-q", "-b", "feature/x");
      sh("remote", "add", "origin", "git@github.com:acme/repo.git");
      sh("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
      expect(await localCheckout(runGit, dir, "github.com")).toEqual({ repository: "acme/repo", branch: "feature/x" });
      await expect(localCheckout(runGit, join(dir, "missing"), "github.com")).rejects.toThrow("is not a git checkout");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
