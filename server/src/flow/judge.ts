/**
 * After a Coder finishes a step, we feed its transcript + the step's
 * success criteria to a "judge" LLM. The judge decides:
 *   - did the step pass?
 *   - what bugs surfaced?
 *   - is each bug blocking (run should stop) or not?
 *
 * No hard rules, no regex, no string matching — per the user's
 * directive, anything an LLM can decide gets decided by an LLM.
 */
import { askJson } from "../llm/anthropic.js";
import type { Flow, FlowNode } from "@ccqa/shared";

export interface BugDraft {
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  blocking: boolean;
  evidence?: string[];
}

export interface JudgeVerdict {
  passed: boolean;
  /** "passed" | "failed" | "skipped" | "blocked" — for the step row. */
  status: "passed" | "failed" | "blocked" | "skipped";
  /** Short human-readable verdict for the UI. */
  reason: string;
  bugs: BugDraft[];
  /** Optional next-step hints the executor can surface. */
  notes?: string;
}

export async function judgeStep(args: {
  flow: Flow;
  node: FlowNode;
  transcript: string;
  finalText: string;
}): Promise<JudgeVerdict> {
  const sys = `You are the CCQA judge.

You will be given a single test step from a larger QA flow, and the
transcript of what the testing agent just did for that step. Decide:

- "passed": true if the step met its success criteria, false otherwise.
- "status": "passed" | "failed" | "blocked" | "skipped". Use "blocked"
  when the agent could not complete the step due to environment / setup
  problems unrelated to the system under test (then bugs may be empty).
- "reason": one or two sentences for the UI ("Caregiver listing was
  visible to recruiter after 2 page-flips; matches expected outcome.")
- "bugs": zero or more bug drafts. Each bug:
    - "title": short
    - "description": specific — what was observed, where (file:line or
      log snippet), and why it matters
    - "severity": low|medium|high|critical
    - "blocking": true if the run should STOP because continuing will
      not produce useful signal (e.g. login broken, repo unreadable);
      false otherwise (a non-blocking bug is recorded and the run
      continues).
    - "evidence": optional list of file paths, urls, log snippets.
- "notes": optional hints for the next step.

Be calibrated. Don't manufacture bugs from a single noisy log line; do
flag clear regressions, hangs, hallucinated tool calls, or wrong-target
behavior. Don't mark cosmetic issues as blocking.`;

  const stepBlock = JSON.stringify(
    {
      title: args.node.title,
      description: args.node.description,
      test_points: args.node.testPoints,
      success_criteria: args.node.successCriteria,
    },
    null,
    2
  );

  const user = `Flow goal: ${args.flow.overallGoal ?? "(none)"}
Expected overall outcome: ${args.flow.expectedOutcome ?? "(none)"}

Step:
${stepBlock}

Agent final message:
---
${args.finalText.slice(-6000)}
---

Selected transcript (most recent ~12k chars):
---
${args.transcript.slice(-12000)}
---

Return the JSON verdict now.`;

  return await askJson<JudgeVerdict>(user, { system: sys, maxTokens: 3000 });
}
