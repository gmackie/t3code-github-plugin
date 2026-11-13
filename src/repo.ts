import { isAbsolute } from "node:path";

import { isRepository } from "./github.ts";

// Reads a local checkout so thread panels can find "this thread's pull
// request" from hostContext.t3.cwd. Read-only git commands only.
export type Git = (cwd: string, args: readonly string[]) => Promise<string>;

export const runGit: Git = async (cwd, args) => {
  const child = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const timer = setTimeout(() => child.kill(), 5_000);
  try {
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0) throw new Error(`git ${args[0]} failed in ${cwd}`);
    return stdout.trim();
  } finally {
    clearTimeout(timer);
  }
};

// git@github.com:o/r.git, ssh://git@github.com/o/r.git, https://github.com/o/r(.git)
export function parseRemote(url: string, host: string): string | undefined {
  const match =
    /^(?:[\w.-]+@)?([^:/\s]+):(?!\/)([^\s]+?)(?:\.git)?\/?$/.exec(url) ??
    /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/([^\s]+?)(?:\.git)?\/?$/.exec(url);
  if (!match) return undefined;
  const [, remoteHost, path] = match;
  if (remoteHost?.toLowerCase() !== host.toLowerCase()) return undefined;
  return path && isRepository(path) ? path : undefined;
}

export async function localCheckout(git: Git, cwd: string, host: string): Promise<{ repository: string; branch: string }> {
  if (!isAbsolute(cwd)) throw new Error("cwd must be an absolute path");
  let remotes: string;
  try {
    remotes = await git(cwd, ["remote", "-v"]);
  } catch {
    throw new Error(`${cwd} is not a git checkout`);
  }
  // Prefer origin, then any other remote that points at this GitHub host.
  const urls = remotes
    .split("\n")
    .map((line) => line.split(/\s+/))
    .sort(([a], [b]) => Number(b === "origin") - Number(a === "origin"))
    .map(([, url]) => url ?? "");
  const repository = urls.map((url) => parseRemote(url, host)).find(Boolean);
  if (!repository) throw new Error(`${cwd} has no ${host} remote; pass repository and pullRequest instead`);
  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") throw new Error(`${cwd} is on a detached HEAD; pass pullRequest instead`);
  return { repository, branch };
}
