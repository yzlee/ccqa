import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { flowChat, flows, projects } from "../db/repo.js";
import { generateFlow } from "../flow/generate.js";
import { editFlowByInstruction } from "../flow/edit.js";
import type { Flow } from "@ccqa/shared";

const genSchema = z.object({
  mainFlowText: z.string().optional(),
});

const editSchema = z.object({
  instruction: z.string().min(1),
});

const replaceSchema = z.object({
  flow: z.any(),
});

export async function flowRoutes(app: FastifyInstance) {
  app.post("/api/projects/:id/flow/generate", async (req, reply) => {
    const id = (req.params as any).id as string;
    const project = projects.get(id);
    if (!project) return reply.code(404).send({ error: "not found" });
    const body = genSchema.parse(req.body ?? {});
    if (body.mainFlowText) {
      projects.update(id, { mainFlowText: body.mainFlowText });
    }
    const updated = projects.get(id)!;
    const flow = await generateFlow(updated, body.mainFlowText);
    flows.replace(flow);
    return flow;
  });

  app.post("/api/projects/:id/flow/edit", async (req, reply) => {
    const id = (req.params as any).id as string;
    const body = editSchema.parse(req.body);
    const cur = flows.get(id);
    if (!cur) return reply.code(404).send({ error: "no flow" });
    flowChat.add(id, "user", body.instruction);
    const result = await editFlowByInstruction(cur, body.instruction);
    flows.replace(result.flow);
    flowChat.add(id, "assistant", result.summary);
    return { ...result, chat: flowChat.list(id) };
  });

  app.put("/api/projects/:id/flow", async (req, reply) => {
    const id = (req.params as any).id as string;
    const body = replaceSchema.parse(req.body);
    const flow = body.flow as Flow;
    flow.projectId = id;
    flows.replace(flow);
    return flows.get(id);
  });

  app.get("/api/projects/:id/flow/chat", async (req) => {
    const id = (req.params as any).id as string;
    return flowChat.list(id);
  });
}
