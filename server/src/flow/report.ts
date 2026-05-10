/**
 * Generate the final test report once a run completes (or is stopped).
 * The report is markdown. Like everything else here, the LLM writes it
 * — we just feed it the structured run state.
 */
import { ask } from "../llm/anthropic.js";
import type { Bug, Flow, Run, RunStep } from "@ccqa/shared";

export async function writeReport(args: {
  run: Run;
  flow: Flow;
  steps: RunStep[];
  bugs: Bug[];
  /** Best-effort transcript tail for context, optional. */
  transcriptTail?: string;
}): Promise<string> {
  const sys = `You are CCQA's report writer. Produce a markdown test
report for the user. Sections:

1. **Summary** (3-5 lines): overall verdict, was the goal achieved,
   how many steps passed/failed, how many bugs (split blocking vs not).
2. **Step results**: a table or bulleted list — step title, status,
   one-line judgement.
3. **Bugs** (if any): grouped by severity, each with title, where it
   surfaced, why it matters, and (when available) a concrete repro hint.
4. **Recommendations**: short actionable next steps for the engineer.

Be specific. Cite step titles by name. Don't invent details that aren't
in the data. If the run was cancelled or hit an error, say so plainly.`;

  const data = {
    run: {
      id: args.run.id,
      status: args.run.status,
      coder: args.run.coder,
      started_at: args.run.startedAt,
      finished_at: args.run.finishedAt,
      usage: args.run.usage,
    },
    flow: {
      goal: args.flow.overallGoal,
      expected_outcome: args.flow.expectedOutcome,
    },
    steps: args.steps.map((s) => ({
      title: s.title,
      status: s.status,
      judgement: s.judgement,
    })),
    bugs: args.bugs.map((b) => ({
      title: b.title,
      severity: b.severity,
      blocking: b.blocking,
      description: b.description,
      evidence: b.evidence,
    })),
  };

  const user = `Run data:
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

${args.transcriptTail ? `Transcript tail (latest):\n---\n${args.transcriptTail.slice(-6000)}\n---\n\n` : ""}Write the markdown report now.`;

  return await ask(user, { system: sys, maxTokens: 4000 });
}
