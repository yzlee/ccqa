import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  _db = new Database(config.dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      repos_json TEXT NOT NULL DEFAULT '[]',
      main_flow_text TEXT,
      coder TEXT NOT NULL DEFAULT 'claude-code',
      env_json TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    /**
     * Node ids are unique *within* a project, not globally. This lets
     * every project use the well-known ids "start" and "end" without
     * cross-project collisions.
     */
    CREATE TABLE IF NOT EXISTS flow_nodes (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      test_points_json TEXT,
      success_criteria TEXT,
      position_json TEXT,
      order_idx INTEGER,
      meta_json TEXT,
      PRIMARY KEY (project_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_flow_nodes_project ON flow_nodes(project_id);

    CREATE TABLE IF NOT EXISTS flow_edges (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      label TEXT,
      condition TEXT,
      PRIMARY KEY (project_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_flow_edges_project ON flow_edges(project_id);

    CREATE TABLE IF NOT EXISTS flow_meta (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      overall_goal TEXT,
      expected_outcome TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      coder TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      report TEXT,
      usage_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);

    CREATE TABLE IF NOT EXISTS run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      judgement TEXT,
      tail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id);

    CREATE TABLE IF NOT EXISTS bugs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL,
      blocking INTEGER NOT NULL DEFAULT 0,
      evidence_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bugs_run ON bugs(run_id);

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, ts);

    /**
     * Free-form chat history for the flow designer dialogue.
     */
    CREATE TABLE IF NOT EXISTS flow_chat (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_flow_chat_project ON flow_chat(project_id, created_at);
  `);
}
