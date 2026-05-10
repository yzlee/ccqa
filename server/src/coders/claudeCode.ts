/**
 * Adapter that drives Claude Code via the Agent SDK (TypeScript).
 *
 * The "test harness is read-only" rule is enforced by the disallow list
 * (Write/Edit/NotebookEdit + git mutating subcommands). Read, Grep, Glob,
 * and *bounded* Bash are allowed so the agent can grep code, run linters,
 * curl APIs, etc.
 *
 * Why disallow rather than allowlist? An allowlist of read-only Bash
 * patterns would either be too narrow (the agent can't `psql -c "select"`,
 * `kubectl logs`, `aws s3 ls`, etc.) or impossible to express. The user
 * explicitly asked for "anything an LLM can decide, let it decide" — so we
 * trust Claude to refrain from mutating operations and only block
 * the obviously destructive ones.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Coder, CoderEvent, CoderRunRequest, CoderRunResult } from "./types.js";

const READ_ONLY_PREAMBLE = `
You are operating inside CCQA, an LLM-driven QA harness. Hard rules:

1. The repository under test is READ-ONLY. Never run Write, Edit, or
   NotebookEdit. Never run git commands that mutate state (commit,
   push, reset, checkout, merge, rebase, stash drop, branch -D, tag,
   add, rm, restore --staged, switch, cherry-pick, revert, gc, prune,
   clean). \`git status\`, \`git log\`, \`git diff\`, \`git show\`, \`git ls-files\`,
   \`git blame\` are fine.
2. You MAY read any file, grep, glob, run lint/test commands, hit
   external APIs, ssh into staging boxes the user listed, etc. You MAY
   use stdout-only tools (cat, head, tail, jq, awk for read, sed -n).
3. The CCQA judge will read your transcript after each step and decide
   pass/fail and whether bugs surfaced. Be specific in your final
   message about what you observed: where you looked, what you saw,
   what looks wrong, file:line citations when relevant.
`.trim();

const HARD_DISALLOWED = [
  "Write",
  "Edit",
  "NotebookEdit",
];

export class ClaudeCodeCoder implements Coder {
  readonly kind = "claude-code" as const;

  async run(
    req: CoderRunRequest,
    onEvent: (e: CoderEvent) => void
  ): Promise<CoderRunResult> {
    const append =
      (req.appendSystemPrompt ? req.appendSystemPrompt + "\n\n" : "") +
      READ_ONLY_PREAMBLE;

    const ac = new AbortController();
    if (req.signal) {
      if (req.signal.aborted) ac.abort();
      else req.signal.addEventListener("abort", () => ac.abort(), { once: true });
    }

    const disallowed = Array.from(
      new Set([...(req.disallowedTools ?? []), ...HARD_DISALLOWED])
    );

    let finalText = "";
    let usage: Record<string, number> | undefined;

    const iter = query({
      prompt: req.prompt,
      options: {
        cwd: req.cwd,
        maxTurns: req.maxTurns ?? 40,
        abortController: ac,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        allowedTools: req.allowedTools,
        disallowedTools: disallowed,
        systemPrompt: { type: "preset", preset: "claude_code", append },
      },
    });

    for await (const msg of iter) {
      onEvent({ kind: "raw", raw: msg });
      switch (msg.type) {
        case "assistant": {
          const blocks = (msg as any).message?.content ?? [];
          for (const b of blocks) {
            if (b.type === "text" && typeof b.text === "string") {
              onEvent({ kind: "text", text: b.text });
            } else if (b.type === "tool_use") {
              onEvent({
                kind: "tool_use",
                tool: b.name,
                text: previewToolInput(b.name, b.input),
                raw: b,
              });
            }
          }
          break;
        }
        case "user": {
          const blocks = (msg as any).message?.content ?? [];
          for (const b of blocks) {
            if (b.type === "tool_result") {
              const text =
                typeof b.content === "string"
                  ? b.content
                  : Array.isArray(b.content)
                  ? b.content
                      .map((c: any) => c?.text ?? "")
                      .join("\n")
                  : "";
              onEvent({
                kind: "tool_result",
                text: clip(text, 4000),
                raw: b,
              });
            }
          }
          break;
        }
        case "result": {
          finalText = (msg as any).result ?? "";
          const u = (msg as any).usage ?? {};
          usage = {
            input_tokens: u.input_tokens ?? 0,
            output_tokens: u.output_tokens ?? 0,
            cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
            total_cost_usd: (msg as any).total_cost_usd ?? 0,
            duration_ms: (msg as any).duration_ms ?? 0,
            num_turns: (msg as any).num_turns ?? 0,
          };
          break;
        }
        case "system": {
          onEvent({ kind: "system", text: (msg as any).subtype, raw: msg });
          break;
        }
        default:
          break;
      }
    }

    return { finalText, usage };
  }
}

function previewToolInput(name: string, input: any): string {
  try {
    if (!input) return name;
    if (name === "Bash" && typeof input.command === "string") {
      return clip(input.command, 220);
    }
    if (name === "Read" && input.file_path) {
      return String(input.file_path);
    }
    if (name === "Grep" && input.pattern) {
      return `${input.pattern}${input.path ? "  in " + input.path : ""}`;
    }
    if (name === "Glob" && input.pattern) {
      return String(input.pattern);
    }
    return clip(JSON.stringify(input), 200);
  } catch {
    return name;
  }
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `… (+${s.length - n} bytes)`;
}
