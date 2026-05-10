import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bugs, events, projects, runs, runSteps } from "../db/repo.js";
import { cancelRun, executeRun } from "../flow/execute.js";
import { subscribe } from "../services/eventBus.js";

const startSchema = z.object({
  coder: z.enum(["claude-code", "codex", "kimi"]).optional(),
});

export async function runRoutes(app: FastifyInstance) {
  app.post("/api/projects/:id/runs", async (req, reply) => {
    const projectId = (req.params as any).id as string;
    const body = startSchema.parse(req.body ?? {});
    const project = projects.get(projectId);
    if (!project) return reply.code(404).send({ error: "no project" });
    const run = runs.create(projectId, body.coder ?? project.coder);
    // Fire-and-forget; the executor manages its own lifecycle.
    executeRun(run.id).catch((e) =>
      app.log.error({ err: e, runId: run.id }, "executor crashed")
    );
    reply.code(201);
    return run;
  });

  app.get("/api/projects/:id/runs", async (req) => {
    const id = (req.params as any).id as string;
    return runs.listByProject(id);
  });

  app.get("/api/runs/:runId", async (req, reply) => {
    const id = (req.params as any).runId as string;
    const r = runs.get(id);
    if (!r) return reply.code(404).send({ error: "not found" });
    return {
      run: r,
      steps: runSteps.listByRun(id),
      bugs: bugs.listByRun(id),
    };
  });

  app.get("/api/runs/:runId/events", async (req) => {
    const id = (req.params as any).runId as string;
    const since = (req.query as any).since as string | undefined;
    return events.listByRun(id, since);
  });

  app.post("/api/runs/:runId/cancel", async (req, reply) => {
    const id = (req.params as any).runId as string;
    const ok = cancelRun(id);
    return { cancelled: ok };
  });

  app.get("/api/runs/:runId/stream", { websocket: true }, (conn, req) => {
    const id = (req.params as any).runId as string;
    const sock = (conn as any).socket ?? conn;

    // Replay history first.
    for (const e of events.listByRun(id)) {
      try {
        sock.send(JSON.stringify(e));
      } catch {
        return;
      }
    }
    const unsub = subscribe(id, (e) => {
      try {
        sock.send(JSON.stringify(e));
      } catch {}
    });
    sock.on("close", () => unsub());
  });
}
