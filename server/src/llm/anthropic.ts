/**
 * "Supervisor" LLM calls (flow generation, judge, dialogue editor,
 * report writer). The Coder adapters drive the testing itself; this
 * module is for everything around that.
 *
 * Two backends, picked at call time:
 *   1. ANTHROPIC_API_KEY set → use the Anthropic SDK directly (cheaper,
 *      faster for short calls, no subprocess overhead).
 *   2. otherwise → spawn `claude -p --bare --output-format json` and
 *      reuse the user's existing `claude` auth. This is the default
 *      because most CCQA users already have `claude` signed in.
 */
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { config } from "../config.js";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: config.anthropicApiKey });
  return _client;
}

export interface AskOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export async function ask(
  user: string,
  opts: AskOptions = {}
): Promise<string> {
  if (config.anthropicApiKey) return askViaSdk(user, opts);
  return askViaClaudeCli(user, opts);
}

async function askViaSdk(user: string, opts: AskOptions): Promise<string> {
  const resp = await client().messages.create({
    model: opts.model ?? config.judgeModel,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.2,
    system: opts.system,
    messages: [{ role: "user", content: user }],
  });
  return resp.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
}

async function askViaClaudeCli(
  user: string,
  opts: AskOptions
): Promise<string> {
  // Note: we deliberately do NOT use --bare here. --bare requires
  // ANTHROPIC_API_KEY and skips OAuth/keychain — but the whole point
  // of the CLI fallback is to reuse the user's existing `claude` auth.
  // To avoid picking up workspace-specific hooks/MCP/skills we run
  // from a neutral cwd (os tmp).
  const args = [
    "-p",
    "--output-format",
    "json",
    "--disallowedTools",
    "Bash,Read,Edit,Write,Grep,Glob,WebFetch,WebSearch,Task,NotebookEdit,TodoWrite",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.system) args.push("--append-system-prompt", opts.system);

  const child = spawn(config.claudeCli ?? "claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    cwd: "/tmp",
  });

  child.stdin.write(user);
  child.stdin.end();

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const code: number = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (c) => resolve(c ?? 0));
  });

  if (code !== 0) {
    throw new Error(
      `claude -p failed (exit ${code}): ${stderr.slice(-1000) || stdout.slice(-1000)}`
    );
  }
  try {
    const obj = JSON.parse(stdout);
    return String(obj.result ?? "");
  } catch {
    return stdout;
  }
}

/**
 * Convenience: ask for JSON. Strips ```json fences, parses, returns.
 */
export async function askJson<T = unknown>(
  user: string,
  opts: AskOptions = {}
): Promise<T> {
  const sys =
    (opts.system ? opts.system + "\n\n" : "") +
    "Respond with a single JSON object, no prose, no commentary, no markdown fences.";
  const raw = await ask(user, { ...opts, system: sys });
  const stripped = stripFences(raw).trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    throw new Error(
      `LLM returned non-JSON. First 400 chars: ${stripped.slice(0, 400)}`
    );
  }
}

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1];
  return s;
}
