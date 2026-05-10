/**
 * Thin repository helpers around the SQLite tables. Pure CRUD; no
 * business logic. Higher layers compose these.
 */
import { nanoid } from "nanoid";
import type {
  Bug,
  Flow,
  FlowEdge,
  FlowNode,
  Project,
  Repo,
  Run,
  RunEvent,
  RunStep,
} from "@ccqa/shared";
import { db } from "./schema.js";

const now = () => new Date().toISOString();

function rowToProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    repos: JSON.parse(r.repos_json) as Repo[],
    mainFlowText: r.main_flow_text ?? undefined,
    coder: r.coder,
    env: r.env_json ? JSON.parse(r.env_json) : undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const projects = {
  create(p: Omit<Project, "id" | "createdAt" | "updatedAt">): Project {
    const id = nanoid(12);
    const ts = now();
    db()
      .prepare(
        `INSERT INTO projects (id, name, description, repos_json, main_flow_text, coder, env_json, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        p.name,
        p.description ?? null,
        JSON.stringify(p.repos ?? []),
        p.mainFlowText ?? null,
        p.coder ?? "claude-code",
        p.env ? JSON.stringify(p.env) : null,
        p.notes ?? null,
        ts,
        ts
      );
    return this.get(id)!;
  },
  get(id: string): Project | null {
    const r = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as any;
    return r ? rowToProject(r) : null;
  },
  list(): Project[] {
    return (
      db()
        .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
        .all() as any[]
    ).map(rowToProject);
  },
  update(id: string, patch: Partial<Project>): Project | null {
    const cur = this.get(id);
    if (!cur) return null;
    const merged: Project = { ...cur, ...patch, updatedAt: now() };
    db()
      .prepare(
        `UPDATE projects SET name=?, description=?, repos_json=?, main_flow_text=?, coder=?, env_json=?, notes=?, updated_at=? WHERE id=?`
      )
      .run(
        merged.name,
        merged.description ?? null,
        JSON.stringify(merged.repos ?? []),
        merged.mainFlowText ?? null,
        merged.coder,
        merged.env ? JSON.stringify(merged.env) : null,
        merged.notes ?? null,
        merged.updatedAt,
        id
      );
    return this.get(id);
  },
  remove(id: string): void {
    db().prepare("DELETE FROM projects WHERE id = ?").run(id);
  },
};

function rowToNode(r: any): FlowNode {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    title: r.title,
    description: r.description ?? undefined,
    testPoints: r.test_points_json ? JSON.parse(r.test_points_json) : undefined,
    successCriteria: r.success_criteria ?? undefined,
    position: r.position_json ? JSON.parse(r.position_json) : undefined,
    order: r.order_idx ?? undefined,
    meta: r.meta_json ? JSON.parse(r.meta_json) : undefined,
  };
}

function rowToEdge(r: any): FlowEdge {
  return {
    id: r.id,
    projectId: r.project_id,
    source: r.source,
    target: r.target,
    label: r.label ?? undefined,
    condition: r.condition ?? undefined,
  };
}

const sideKinds = new Set(["note", "config"]);

export const flows = {
  get(projectId: string): Flow {
    const meta = db()
      .prepare("SELECT * FROM flow_meta WHERE project_id = ?")
      .get(projectId) as any;
    const allNodes = (
      db()
        .prepare("SELECT * FROM flow_nodes WHERE project_id = ?")
        .all(projectId) as any[]
    ).map(rowToNode);
    const edges = (
      db()
        .prepare("SELECT * FROM flow_edges WHERE project_id = ?")
        .all(projectId) as any[]
    ).map(rowToEdge);
    const nodes = allNodes.filter((n) => !sideKinds.has(n.kind));
    const sideItems = allNodes
      .filter((n) => sideKinds.has(n.kind))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return {
      projectId,
      overallGoal: meta?.overall_goal ?? undefined,
      expectedOutcome: meta?.expected_outcome ?? undefined,
      nodes,
      edges,
      sideItems,
      updatedAt: meta?.updated_at ?? now(),
    };
  },

  /** Replace the entire flow for a project. Used after generation/edits. */
  replace(flow: Flow): void {
    const d = db();
    const tx = d.transaction(() => {
      d.prepare("DELETE FROM flow_nodes WHERE project_id = ?").run(
        flow.projectId
      );
      d.prepare("DELETE FROM flow_edges WHERE project_id = ?").run(
        flow.projectId
      );
      const insN = d.prepare(
        `INSERT INTO flow_nodes (id, project_id, kind, title, description, test_points_json, success_criteria, position_json, order_idx, meta_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      );
      const all = [...flow.nodes, ...flow.sideItems];
      for (const n of all) {
        if (!n.kind || !n.title) {
          throw new Error(
            `flow_nodes insert: missing required field for node ${JSON.stringify(
              n
            ).slice(0, 300)}`
          );
        }
        insN.run(
          n.id,
          flow.projectId,
          n.kind,
          n.title,
          n.description ?? null,
          n.testPoints ? JSON.stringify(n.testPoints) : null,
          n.successCriteria ?? null,
          n.position ? JSON.stringify(n.position) : null,
          n.order ?? null,
          n.meta ? JSON.stringify(n.meta) : null
        );
      }
      const insE = d.prepare(
        `INSERT INTO flow_edges (id, project_id, source, target, label, condition)
         VALUES (?,?,?,?,?,?)`
      );
      for (const e of flow.edges) {
        insE.run(
          e.id,
          flow.projectId,
          e.source,
          e.target,
          e.label ?? null,
          e.condition ?? null
        );
      }
      d.prepare(
        `INSERT INTO flow_meta (project_id, overall_goal, expected_outcome, updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(project_id) DO UPDATE SET overall_goal=excluded.overall_goal, expected_outcome=excluded.expected_outcome, updated_at=excluded.updated_at`
      ).run(
        flow.projectId,
        flow.overallGoal ?? null,
        flow.expectedOutcome ?? null,
        now()
      );
    });
    tx();
  },
};

export const flowChat = {
  add(projectId: string, role: "user" | "assistant", content: string) {
    const id = nanoid(12);
    db()
      .prepare(
        `INSERT INTO flow_chat (id, project_id, role, content, created_at) VALUES (?,?,?,?,?)`
      )
      .run(id, projectId, role, content, now());
    return id;
  },
  list(projectId: string) {
    return db()
      .prepare(
        `SELECT id, role, content, created_at FROM flow_chat WHERE project_id = ? ORDER BY created_at`
      )
      .all(projectId) as Array<{
      id: string;
      role: string;
      content: string;
      created_at: string;
    }>;
  },
};

function rowToRun(r: any): Run {
  return {
    id: r.id,
    projectId: r.project_id,
    status: r.status,
    coder: r.coder,
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? undefined,
    report: r.report ?? undefined,
    usage: r.usage_json ? JSON.parse(r.usage_json) : undefined,
  };
}

export const runs = {
  create(projectId: string, coder: string): Run {
    const id = nanoid(12);
    const ts = now();
    db()
      .prepare(
        `INSERT INTO runs (id, project_id, status, coder, started_at) VALUES (?,?,?,?,?)`
      )
      .run(id, projectId, "queued", coder, ts);
    return this.get(id)!;
  },
  get(id: string): Run | null {
    const r = db().prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
    return r ? rowToRun(r) : null;
  },
  listByProject(projectId: string): Run[] {
    return (
      db()
        .prepare(
          "SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC"
        )
        .all(projectId) as any[]
    ).map(rowToRun);
  },
  update(id: string, patch: Partial<Run>): Run | null {
    const cur = this.get(id);
    if (!cur) return null;
    const merged: Run = { ...cur, ...patch };
    db()
      .prepare(
        `UPDATE runs SET status=?, finished_at=?, report=?, usage_json=? WHERE id=?`
      )
      .run(
        merged.status,
        merged.finishedAt ?? null,
        merged.report ?? null,
        merged.usage ? JSON.stringify(merged.usage) : null,
        id
      );
    return this.get(id);
  },
};

function rowToStep(r: any): RunStep {
  return {
    id: r.id,
    runId: r.run_id,
    nodeId: r.node_id,
    title: r.title,
    status: r.status,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    judgement: r.judgement ?? undefined,
    tail: r.tail ?? undefined,
  };
}

export const runSteps = {
  create(s: Omit<RunStep, "id">): RunStep {
    const id = nanoid(12);
    db()
      .prepare(
        `INSERT INTO run_steps (id, run_id, node_id, title, status, started_at, finished_at, judgement, tail)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        s.runId,
        s.nodeId,
        s.title,
        s.status,
        s.startedAt ?? null,
        s.finishedAt ?? null,
        s.judgement ?? null,
        s.tail ?? null
      );
    return this.get(id)!;
  },
  get(id: string): RunStep | null {
    const r = db()
      .prepare("SELECT * FROM run_steps WHERE id = ?")
      .get(id) as any;
    return r ? rowToStep(r) : null;
  },
  listByRun(runId: string): RunStep[] {
    return (
      db()
        .prepare("SELECT * FROM run_steps WHERE run_id = ?")
        .all(runId) as any[]
    ).map(rowToStep);
  },
  update(id: string, patch: Partial<RunStep>): RunStep | null {
    const cur = this.get(id);
    if (!cur) return null;
    const merged = { ...cur, ...patch };
    db()
      .prepare(
        `UPDATE run_steps SET status=?, started_at=?, finished_at=?, judgement=?, tail=? WHERE id=?`
      )
      .run(
        merged.status,
        merged.startedAt ?? null,
        merged.finishedAt ?? null,
        merged.judgement ?? null,
        merged.tail ?? null,
        id
      );
    return this.get(id);
  },
};

export const bugs = {
  create(b: Omit<Bug, "id" | "createdAt">): Bug {
    const id = nanoid(12);
    const ts = now();
    db()
      .prepare(
        `INSERT INTO bugs (id, run_id, step_id, title, description, severity, blocking, evidence_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        b.runId,
        b.stepId ?? null,
        b.title,
        b.description,
        b.severity,
        b.blocking ? 1 : 0,
        b.evidence ? JSON.stringify(b.evidence) : null,
        ts
      );
    return { ...b, id, createdAt: ts };
  },
  listByRun(runId: string): Bug[] {
    return (
      db()
        .prepare("SELECT * FROM bugs WHERE run_id = ? ORDER BY created_at")
        .all(runId) as any[]
    ).map((r) => ({
      id: r.id,
      runId: r.run_id,
      stepId: r.step_id ?? undefined,
      title: r.title,
      description: r.description,
      severity: r.severity,
      blocking: !!r.blocking,
      evidence: r.evidence_json ? JSON.parse(r.evidence_json) : undefined,
      createdAt: r.created_at,
    }));
  },
};

export const events = {
  add(e: Omit<RunEvent, "id">): RunEvent {
    const id = nanoid(16);
    db()
      .prepare(
        `INSERT INTO run_events (id, run_id, step_id, ts, type, payload_json) VALUES (?,?,?,?,?,?)`
      )
      .run(
        id,
        e.runId,
        e.stepId ?? null,
        e.ts,
        e.type,
        JSON.stringify(e.payload)
      );
    return { ...e, id };
  },
  listByRun(runId: string, sinceTs?: string): RunEvent[] {
    const rows = sinceTs
      ? (db()
          .prepare(
            "SELECT * FROM run_events WHERE run_id = ? AND ts > ? ORDER BY ts"
          )
          .all(runId, sinceTs) as any[])
      : (db()
          .prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY ts")
          .all(runId) as any[]);
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      stepId: r.step_id ?? undefined,
      ts: r.ts,
      type: r.type,
      payload: JSON.parse(r.payload_json),
    }));
  },
};
