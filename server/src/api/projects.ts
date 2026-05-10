import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { projects, flows } from "../db/repo.js";
import { cloneRepos } from "../services/clone.js";
import type { CreateProjectRequest } from "@ccqa/shared";
import { config } from "../config.js";

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  repos: z.array(z.object({ url: z.string().min(1), ref: z.string().optional() })).default([]),
  coder: z.enum(["claude-code", "codex", "kimi"]).optional(),
  mainFlowText: z.string().optional(),
  env: z.record(z.string()).optional(),
  notes: z.string().optional(),
});

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async () => projects.list());

  app.post("/api/projects", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = projects.create({
      name: body.name,
      description: body.description,
      repos: body.repos,
      coder: body.coder ?? config.defaultCoder,
      mainFlowText: body.mainFlowText,
      env: body.env,
      notes: body.notes,
    });
    // Kick off clone in background — don't block the response.
    cloneRepos(created.id).catch((e) =>
      app.log.error({ err: e, projectId: created.id }, "clone failed")
    );
    reply.code(201);
    return created;
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const p = projects.get(id);
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });

  app.patch("/api/projects/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const body = req.body as Partial<CreateProjectRequest>;
    const updated = projects.update(id, body as any);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return updated;
  });

  app.delete("/api/projects/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    projects.remove(id);
    reply.code(204).send();
  });

  app.post("/api/projects/:id/clone", async (req, reply) => {
    const id = (req.params as any).id as string;
    const repos = await cloneRepos(id);
    return { repos };
  });

  app.get("/api/projects/:id/flow", async (req) => {
    const id = (req.params as any).id as string;
    return flows.get(id);
  });
}
