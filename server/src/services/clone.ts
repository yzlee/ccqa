/**
 * Shallow-clone the repos a project depends on into the project's
 * data directory. The cloned tree is read-only territory for the
 * coders — we never write to it from the test runner.
 */
import path from "node:path";
import fs from "node:fs";
import simpleGit from "simple-git";
import type { Repo } from "@ccqa/shared";
import { config } from "../config.js";
import { projects } from "../db/repo.js";

export function projectRepoDir(projectId: string): string {
  return path.join(config.projectsDir, projectId, "repos");
}

function deriveName(url: string): string {
  const tail = url.split("/").pop() ?? "repo";
  return tail.replace(/\.git$/, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "repo";
}

export async function cloneRepos(projectId: string): Promise<Repo[]> {
  const project = projects.get(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const baseDir = projectRepoDir(projectId);
  fs.mkdirSync(baseDir, { recursive: true });

  const updated: Repo[] = [];
  for (const r of project.repos) {
    const name = deriveName(r.url);
    const localPath = path.join(baseDir, name);
    try {
      if (fs.existsSync(path.join(localPath, ".git"))) {
        const git = simpleGit(localPath);
        await git.fetch();
        if (r.ref) {
          await git.checkout(r.ref);
        } else {
          await git.pull();
        }
        updated.push({ ...r, localPath, status: "ok" });
      } else {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        const git = simpleGit();
        const args = ["--depth", "1"];
        if (r.ref) args.push("--branch", r.ref);
        await git.clone(r.url, localPath, args);
        updated.push({ ...r, localPath, status: "ok" });
      }
    } catch (e: any) {
      updated.push({
        ...r,
        localPath,
        status: "error",
        error: e?.message ?? String(e),
      });
    }
  }
  projects.update(projectId, { repos: updated });
  return updated;
}
