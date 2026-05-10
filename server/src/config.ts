import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

export const config = {
  dataDir: process.env.CCQA_DATA_DIR ?? path.join(repoRoot, "data"),
  projectsDir:
    process.env.CCQA_PROJECTS_DIR ?? path.join(repoRoot, "data", "projects"),
  runsDir: process.env.CCQA_RUNS_DIR ?? path.join(repoRoot, "data", "runs"),
  dbPath: process.env.CCQA_DB ?? path.join(repoRoot, "data", "db", "ccqa.db"),
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
