#!/usr/bin/env node
/**
 * The `ccqa` CLI.
 *
 * Two roles depending on the subcommand:
 *
 * 1. **`ccqa serve`** — boots an embedded server (fastify + sqlite +
 *    websockets) that also serves the bundled web UI. This is the
 *    one-command path for end users installing via `npm i -g @ccqa/cli`.
 *
 * 2. **all other commands** — thin HTTP/WebSocket client against a
 *    running CCQA server (defaults to http://127.0.0.1:4317; override
 *    with `CCQA_BASE` or `--base`).
 */
import { Command } from "commander";
import kleur from "kleur";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import type {
  Bug,
  CreateProjectRequest,
  Flow,
  Project,
  Run,
  RunEvent,
  RunStep,
} from "@ccqa/shared";

const base = process.env.CCQA_BASE ?? "http://127.0.0.1:4317";

/**
 * Locate the bundled web/ directory. When the CLI is published, the
 * web build sits next to the bundled cli at `<cli>/dist/web`. In a
 * fresh local checkout (running via tsx) it sits at
 * `<repo>/web/dist`. We try both.
 */
function findWebDist(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "web"),         // bundled: dist/web next to dist/index.js
    path.resolve(here, "..", "web"),   // bundled alt
    path.resolve(here, "..", "..", "web", "dist"), // workspace dev
    path.resolve(here, "..", "..", "..", "web", "dist"), // workspace dev (deeper)
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return undefined;
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${method} ${path} → ${r.status}: ${t}`);
  }
  if (r.status === 204) return undefined as any;
  return (await r.json()) as T;
}

const program = new Command();
program
  .name("ccqa")
  .description("LLM-driven QA harness CLI")
  .option("--base <url>", "server base URL", base);

program
  .command("health")
  .description("ping the server")
  .action(async () => {
    const r = await http<any>("GET", "/api/health");
    console.log(JSON.stringify(r, null, 2));
  });

program
  .command("serve")
  .description("start the embedded server (with bundled web UI)")
  .option("--port <n>", "port to listen on", String(4317))
  .option("--host <h>", "host to bind", "127.0.0.1")
  .option("--no-open", "don't try to open the browser")
  .option(
    "--web-dist <path>",
    "override the web build directory (defaults to the bundled one)"
  )
  .action(async (opts) => {
    // Imported lazily so the (much smaller) client-only commands don't
    // pay the cost of loading fastify / better-sqlite3 / etc.
    const { startServer } = await import("@ccqa/server");
    const webDist = opts.webDist ?? findWebDist();
    if (!webDist) {
      console.warn(
        kleur.yellow(
          "warning: could not locate bundled web; UI will be unavailable. " +
            "Use --web-dist to point at a built web/ dist."
        )
      );
    }
    await startServer({
      port: Number(opts.port),
      host: opts.host,
      webDist,
    });
    const url = `http://${opts.host}:${opts.port}`;
    console.log(kleur.green("CCQA running at"), kleur.cyan(url));
    if (opts.open !== false && webDist) {
      void openInBrowser(url);
    }
  });

async function openInBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "explorer"
      : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // Best-effort; never crash the CLI on a browser-launch failure.
  }
}

const project = program.command("project").description("manage projects");

project
  .command("list")
  .description("list projects")
  .action(async () => {
    const list = await http<Project[]>("GET", "/api/projects");
    for (const p of list) {
      console.log(
        `${kleur.cyan(p.id)} ${kleur.bold(p.name)}  ${kleur.gray(
          p.coder + " · " + p.repos.length + " repos"
        )}`
      );
    }
  });

project
  .command("show <id>")
  .description("show a project")
  .action(async (id: string) => {
    const p = await http<Project>("GET", `/api/projects/${id}`);
    console.log(JSON.stringify(p, null, 2));
  });

project
  .command("new")
  .requiredOption("--name <name>", "project name")
  .option(
    "--repo <url...>",
    "git repo URLs (optional `<url>#<ref>`); use --path for local dirs"
  )
  .option(
    "--path <dir...>",
    "local directories to test against (no clone)"
  )
  .option(
    "--coder <kind>",
    "coder kind: claude-code | codex | kimi",
    "claude-code"
  )
  .option("--flow <text>", "main flow text (or pass --flow-file)")
  .option("--flow-file <path>", "read main flow text from a file")
  .option("--notes <text>", "free-form project notes")
  .action(async (opts) => {
    const gitRepos = (opts.repo ?? []).map((line: string) => {
      const [url, ref] = line.split("#");
      return ref
        ? { url, ref, kind: "git" as const }
        : { url, kind: "git" as const };
    });
    const localRepos = (opts.path ?? []).map((p: string) => ({
      url: p,
      kind: "local" as const,
    }));
    const repos = [...gitRepos, ...localRepos];
    const mainFlowText = opts.flowFile
      ? fs.readFileSync(opts.flowFile, "utf8")
      : opts.flow;
    const body: CreateProjectRequest = {
      name: opts.name,
      coder: opts.coder,
      repos,
      mainFlowText,
      notes: opts.notes,
    };
    const created = await http<Project>("POST", "/api/projects", body);
    console.log(kleur.green("created"), kleur.cyan(created.id));
  });

project
  .command("clone <id>")
  .description("clone / refresh repos for a project")
  .action(async (id: string) => {
    const r = await http<{ repos: any[] }>("POST", `/api/projects/${id}/clone`);
    for (const x of r.repos) {
      const status = x.status === "ok" ? kleur.green("ok") : kleur.red(x.status);
      console.log(`${status}  ${x.url} → ${x.localPath}`);
    }
  });

const flow = program.command("flow").description("flow design");

flow
  .command("generate <projectId>")
  .description("generate a flow from main flow text")
  .option("--text <s>", "override the project's main flow text")
  .option("--file <p>", "read main flow text from a file")
  .action(async (projectId: string, opts) => {
    const text = opts.file ? fs.readFileSync(opts.file, "utf8") : opts.text;
    const f = await http<Flow>(
      "POST",
      `/api/projects/${projectId}/flow/generate`,
      { mainFlowText: text }
    );
    printFlow(f);
  });

flow
  .command("show <projectId>")
  .description("print the current flow")
  .action(async (id) => printFlow(await http<Flow>("GET", `/api/projects/${id}/flow`)));

flow
  .command("edit <projectId>")
  .description("edit the flow with a natural-language instruction")
  .requiredOption("--instruction <s>", "what to change")
  .action(async (projectId: string, opts) => {
    const r = await http<{ flow: Flow; summary: string }>(
      "POST",
      `/api/projects/${projectId}/flow/edit`,
      { instruction: opts.instruction }
    );
    console.log(kleur.gray("summary:"), r.summary);
    printFlow(r.flow);
  });

const run = program.command("run").description("test runs");

run
  .command("start <projectId>")
  .description("start a run and stream events")
  .option("--coder <kind>", "override coder")
  .option("--no-follow", "don't stream; just print the run id")
  .action(async (projectId: string, opts) => {
    const r = await http<Run>("POST", `/api/projects/${projectId}/runs`, {
      coder: opts.coder,
    });
    console.log(kleur.green("started"), kleur.cyan(r.id));
    if (opts.follow !== false) await follow(r.id);
  });

run
  .command("follow <runId>")
  .description("stream events for a run")
  .action(follow);

run
  .command("show <runId>")
  .description("show run status, steps, bugs")
  .action(async (id: string) => {
    const r = await http<{ run: Run; steps: RunStep[]; bugs: Bug[] }>(
      "GET",
      `/api/runs/${id}`
    );
    console.log(kleur.bold("run"), r.run.id, kleur.gray("·"), r.run.status);
    for (const s of r.steps) {
      console.log(
        `  ${statusColor(s.status)(s.status.padEnd(8))} ${s.title}`
      );
      if (s.judgement) console.log(kleur.gray(`     ${s.judgement}`));
    }
    if (r.bugs.length) console.log(kleur.bold("bugs:"));
    for (const b of r.bugs) {
      console.log(
        `  ${b.blocking ? kleur.red("✱") : "·"} [${b.severity}] ${b.title}`
      );
    }
    if (r.run.report) {
      console.log("\n" + kleur.bold("report:") + "\n" + r.run.report);
    }
  });

run
  .command("cancel <runId>")
  .description("cancel a running run")
  .action(async (id: string) => {
    const r = await http<{ cancelled: boolean }>(
      "POST",
      `/api/runs/${id}/cancel`
    );
    console.log(r.cancelled ? kleur.yellow("cancelled") : "not running");
  });

run
  .command("ask <projectId>")
  .description("interactive: prompt + start + stream a run from this terminal")
  .action(async (projectId: string) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q: string) =>
      new Promise<string>((resolve) => rl.question(q, resolve));
    const text = await ask("Main flow (single line; ⏎ to keep current): ");
    if (text.trim()) {
      const f = await http<Flow>(
        "POST",
        `/api/projects/${projectId}/flow/generate`,
        { mainFlowText: text }
      );
      printFlow(f);
    }
    const go = await ask("Start run now? [Y/n] ");
    rl.close();
    if (/^n/i.test(go.trim())) return;
    const r = await http<Run>("POST", `/api/projects/${projectId}/runs`, {});
    console.log(kleur.green("started"), kleur.cyan(r.id));
    await follow(r.id);
  });

async function follow(runId: string) {
  const proto = base.startsWith("https") ? "wss" : "ws";
  const wsBase = base.replace(/^http/, "ws");
  const WebSocketImpl: any = (globalThis as any).WebSocket;
  if (!WebSocketImpl) {
    throw new Error("Node 22+ has built-in WebSocket; please upgrade Node.");
  }
  const url = `${wsBase}/api/runs/${runId}/stream`;
  const ws = new WebSocketImpl(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e: any) => reject(e), { once: true });
  });
  await new Promise<void>((resolve) => {
    ws.addEventListener("message", (m: MessageEvent) => {
      try {
        const e: RunEvent = JSON.parse(m.data as string);
        printEvent(e);
        if (e.type === "run.finished" || e.type === "run.error") {
          setTimeout(() => {
            ws.close();
            resolve();
          }, 200);
        }
      } catch {}
    });
    ws.addEventListener("close", () => resolve(), { once: true });
  });
}

function printEvent(e: RunEvent) {
  const ts = new Date(e.ts).toLocaleTimeString();
  const p = e.payload as any;
  const c = e.type.startsWith("bug")
    ? kleur.red
    : e.type.startsWith("step.finished")
    ? statusColor(p.status)
    : e.type.startsWith("step")
    ? kleur.cyan
    : e.type.startsWith("agent.tool")
    ? kleur.green
    : kleur.gray;
  let body = "";
  if (e.type === "agent.text") body = String(p.text ?? "").slice(0, 240);
  else if (e.type === "agent.tool_use") body = `${p.tool} ${p.preview ?? ""}`;
  else if (e.type === "agent.tool_result") body = String(p.preview ?? "").slice(0, 240);
  else if (e.type === "step.started") body = `→ ${p.title}`;
  else if (e.type === "step.finished")
    body = `${p.status} — ${p.reason ?? ""}`;
  else if (e.type === "bug.found")
    body = `${p.severity}${p.blocking ? "/blocking" : ""}: ${p.title}`;
  else if (e.type === "run.finished")
    body = `report: \n\n${p.report ?? ""}`;
  else body = JSON.stringify(p).slice(0, 240);
  console.log(`${kleur.gray(ts)} ${c(e.type.padEnd(20))} ${body}`);
}

function statusColor(s: string) {
  if (s === "passed") return kleur.green;
  if (s === "failed") return kleur.red;
  if (s === "blocked") return kleur.magenta;
  if (s === "skipped") return kleur.gray;
  if (s === "running") return kleur.yellow;
  return kleur.white;
}

function printFlow(f: Flow) {
  console.log(kleur.bold("Flow"), kleur.gray(`(${f.nodes.length} nodes)`));
  if (f.overallGoal) console.log(kleur.gray("goal: ") + f.overallGoal);
  if (f.expectedOutcome) console.log(kleur.gray("expected: ") + f.expectedOutcome);
  for (const n of f.nodes) {
    if (n.kind === "start" || n.kind === "end") continue;
    console.log(`\n  ${kleur.cyan(n.title)}`);
    if (n.description) console.log("    " + n.description);
    if (n.testPoints?.length)
      console.log(
        kleur.gray("    points: ") + n.testPoints.join("; ")
      );
    if (n.successCriteria)
      console.log(kleur.gray("    pass-when: ") + n.successCriteria);
  }
  if (f.sideItems.length) {
    console.log("\n" + kleur.bold("Notes & configs"));
    for (const s of f.sideItems) {
      console.log(`  · [${s.kind}] ${s.title}`);
      if (s.description) console.log("    " + kleur.gray(s.description));
    }
  }
}

program.parseAsync(process.argv).catch((e) => {
  console.error(kleur.red("error: "), e?.message ?? e);
  process.exit(1);
});
