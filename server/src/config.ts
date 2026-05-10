import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where to put SQLite, cloned repos, and run transcripts.
 *
 * Three resolution rules, first match wins:
 *   1. CCQA_DATA_DIR env var — explicit override.
 *   2. Workspace dev: when this file lives under a checkout that has
 *      a sibling `data/` directory at the repo root, use that. This
 *      keeps `npm run dev:server` writing into the repo as before.
 *   3. Otherwise (installed via npm): use `${cwd}/.ccqa/`. Per-project
 *      data, no risk of `npm install` wiping it.
 */
function defaultDataDir(): string {
  if (process.env.CCQA_DATA_DIR) return process.env.CCQA_DATA_DIR;
  // Walk up from this module looking for a sibling `data/` dir that is
  // owned by the workspace (i.e. accompanies a `package.json` at the
  // same level). This catches both src/ (dev) and dist/ (`npm run build`)
  // layouts inside the monorepo without false-positive matches in
  // node_modules-installed copies.
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "data");
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(candidate) && fs.existsSync(pkg)) {
      // Don't accept if we're sitting inside someone's node_modules.
      if (!dir.includes(`${path.sep}node_modules${path.sep}`)) {
        return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), ".ccqa");
}

const dataDir = defaultDataDir();

export const config = {
  dataDir,
  projectsDir:
    process.env.CCQA_PROJECTS_DIR ?? path.join(dataDir, "projects"),
  runsDir: process.env.CCQA_RUNS_DIR ?? path.join(dataDir, "runs"),
  dbPath: process.env.CCQA_DB ?? path.join(dataDir, "db", "ccqa.db"),
  port: Number(process.env.CCQA_PORT ?? 4317),
  host: process.env.CCQA_HOST ?? "127.0.0.1",
  /** Default coder when a project doesn't override. */
  defaultCoder:
    (process.env.CCQA_DEFAULT_CODER as
      | "claude-code"
      | "codex"
      | "kimi"
      | undefined) ?? "claude-code",
  /**
   * Anthropic API key for the small "judge" / "flow generator" calls.
   * The Claude Code coder itself uses whatever auth `claude` is logged in with.
   */
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  /** Model used by the judge / generator / report writer. */
  judgeModel: process.env.CCQA_JUDGE_MODEL ?? "claude-sonnet-4-6",
  /** Path to the `claude` CLI used by the agent SDK (auto-detected if unset). */
  claudeCli: process.env.CCQA_CLAUDE_CLI,
  /** Path to the `codex` CLI. */
  codexCli: process.env.CCQA_CODEX_CLI ?? "codex",
};
