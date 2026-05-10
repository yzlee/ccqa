/**
 * Execute a Flow: walk nodes in topological order, ask the chosen
 * Coder to perform each step, judge the output via the LLM, persist
 * events / steps / bugs, and finally produce a report.
 *
 * Decisions delegated to LLMs (per user requirement):
 *   - "did this step pass" — judge.ts
 *   - "is this bug blocking" — judge.ts
 *   - "which next node to take when multiple branches exist" —
 *     pickNextBranch() asks the judge LLM with the branch conditions
 *
 * Decisions kept hard-coded:
 *   - graph topology / ordering (runtime mechanics, not signal)
 *   - timeouts / step retries (none; if needed the user can rerun)
 */
import { nanoid } from "nanoid";
import path from "node:path";
import fs from "node:fs";
import type {
  Flow,
  FlowEdge,
  FlowNode,
  Project,
  Run,
  RunEvent,
} from "@ccqa/shared";
import { config } from "../config.js";
import { bugs, events, flows, projects, runSteps, runs } from "../db/repo.js";
import { getCoder } from "../coders/index.js";
import { askJson, ask } from "../llm/anthropic.js";
import { judgeStep } from "./judge.js";
import { writeReport } from "./report.js";
import { summarizePastRuns } from "./history.js";
import { publish } from "../services/eventBus.js";

const activeRuns = new Map<string, AbortController>();

export function cancelRun(runId: string): boolean {
  const ac = activeRuns.get(runId);
  if (!ac) return false;
  ac.abort();
  return true;
}

export async function executeRun(runId: string): Promise<void> {
  const run = runs.get(runId);
  if (!run) throw new Error(`run ${runId} not found`);
  const project = projects.get(run.projectId);
  if (!project) throw new Error(`project ${run.projectId} not found`);
  const flow = flows.get(project.id);

  const ac = new AbortController();
  activeRuns.set(runId, ac);

  const transcriptPath = path.join(
    config.runsDir,
    runId,
    "transcript.log"
  );
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  const transcript = fs.createWriteStream(transcriptPath, { flags: "a" });

  const emit = (
    type: string,
    payload: Record<string, unknown>,
    stepId?: string
  ) => {
    const e: Omit<RunEvent, "id"> = {
      runId,
      stepId,
      ts: new Date().toISOString(),
      type,
      payload,
    };
    const stored = events.add(e);
    publish(runId, stored);
    transcript.write(
      `[${stored.ts}] ${type} ${JSON.stringify(payload).slice(0, 800)}\n`
    );
  };

  try {
    runs.update(runId, { status: "running" });
    emit("run.started", {
      project: { id: project.id, name: project.name },
      coder: run.coder,
    });

    if (flow.nodes.length === 0) {
      throw new Error(
        "Flow has no nodes. Generate the flow before starting a run."
      );
    }

    // Walk linear-by-default, branch decisions deferred to the LLM.
    const order = topoOrder(flow);
    const cwd = projectCwd(project);
    const history = summarizePastRuns(project.id, runId);
    if (history.hasHistory) {
      emit("run.history_loaded", { summary: history.text });
    }

    let blockingBug = false;
    for (const node of order) {
      if (ac.signal.aborted) break;
      if (node.kind === "start" || node.kind === "end") {
        emit("step.skipped", { id: node.id, title: node.title }, node.id);
        continue;
      }

      const step = runSteps.create({
        runId,
        nodeId: node.id,
        title: node.title,
        status: "running",
        startedAt: new Date().toISOString(),
      });
      emit(
        "step.started",
        { id: step.id, nodeId: node.id, title: node.title },
        step.id
      );

      const coder = getCoder(run.coder);
      const collected: string[] = [];
      const onEvent = (e: any) => {
        if (e.kind === "text") {
          collected.push(`AGENT: ${e.text}`);
          emit("agent.text", { text: e.text }, step.id);
        } else if (e.kind === "tool_use") {
          collected.push(`TOOL_USE ${e.tool}: ${e.text ?? ""}`);
          emit(
            "agent.tool_use",
            { tool: e.tool, preview: e.text },
            step.id
          );
        } else if (e.kind === "tool_result") {
          collected.push(`TOOL_RESULT: ${e.text ?? ""}`);
          emit(
            "agent.tool_result",
            { preview: e.text },
            step.id
          );
        } else if (e.kind === "system") {
          emit("agent.system", { text: e.text }, step.id);
        }
      };

      let finalText = "";
      let coderError: string | undefined;
      try {
        const res = await coder.run(
          {
            cwd,
            prompt: buildStepPrompt(project, flow, node),
            appendSystemPrompt:
              buildSystemPreamble(project, flow) +
              (history.hasHistory ? "\n\n" + history.text : ""),
            signal: ac.signal,
            maxTurns: 60,
          },
          onEvent
        );
        finalText = res.finalText;
      } catch (e: any) {
        coderError = e?.message ?? String(e);
        emit("agent.error", { error: coderError }, step.id);
      }

      // Judge
      let verdict;
      try {
        verdict = await judgeStep({
          flow,
          node,
          transcript: collected.join("\n"),
          finalText,
        });
      } catch (e: any) {
        verdict = {
          passed: false,
          status: "blocked" as const,
          reason: `Judge error: ${e?.message ?? e}`,
          bugs: [],
        };
      }
      if (coderError && verdict.status === "passed") {
        verdict = { ...verdict, passed: false, status: "failed" as const };
      }

      runSteps.update(step.id, {
        status: verdict.status,
        finishedAt: new Date().toISOString(),
        judgement: verdict.reason,
        tail: collected.slice(-20).join("\n").slice(-4000),
      });
      emit(
        "step.finished",
        {
          id: step.id,
          status: verdict.status,
          reason: verdict.reason,
        },
        step.id
      );

      for (const b of verdict.bugs ?? []) {
        const created = bugs.create({
          runId,
          stepId: step.id,
          title: b.title,
          description: b.description,
          severity: b.severity,
          blocking: !!b.blocking,
          evidence: b.evidence,
        });
        emit("bug.found", { ...created }, step.id);
        if (created.blocking) blockingBug = true;
      }

      if (verdict.notes) {
        emit("judge.notes", { notes: verdict.notes }, step.id);
      }

      if (blockingBug) {
        emit("run.aborting", { reason: "blocking bug" });
        break;
      }

      // Branch decision via LLM if there are multiple outgoing edges.
      const next = await pickNextBranch(flow, node, collected.join("\n"));
      if (next && next !== order[order.indexOf(node) + 1]?.id) {
        emit("flow.branch", { from: node.id, to: next });
        // Re-order: insert next node next, skip ones not on the chosen path.
        // Simpler approach: bail to a recursive walk if branch differs.
        // For MVP we just emit the branch and continue topologically;
        // most flows are linear.
      }
    }

    // Report
    const stepsAll = runSteps.listByRun(runId);
    const bugsAll = bugs.listByRun(runId);
    const tail = events.listByRun(runId).slice(-100);
    const status: Run["status"] = ac.signal.aborted
      ? "cancelled"
      : blockingBug
      ? "failed"
      : stepsAll.some((s) => s.status === "failed")
      ? "failed"
      : "passed";

    let report = "";
    try {
      report = await writeReport({
        run: { ...(run as Run), status, finishedAt: new Date().toISOString() },
        flow,
        steps: stepsAll,
        bugs: bugsAll,
        transcriptTail: tail.map((e) => `${e.type} ${JSON.stringify(e.payload)}`).join("\n"),
      });
    } catch (e: any) {
      report = `Report generation failed: ${e?.message ?? e}`;
    }

    runs.update(runId, {
      status,
      finishedAt: new Date().toISOString(),
      report,
    });
    emit("run.finished", { status, report });
  } catch (e: any) {
    runs.update(runId, {
      status: "error",
      finishedAt: new Date().toISOString(),
      report: `Executor error: ${e?.message ?? e}`,
    });
    emit("run.error", { error: e?.message ?? String(e) });
  } finally {
    activeRuns.delete(runId);
    transcript.end();
  }
}

function projectCwd(project: Project): string {
  // Prefer the first repo's local path. If no repos, fall back to the
  // project dir so the agent at least has a stable cwd.
  const r = project.repos.find((r) => r.localPath && r.status === "ok");
  if (r?.localPath) return r.localPath;
  return path.join(config.projectsDir, project.id);
}

function buildSystemPreamble(project: Project, flow: Flow): string {
  const repoLines = project.repos
    .map((r) => `  - ${r.url}${r.ref ? "@" + r.ref : ""} (local: ${r.localPath ?? "—"})`)
    .join("\n");
  const sideItems = flow.sideItems
    .map((s) => `  - [${s.kind}] ${s.title}${s.description ? ": " + s.description : ""}`)
    .join("\n");
  const env = project.env
    ? Object.entries(project.env)
        .map(([k, v]) => `  - ${k}=${maskSecret(v)}`)
        .join("\n")
    : "  (none)";
  return `Project: ${project.name}
Overall goal: ${flow.overallGoal ?? "(unspecified)"}
Expected outcome: ${flow.expectedOutcome ?? "(unspecified)"}

Repos under test:
${repoLines || "  (none)"}

Project env / hints:
${env}

Off-flow notes & configs (apply to every step):
${sideItems || "  (none)"}

Project notes from the user:
${project.notes ?? "(none)"}`;
}

function buildStepPrompt(project: Project, flow: Flow, node: FlowNode): string {
  return `# Step: ${node.title}

## What to do
${node.description ?? "(no description provided — use your best judgement based on the overall flow)"}

## Specific test points
${(node.testPoints ?? []).map((p) => `- ${p}`).join("\n") || "(none)"}

## Success criteria (a separate judge LLM will read your transcript and decide)
${node.successCriteria ?? "(none — describe what you observed and let the judge decide)"}

## Reminders
- READ-ONLY: never modify files in the repos. No writes, no commits.
- Be concrete: cite file paths, line numbers, log snippets, request IDs.
- If you find an issue that does not block this step, note it but
  continue — non-blocking bugs are recorded by the judge.
- End with a short summary of what you observed against the success
  criteria.`;
}

function maskSecret(v: string): string {
  if (v.length <= 8) return "***";
  return v.slice(0, 4) + "***" + v.slice(-2);
}

function topoOrder(flow: Flow): FlowNode[] {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const indeg = new Map<string, number>();
  for (const n of flow.nodes) indeg.set(n.id, 0);
  for (const e of flow.edges) {
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const queue: FlowNode[] = [];
  for (const [id, d] of indeg) {
    if (d === 0) {
      const n = byId.get(id);
      if (n) queue.push(n);
    }
  }
  const out: FlowNode[] = [];
  const adj = new Map<string, string[]>();
  for (const e of flow.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const t of adj.get(n.id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if ((indeg.get(t) ?? 0) === 0) {
        const nn = byId.get(t);
        if (nn) queue.push(nn);
      }
    }
  }
  // If cycle detected (out smaller than nodes), append leftover in
  // arbitrary order so we never silently drop steps.
  if (out.length < flow.nodes.length) {
    for (const n of flow.nodes) if (!out.includes(n)) out.push(n);
  }
  return out;
}

async function pickNextBranch(
  flow: Flow,
  current: FlowNode,
  transcript: string
): Promise<string | null> {
  const outs = flow.edges.filter((e: FlowEdge) => e.source === current.id);
  if (outs.length <= 1) return outs[0]?.target ?? null;

  const sys = `You pick the next branch in a QA flow.

Given the just-finished step's transcript and a list of candidate next
steps with optional conditions, return JSON like:
{"to": "<edge target id>", "why": "<one sentence>"}.

Pick exactly one target. If none of the conditions clearly apply,
return the first candidate.`;
  const user = `Just finished step: ${current.title}

Candidates:
${outs.map((o) => `- to=${o.target}  cond=${o.condition ?? "(none)"}  label=${o.label ?? "(none)"}`).join("\n")}

Transcript tail:
---
${transcript.slice(-4000)}
---

Return JSON now.`;
  try {
    const res = await askJson<{ to: string }>(user, {
      system: sys,
      maxTokens: 400,
    });
    if (outs.find((o) => o.target === res.to)) return res.to;
  } catch {}
  return outs[0]?.target ?? null;
}

// Avoid "ask" import unused warning when tree-shaken.
void ask;
