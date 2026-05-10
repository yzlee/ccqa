/**
 * Turn the user's free-form "main flow" description into a structured
 * Flow (nodes + edges + side notes) by asking an LLM.
 *
 * We deliberately keep this LLM-driven rather than templated. The user
 * told us: "anything an LLM can decide, let it decide". That includes
 * which steps deserve their own node, what the success criteria for
 * each step are, and which items belong off-flow as notes/configs.
 */
import { nanoid } from "nanoid";
import type { Flow, FlowEdge, FlowNode, Project } from "@ccqa/shared";
import { askJson } from "../llm/anthropic.js";

interface GenSpec {
  overall_goal: string;
  expected_outcome: string;
  /** Main-line flow nodes, in execution order. */
  steps: Array<{
    id?: string;
    title: string;
    description: string;
    test_points: string[];
    success_criteria: string;
    /** Optional: branches out to other step ids on a condition. */
    branches?: Array<{ to: string; condition?: string; label?: string }>;
  }>;
  /**
   * Off-flow items: configs and tips. Tolerated as either object or
   * plain string — some models prefer one, some the other.
   */
  notes: Array<
    | { title: string; description?: string; kind?: "note" | "config" }
    | string
  >;
}

function splitNoteString(s: string): {
  title: string;
  description?: string;
  kind?: "note" | "config";
} {
  const cleaned = s.trim();
  // Title = first newline-separated segment, capped at 120 chars. We
  // intentionally do NOT split on "." here — URLs / file paths
  // commonly contain dots and we don't want to slice them in half.
  const newlineAt = cleaned.indexOf("\n");
  const head =
    newlineAt === -1 ? cleaned : cleaned.slice(0, newlineAt);
  if (head.length <= 120) {
    return {
      title: head,
      description:
        newlineAt === -1
          ? undefined
          : cleaned.slice(newlineAt + 1).trim() || undefined,
    };
  }
  // Long single-line note: take first 117 chars + "…" as title, rest
  // as description so nothing is lost.
  return {
    title: head.slice(0, 117) + "…",
    description: cleaned,
  };
}

export async function generateFlow(
  project: Project,
  mainFlowText?: string
): Promise<Flow> {
  const text = mainFlowText ?? project.mainFlowText ?? "";
  if (!text.trim()) {
    throw new Error("Project has no mainFlowText to generate a flow from.");
  }

  const sys = `You design QA test flows for the CCQA test harness.

Given the user's free-form description of how a piece of software should
be tested, produce a structured plan:
- "overall_goal": one sentence describing the big-picture goal of the run.
- "expected_outcome": what success looks like for the WHOLE run.
- "steps": ordered list of executable test steps. Each step has:
  - "title": short imperative phrase ("Onboard 3 new users", "Search for matches")
  - "description": what the testing agent should do, concretely
  - "test_points": specific things to watch for / verify in this step
  - "success_criteria": how to decide if this step passed (FREE TEXT — a
    judge LLM will read this; do NOT write regex or code, write what a
    careful human reviewer would say)
  - optional "branches": when this step has multiple outcomes, list
    branches like {"to":"<title-or-id-of-next-step>","condition":"...","label":"..."}.
    By default the flow is linear; use branches sparingly.
- "notes": OFF-FLOW items: environment configs, credentials hints, gotchas,
  tips that apply globally — anything that is not itself a test step.

Be concrete and high-signal. Do not invent steps that are not implied by
the input. If the input mentions specific URLs, hostnames, IDs, phone-number
patterns, services, or files, preserve them verbatim in descriptions /
test_points / notes.`;

  const repoBlurb = project.repos
    .map((r) => `- ${r.url}${r.ref ? "@" + r.ref : ""}`)
    .join("\n");

  const user = `Project: ${project.name}
Repos under test:
${repoBlurb || "(none)"}
Coder: ${project.coder}

Free-form main flow text:
---
${text}
---

Produce the JSON now.`;

  const spec = await askJson<GenSpec>(user, { system: sys, maxTokens: 6000 });
  return specToFlow(project.id, spec);
}

function specToFlow(projectId: string, spec: GenSpec): Flow {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const used = new Set<string>(["start", "end"]);
  const uniqueId = (preferred: string | undefined, fallback: string) => {
    let id = (preferred ?? "").trim() || fallback;
    // Reserved by the start/end nodes — never let a step collide.
    if (id === "start" || id === "end") id = fallback;
    while (used.has(id)) id = `${fallback}_${nanoid(4)}`;
    used.add(id);
    return id;
  };

  const start: FlowNode = {
    id: "start",
    projectId,
    kind: "start",
    title: "Start",
    position: { x: 60, y: 60 },
  };
  nodes.push(start);

  const titleToId = new Map<string, string>();
  let y = 180;
  for (const [i, s] of spec.steps.entries()) {
    const id = uniqueId(s.id, `step_${i + 1}_${nanoid(4)}`);
    titleToId.set((s.title ?? "").toLowerCase(), id);
    nodes.push({
      id,
      projectId,
      kind: "step",
      title: s.title ?? `Step ${i + 1}`,
      description: s.description,
      testPoints: s.test_points ?? [],
      successCriteria: s.success_criteria,
      position: { x: 60, y },
    });
    y += 140;
  }

  const end: FlowNode = {
    id: "end",
    projectId,
    kind: "end",
    title: "End",
    position: { x: 60, y },
  };
  nodes.push(end);

  // Default linear edges, then layer custom branches on top.
  if (spec.steps.length > 0) {
    edges.push({ id: nanoid(8), projectId, source: "start", target: getStepId(spec, 0, titleToId) });
    for (let i = 0; i < spec.steps.length - 1; i++) {
      edges.push({
        id: nanoid(8),
        projectId,
        source: getStepId(spec, i, titleToId),
        target: getStepId(spec, i + 1, titleToId),
      });
    }
    edges.push({
      id: nanoid(8),
      projectId,
      source: getStepId(spec, spec.steps.length - 1, titleToId),
      target: "end",
    });
  } else {
    edges.push({ id: nanoid(8), projectId, source: "start", target: "end" });
  }

  for (const [i, s] of spec.steps.entries()) {
    if (!s.branches) continue;
    for (const b of s.branches) {
      const target = titleToId.get(b.to.toLowerCase()) ?? b.to;
      edges.push({
        id: nanoid(8),
        projectId,
        source: getStepId(spec, i, titleToId),
        target,
        condition: b.condition,
        label: b.label,
      });
    }
  }

  const sideUsed = new Set(used);
  const sideItems: FlowNode[] = (spec.notes ?? []).map((raw, i) => {
    // Sometimes the LLM emits notes as plain strings instead of objects.
    // Adopt either shape; if it's a string, use the first sentence as
    // the title and the rest as description.
    const n =
      typeof raw === "string"
        ? splitNoteString(raw)
        : (raw as { kind?: string; title?: string; description?: string });
    let id = `side_${i + 1}_${nanoid(4)}`;
    while (sideUsed.has(id)) id = `side_${i + 1}_${nanoid(6)}`;
    sideUsed.add(id);
    return {
      id,
      projectId,
      kind: n.kind === "config" ? "config" : "note",
      title: n.title ?? `Note ${i + 1}`,
      description: n.description,
      order: i,
    };
  });

  return {
    projectId,
    overallGoal: spec.overall_goal,
    expectedOutcome: spec.expected_outcome,
    nodes,
    edges,
    sideItems,
    updatedAt: new Date().toISOString(),
  };
}

function getStepId(
  spec: GenSpec,
  index: number,
  m: Map<string, string>
): string {
  return m.get(spec.steps[index].title.toLowerCase()) ?? `step_${index + 1}`;
}
