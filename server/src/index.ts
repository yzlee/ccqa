import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { db } from "./db/schema.js";
import { config } from "./config.js";
import { projectRoutes } from "./api/projects.js";
import { flowRoutes } from "./api/flows.js";
import { runRoutes } from "./api/runs.js";

async function main() {
  // Touch the DB so migrations run before any request.
  db();

  const app = Fastify({
    logger: { level: process.env.CCQA_LOG_LEVEL ?? "info" },
  });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/api/health", async () => ({
    ok: true,
    version: "0.1.0",
    coder: config.defaultCoder,
  }));

  await app.register(projectRoutes);
  await app.register(flowRoutes);
  await app.register(runRoutes);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`CCQA listening at http://${config.host}:${config.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
