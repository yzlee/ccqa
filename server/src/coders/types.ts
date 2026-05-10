/**
 * Common interface for the coders we drive. Each adapter wraps an
 * underlying CLI / SDK (Claude Code, Codex, Kimi, ...) and exposes a
 * uniform streaming API.
 *
 * Design note: every emission is a free-form `CoderEvent`. We *don't*
 * try to unify event taxonomies across vendors — the executor and
 * the judge LLM consume them as opaque transcript. This keeps adapter
 * code thin and lets us add new coders without churning the executor.
 */

export type CoderKind = "claude-code" | "codex" | "kimi";

export interface CoderEvent {
  /** A best-effort kind like "text", "tool_use", "tool_result", "system". */
  kind: string;
  /** Human-readable text, if any. */
  text?: string;
  /** Tool name when kind === "tool_use". */
  tool?: string;
  /** Free-form payload from the underlying SDK, for debug/transcript. */
  raw?: unknown;
}

export interface CoderRunRequest {
  /** Where the coder is allowed to look. */
  cwd: string;
  /** The user-facing instruction (single turn). */
  prompt: string;
  /**
   * Override the system prompt. Most adapters append rather than replace.
   * Use this to inject the project's "this is a read-only test harness"
   * preamble.
   */
  appendSystemPrompt?: string;
  /**
   * Allowed tools (allowlist semantics). When omitted, the adapter
   * picks a safe default (read+grep+ls+cat-style only).
   */
  allowedTools?: string[];
  /** Tools to explicitly block even if otherwise auto-approved. */
  disallowedTools?: string[];
  /**
   * Per-call abort signal. The executor uses this to cancel a step
   * mid-flight when the user clicks Stop.
   */
  signal?: AbortSignal;
  /** Soft cap on turns (each adapter maps to its own knob). */
  maxTurns?: number;
}

export interface CoderRunResult {
  /** Final assistant text. */
  finalText: string;
  /** Whatever usage stats the adapter could collect. */
  usage?: Record<string, number>;
}

export interface Coder {
  readonly kind: CoderKind;
  /**
   * Run a single instruction. Yields events as they happen (so callers
   * can stream to the UI), and returns a summary once finished.
   */
  run(
    req: CoderRunRequest,
    onEvent: (e: CoderEvent) => void
  ): Promise<CoderRunResult>;
}
