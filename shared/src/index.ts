/**
 * Shared types between server / web / cli.
 *
 * Design note: many fields are intentionally free-form text or JSON blobs
 * because the system delegates judgement to LLMs rather than encoding
 * hard rules. Treat schemas here as transport, not as logic.
 */

export type CoderKind = "claude-code" | "codex" | "kimi";

export type RunStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "error";

export type StepStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "blocked";

export type NodeKind =
  | "start"
  | "end"
  | "step"
  | "decision"
  | "parallel";

export interface Repo {
  url: string;
  /** Optional ref/branch/tag/commit. */
  ref?: string;
  /** Where it was cloned to inside data/projects/<projectId>/repos/<name> */
  localPath?: string;
  /** Last clone status: "ok" | "error" | "pending" */
  status?: string;
  error?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  repos: Repo[];
  /** Free-form natural language describing the main test flow. */
  mainFlowText?: string;
  /** Coder used to drive tests for this project. */
  coder: CoderKind;
  /** Extra environment variables / secrets references / instructions. */
  env?: Record<string, string>;
  /** Free-form configs and tips that apply to every run. */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A node in the test flow canvas. Step nodes are part of the executable
 * flow. Notes/configs are off-flow items rendered as a list.
 */
export interface FlowNode {
  id: string;
  projectId: string;
  kind: NodeKind | "note" | "config";
  title: string;
  /** What this step is supposed to do. */
  description?: string;
  /** Specific test points the LLM must pay attention to. */
  testPoints?: string[];
  /** Free-form criteria. The judge LLM decides pass/fail against this. */
  successCriteria?: string;
  /** ReactFlow canvas position. */
  position?: { x: number; y: number };
  /** Order index for off-flow items (notes/configs). */
  order?: number;
  /** UI hints (color, icon, etc.) — free form for the LLM to set. */
  meta?: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  projectId: string;
  source: string;
  target: string;
  /** Optional label, e.g. branch condition like "if logged in". */
  label?: string;
  /** Optional condition the LLM may evaluate when branching. */
  condition?: string;
}

export interface Flow {
  projectId: string;
  /** Overall goal of the test, distilled by LLM. */
  overallGoal?: string;
  /** Free-form expected outcome of the whole run. */
  expectedOutcome?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Off-flow notes/configs (rendered in the side list). */
  sideItems: FlowNode[];
  updatedAt: string;
}

export interface Run {
  id: string;
  projectId: string;
  status: RunStatus;
  coder: CoderKind;
  startedAt: string;
  finishedAt?: string;
  /** Final markdown report from the LLM. */
  report?: string;
  /** Aggregated cost / tokens, if reported by the coder. */
  usage?: Record<string, number>;
}

export interface RunStep {
  id: string;
  runId: string;
  nodeId: string;
  title: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  /** Last LLM verdict text. */
  judgement?: string;
  /** Tail of the most recent agent output for the UI. */
  tail?: string;
}

export interface Bug {
  id: string;
  runId: string;
  stepId?: string;
  title: string;
  description: string;
  /** Severity: "low" | "medium" | "high" | "critical" — assigned by LLM. */
  severity: string;
  /** True if this bug should stop the run. LLM-decided. */
  blocking: boolean;
  /** Evidence pointers (file paths, log snippets, urls). */
  evidence?: string[];
  createdAt: string;
}

/**
 * Streaming event from a run. Sent over WebSocket; persisted.
 *
 * `type` is intentionally open — coders can emit any event. UI renders
 * known kinds with custom icons and falls back to a generic line.
 */
export interface RunEvent {
  id: string;
  runId: string;
  stepId?: string;
  ts: string;
  /** e.g. "agent.text" | "agent.tool_use" | "agent.tool_result" |
   *      "step.started" | "step.finished" | "judge.verdict" |
   *      "bug.found" | "run.report" | "run.finished" */
  type: string;
  payload: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Wire DTOs                                                          */
/* ------------------------------------------------------------------ */

export interface CreateProjectRequest {
  name: string;
  description?: string;
  repos: Array<{ url: string; ref?: string }>;
  coder?: CoderKind;
  mainFlowText?: string;
  env?: Record<string, string>;
  notes?: string;
}

export interface GenerateFlowRequest {
  projectId: string;
  /** Optional override for the project's main flow text. */
  mainFlowText?: string;
  /** Whether to consult the cloned repos when generating. */
  inspectCode?: boolean;
}

export interface EditFlowRequest {
  projectId: string;
  /** Plain English instruction. e.g. "split step 3 into two steps". */
  instruction: string;
}

export interface StartRunRequest {
  projectId: string;
  /** If omitted, uses the project's default coder. */
  coder?: CoderKind;
}

export interface FlowEditResult {
  flow: Flow;
  /** What the LLM changed, in plain English, for the chat panel. */
  summary: string;
}
