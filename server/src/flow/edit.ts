/**
 * Apply natural-language edits to an existing Flow.
 *
 * Two modes share the same path:
 * 1. User types a chat instruction in the designer ("split step 3 into
 *    two", "add a stop-keyword test note").
 * 2. CLI / API caller passes a one-shot edit instruction.
 *
 * Implementation: we hand the LLM the current flow as JSON plus the
 * instruction and ask it to return the *complete* new flow. This keeps
 * the protocol simple — no patches, no diff format. With a 200k window
 * the cost is fine for any realistic flow.
 */
import { nanoid } from "nanoid";
import type { Flow, FlowEdge, FlowEditResult, FlowNode } from "@ccqa/shared";
import { askJson } from "../llm/anthropic.js";

interface EditedFlow {
  overall_goal?: string;
  expected_outcome?: string;
  nodes: Array<{
    id: string;
    kind: FlowNode["kind"];
    title: string;
    description?: string;
    test_points?: string[];
    success_criteria?: string;
    position?: { x: number; y: number };
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    label?: string;
    condition?: string;
  }>;
  side_items: Array<{
    id?: string;
    kind: "note" | "config";
    title: string;
    description?: string;
  }>;
  /** What you changed, in plain English, for the chat panel. */
  summary: string;
}

export async function editFlowByInstruction(
  flow: Flow,
  instruction: string
): Promise<FlowEditResult> {
  const sys = `You edit QA test flows for the CCQA harness.

You will receive the current flow as JSON and an instruction in
natural language. Apply the instruction and return the FULL new flow.

Rules:
- Preserve node ids when the user is modifying an existing node, so
  the canvas does not lose layout. Generate new ids only for new nodes.
- "kind" in nodes is one of: start, end, step, decision, parallel,
  note, config. Notes / configs go in "side_items", not "nodes".
- Edges connect node ids in "nodes". Do not point edges at side_items.
- "success_criteria" is FREE TEXT for a judge LLM to read; do not
  write regex or code there.
- Keep "summary" concise (1-3 sentences) — it's shown to the user
  in the chat panel.
- If the instruction is ambiguous, make a reasonable choice and
  describe it in "summary".`;

  const user = `Current flow:
\`\`\`json
${JSON.stringify(serialize(flow), null, 2)}
\`\`\`

Instruction: ${instruction}

Return the complete new flow as JSON.`;

  const ed = await askJson<EditedFlow>(user, { system: sys, maxTokens: 8000 });
  const summary =
    typeof ed.summary === "string" && ed.summary.trim()
      ? ed.summary.trim()
      : "Flow updated.";
  return { flow: deserialize(flow.projectId, ed), summary };
}

function serialize(f: Flow) {
  return {
    overall_goal: f.overallGoal,
    expected_outcome: f.expectedOutcome,
    nodes: f.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      description: n.description,
      test_points: n.testPoints,
      success_criteria: n.successCriteria,
      position: n.position,
    })),
    edges: f.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      condition: e.condition,
    })),
    side_items: f.sideItems.map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      description: s.description,
    })),
  };
}

function deserialize(projectId: string, ed: EditedFlow): Flow {
  const allowedNodeKinds = new Set([
    "start",
    "end",
    "step",
    "decision",
    "parallel",
  ]);
  const usedNodeIds = new Set<string>();
  const nodes: FlowNode[] = ed.nodes.map((n) => {
    let id = (n.id ?? "").trim() || `node_${nanoid(6)}`;
    while (usedNodeIds.has(id)) id = `${id}_${nanoid(4)}`;
    usedNodeIds.add(id);
    return {
      id,
      projectId,
      kind: (allowedNodeKinds.has(n.kind as string)
        ? n.kind
        : "step") as FlowNode["kind"],
      title: n.title ?? "Untitled step",
      description: n.description,
      testPoints: n.test_points,
      successCriteria: n.success_criteria,
      position: n.position,
    };
  });
  const edges: FlowEdge[] = ed.edges.map((e) => ({
    id: e.id ?? nanoid(8),
    projectId,
    source: e.source,
    target: e.target,
    label: e.label,
    condition: e.condition,
  }));
  const sideItems: FlowNode[] = (ed.side_items ?? []).map((s, i) => ({
    id: s.id ?? `side_${i + 1}_${nanoid(4)}`,
    projectId,
    kind: s.kind === "config" ? "config" : "note",
    title: s.title ?? `Note ${i + 1}`,
    description: s.description,
    order: i,
  }));
  return {
    projectId,
    overallGoal: ed.overall_goal,
    expectedOutcome: ed.expected_outcome,
    nodes,
    edges,
    sideItems,
    updatedAt: new Date().toISOString(),
  };
}
