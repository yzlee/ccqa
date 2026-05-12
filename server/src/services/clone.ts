/**
 * Set up the source code each project's runs operate on. Two modes:
 *
 *  - `kind === "git"`: shallow-clone into the project's data dir.
 *  - `kind === "local"`: trust an existing checkout at the given path.
 *    No copy is made — we just record the path. The coder is locked
 *    to read-only by `disallowedTools` upstream, so reading from the
 *    user's actual workspace is safe.
 *
 * Either way the cloned tree is read-only territory for the coders.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import simpleGit from "simple-git";
import type { Repo } from "@ccqa/shared";
import { config } from "../config.js";
import { projects } from "../db/repo.js";

export function projectRepoDir(projectId: string): string {
  return path.join(config.projectsDir, projectId, "repos");
}

/**
 * Pick a directory name for a clone target.
 *
 * For git URLs we use `<owner>__<repo>` (e.g. `cli__cli`) — using only
 * the trailing path component caused collisions when a project pulled
 * multiple repos with the same name (e.g. `github.com/a/foo` and
 * `github.com/b/foo` both → `foo`, second silently overwriting).
 *
 * For local paths and unparseable URLs we fall back to the basename.
 */
function deriveName(input: string): string {
  const cleaned = input.replace(/\.git$/, "");
  // Try to extract owner + repo from common git-URL shapes:
  //   https://github.com/owner/repo[/...]
  //   git@github.com:owner/repo[.git]
  //   ssh://git@host/owner/repo
  const m =
    cleaned.match(/^(?:https?|ssh|git):\/\/[^/]+\/([^/]+)\/([^/]+)/) ||
    cleaned.match(/^git@[^:]+:([^/]+)\/([^/]+)/);
  if (m) {
    const [, owner, repo] = m;
    return sanitize(`${owner}__${repo}`);
  }
  const tail = cleaned.replace(/[\/\\]+$/, "").split(/[\/\\]/).pop() ?? "repo";
  return sanitize(tail);
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_") || "repo";
}

function expandPath(p: string): string {
  if (p.startsWith("file://")) p = p.slice("file://".length);
  if (p.startsWith("~/") || p === "~") {
    p = path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

/** Decide whether a user-supplied `url` looks like a local path. */
export function inferRepoKind(url: string): "git" | "local" {
  if (/^(file:\/\/|\.{1,2}\/|\/|~\/?)/.test(url)) return "local";
  if (/^[a-z]+:\/\//i.test(url)) return "git";   // https:// ssh:// git://
  if (/^git@/i.test(url)) return "git";          // git@github.com:...
  // Bare identifier — try local first if it exists, otherwise treat as git.
  try {
    if (fs.existsSync(expandPath(url))) return "local";
  } catch {}
  return "git";
}

export async function cloneRepos(projectId: string): Promise<Repo[]> {
  const project = projects.get(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const baseDir = projectRepoDir(projectId);
  fs.mkdirSync(baseDir, { recursive: true });

  const updated: Repo[] = [];
  for (const r of project.repos) {
    const kind = r.kind ?? inferRepoKind(r.url);
    if (kind === "local") {
      const localPath = expandPath(r.url);
      try {
        const stat = fs.statSync(localPath);
        if (!stat.isDirectory()) throw new Error(`not a directory: ${localPath}`);
        updated.push({ ...r, kind: "local", localPath, status: "ok" });
      } catch (e: any) {
        updated.push({
          ...r,
          kind: "local",
          localPath,
          status: "error",
          error: e?.message ?? String(e),
        });
      }
      continue;
    }

    // git path
    const name = deriveName(r.url);
    const localPath = path.join(baseDir, name);
    try {
      if (fs.existsSync(path.join(localPath, ".git"))) {
        const git = simpleGit(localPath);
        await git.fetch();
        if (r.ref) await git.checkout(r.ref);
        else await git.pull();
      } else {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        const git = simpleGit();
        const args = ["--depth", "1"];
        if (r.ref) args.push("--branch", r.ref);
        await git.clone(r.url, localPath, args);
      }
      updated.push({ ...r, kind: "git", localPath, status: "ok" });
    } catch (e: any) {
      updated.push({
        ...r,
        kind: "git",
        localPath,
        status: "error",
        error: e?.message ?? String(e),
      });
    }
  }
  projects.update(projectId, { repos: updated });
  return updated;
}
