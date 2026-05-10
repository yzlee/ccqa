/**
 * Placeholder Kimi adapter.
 *
 * Moonshot's Kimi-Code CLI is not available everywhere, and its
 * non-interactive surface area is still moving. We expose the same
 * interface so the rest of the system can target Kimi once a stable
 * path appears (CLI subprocess, REST, MCP, etc.).
 *
 * For now this throws at construction time so the user sees a clear
 * error if they explicitly pick Kimi without configuring it.
 */
import type {
  Coder,
  CoderEvent,
  CoderRunRequest,
  CoderRunResult,
} from "./types.js";

export class KimiCoder implements Coder {
  readonly kind = "kimi" as const;
  async run(
    _req: CoderRunRequest,
    _onEvent: (e: CoderEvent) => void
  ): Promise<CoderRunResult> {
    throw new Error(
      "Kimi adapter is not configured yet. Set CCQA_KIMI_CLI and add an adapter implementation."
    );
  }
}
