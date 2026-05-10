import type { Coder, CoderKind } from "./types.js";
import { ClaudeCodeCoder } from "./claudeCode.js";
import { CodexCoder } from "./codex.js";
import { KimiCoder } from "./kimi.js";

export function getCoder(kind: CoderKind): Coder {
  switch (kind) {
    case "claude-code":
      return new ClaudeCodeCoder();
    case "codex":
      return new CodexCoder();
    case "kimi":
      return new KimiCoder();
    default: {
      const _x: never = kind;
      throw new Error(`unknown coder: ${_x}`);
    }
  }
}

export type { Coder, CoderEvent, CoderRunRequest, CoderRunResult, CoderKind } from "./types.js";
