import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import nodePath from "node:path";
import { db } from "./db/schema.js";
import { config } from "./config.js";
import { projectRoutes } from "./api/projects.js";
import { flowRoutes } from "./api/flows.js";
import { runRoutes } from "./api/runs.js";

export interface StartServerOptions {
  /** Defaults to env CCQA_PORT or 4317. */
  port?: number;
  /** Defaults to env CCQA_HOST or 127.0.0.1. */
  host?: string;
  /**
   * If set, serve the built web's static files from this directory.
   * The CLI's `serve` command sets this to the bundled dist/web; in
   * dev (`npm run dev:server`) we leave it unset and let Vite proxy.
   */
  webDist?: string;
  /** Pino log level. Defaults to env CCQA_LOG_LEVEL or "info". */
  logLevel?: string;
}

/**
 * Boot the server. Returns a started Fastify app you can `close()`.
 *
 * Used by:
 *   1. `npm run dev:server` — direct CLI invocation of this file (see
 *      bottom of this module).
 *   2. The `@ccqa/cli` `ccqa serve` subcommand — imports this and
 *      passes a webDist so the embedded server also hosts the web.
 */
export async function startServer(
  opts: StartServerOptions = {}
): Promise<FastifyInstance> {
  // Run migrations before any request can land.
  db();

  const app = Fastify({
    logger: { level: opts.logLevel ?? process.env.CCQA_LOG_LEVEL ?? "info" },
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

  const webDist =
    opts.webDist ?? process.env.CCQA_WEB_DIST ?? undefined;
  if (webDist && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: nodePath.resolve(webDist),
      prefix: "/",
      // SPA: any unknown non-/api path falls back to index.html so
      // React Router can take over.
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.type("text/html").send(
        fs.readFileSync(nodePath.join(webDist, "index.html"))
      );
    });
    app.log.info(`Serving web from ${webDist}`);
  }

  const port = opts.port ?? config.port;
  const host = opts.host ?? config.host;
  await app.listen({ port, host });
  app.log.info(`CCQA listening at http://${host}:${port}`);
  return app;
}

// This module deliberately does not auto-boot. Direct script use
// (npm run dev:server) goes through src/dev.ts. Library use (the CLI)
// imports `startServer` and calls it explicitly.
