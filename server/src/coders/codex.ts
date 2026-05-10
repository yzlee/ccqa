/**
 * Adapter that drives OpenAI Codex via the `codex exec --json` CLI.
 *
 * We deliberately use the CLI rather than the TS SDK so we work without
 * the unstable Python app-server. JSONL events are streamed and mapped
 * to our `CoderEvent` shape. Sandbox is forced to `read-only` because
 * CCQA must never mutate the project under test.
 */
import { spawn } from "node:child_process";
import readline from "node:readline";
import { config } from "../config.js";
import type {
  Coder,
  CoderEvent,
  CoderRunRequest,
  CoderRunResult,
} from "./types.js";

const READ_ONLY_PREAMBLE = `
You are running inside CCQA, an LLM-driven QA harness. The repository
under test is READ-ONLY. Never modify files. Read, grep, run linters,
hit APIs, ssh, etc. are fine. After investigating, summarize precisely
what you observed (file:line citations preferred) — a separate judge
will read your transcript to decide pass/fail.
`.trim();

export class CodexCoder implements Coder {
  readonly kind = "codex" as const;

  async run(
    req: CoderRunRequest,
    onEvent: (e: CoderEvent) => void
  ): Promise<CoderRunResult> {
    const cliPath = config.codexCli;
    const promptWithPreamble =
      (req.appendSystemPrompt ? req.appendSystemPrompt + "\n\n" : "") +
      READ_ONLY_PREAMBLE +
      "\n\n---\n\n" +
      req.prompt;

    const args = [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--cd",
      req.cwd,
    ];

    const child = spawn(cliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    if (req.signal) {
      const onAbort = () => {
        try {
          child.kill("SIGTERM");
        } catch {}
      };
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdin.write(promptWithPreamble);
    child.stdin.end();

    let finalText = "";
    let usage: Record<string, number> | undefined;

    const rlOut = readline.createInterface({ input: child.stdout });
    rlOut.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        onEvent({ kind: "text", text: trimmed });
        return;
      }
      onEvent({ kind: "raw", raw: obj });
      const t = obj.type ?? obj.event ?? "";
      if (t.includes("agent.message") || t === "item.message") {
        const text = obj.text ?? obj.message ?? "";
        if (text) {
          finalText += text + "\n";
          onEvent({ kind: "text", text });
        }
      } else if (t.includes("tool")) {
        onEvent({
          kind: "tool_use",
          tool: obj.tool ?? obj.name,
          text: obj.command ?? obj.input ?? "",
          raw: obj,
        });
      } else if (t === "turn.completed") {
        const u = obj.usage ?? {};
        usage = {
          input_tokens: u.input_tokens ?? 0,
          output_tokens: u.output_tokens ?? 0,
        };
      }
    });

    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const exitCode: number = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 0));
    });

    if (exitCode !== 0 && !finalText) {
      finalText = `(codex exited ${exitCode})\n${stderr.slice(-2000)}`;
    }
    return { finalText: finalText.trim(), usage };
  }
}
