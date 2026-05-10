/**
 * Build a short, LLM-readable summary of a project's prior runs so the
 * coder agent walks into a new run with context: "last time step X
 * blocked because of Y, this bug surfaced and wasn't fixed yet, etc."
 *
 * We deliberately keep this terse — both to control token cost and to
 * avoid biasing the agent toward replicating past judgements. Recent
 * runs only, capped lines, no full transcripts.
 */
import { bugs, runs, runSteps } from "../db/repo.js";

export interface PastRunsSummary {
  /** True if there is any prior run we could summarize. */
  hasHistory: boolean;
  /** Markdown block ready to paste into the system preamble. */
  text: string;
}

const MAX_RUNS = 3;

export function summarizePastRuns(
  projectId: string,
  excludeRunId?: string
): PastRunsSummary {
  const all = runs.listByProject(projectId).filter(
    (r) => r.id !== excludeRunId && r.status !== "queued" && r.status !== "running"
  );
  if (!all.length) return { hasHistory: false, text: "" };

  const recent = all.slice(0, MAX_RUNS);
  const lines: string[] = [];
  for (const r of recent) {
    const steps = runSteps.listByRun(r.id);
    const bs = bugs.listByRun(r.id);
    const passed = steps.filter((s) => s.status === "passed").length;
    const failed = steps.filter((s) => s.status === "failed").length;
    const blocked = steps.filter((s) => s.status === "blocked").length;
    const blockingBugs = bs.filter((b) => b.blocking).length;

    const when = r.finishedAt ?? r.startedAt;
    lines.push(
      `- ${r.id.slice(0, 8)} (${shortAgo(when)}, ${r.status}): ` +
        `${passed} passed, ${failed} failed, ${blocked} blocked; ` +
        `${bs.length} bug${bs.length === 1 ? "" : "s"} (${blockingBugs} blocking).`
    );
    // Pull a couple of the most recent or most severe bugs forward —
    // those are the things most worth remembering for the next run.
    const standout = bs
      .sort(
        (a, b) =>
          severityRank(b.severity) - severityRank(a.severity) ||
          Number(b.blocking) - Number(a.blocking)
      )
      .slice(0, 2);
    for (const b of standout) {
      const tag = b.blocking ? "blocking " : "";
      lines.push(
        `    · ${tag}[${b.severity}] ${b.title}` +
          (b.description
            ? ` — ${b.description.slice(0, 140).replace(/\s+/g, " ")}`
            : "")
      );
    }
  }

  const text = `## Context from this project's past runs (most recent first, ${recent.length} of ${all.length})

${lines.join("\n")}

Use this only as background. Do NOT assume past bugs are still present
or already fixed — verify in the current code, then either reproduce
them or note that they look resolved. Do NOT assume past pass/fail
verdicts apply to this run.`;

  return { hasHistory: true, text };
}

function severityRank(s: string): number {
  return ["low", "medium", "high", "critical"].indexOf(s);
}

function shortAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const m = Math.round(ms / 60000);
  if (m < 1) return "<1m ago";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
