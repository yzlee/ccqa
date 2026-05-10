/**
 * Build the publishable @ccqa/cli package.
 *
 * Produces:
 *   dist/index.js   — bundled CLI + server (workspace code inlined,
 *                     runtime deps externalized so npm resolves them).
 *   dist/web/*      — built web UI, served by `ccqa serve`.
 *
 * Why bundle?
 *   The CLI imports from @ccqa/server which imports from @ccqa/shared.
 *   At publish time those scopes don't resolve via npm — the only
 *   published package is @ccqa/cli. tsup follows the workspace
 *   symlinks, inlines the source, and emits a single entry file. Real
 *   runtime deps (fastify, better-sqlite3, ...) stay external so they
 *   come from the user's node_modules — important for native modules
 *   like better-sqlite3.
 */
import { build } from "tsup";
import { readFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliDir = here;
const repoRoot = path.resolve(here, "..");
const cliDist = path.join(cliDir, "dist");
const webDist = path.join(repoRoot, "web", "dist");

const pkg = JSON.parse(await readFile(path.join(cliDir, "package.json"), "utf8"));

// Externalize anything declared in `dependencies`. Workspace deps
// (declared as devDependencies because they're inlined here) get
// bundled.
const external = Object.keys(pkg.dependencies ?? {});

console.log("clean dist/");
await rm(cliDist, { recursive: true, force: true });
await mkdir(cliDist, { recursive: true });

console.log("build web/");
execSync("npm --workspace web run build", { stdio: "inherit", cwd: repoRoot });
if (!existsSync(path.join(webDist, "index.html"))) {
  throw new Error(`web build did not produce ${webDist}/index.html`);
}

console.log("copy web/ → cli/dist/web/");
await cp(webDist, path.join(cliDist, "web"), { recursive: true });

console.log("bundle cli + server (tsup)");
await build({
  entry: { index: path.join(cliDir, "src", "index.ts") },
  outDir: cliDist,
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  clean: false,
  shims: false,
  // The source file already starts with a shebang; tsup preserves it.
  external,
  noExternal: [/^@ccqa\//],
  // Don't emit .d.ts — this is a runtime CLI, not a library.
  dts: false,
  silent: true,
});

console.log("copy README + LICENSE into cli/ for the npm page");
await cp(
  path.join(repoRoot, "README.md"),
  path.join(cliDir, "README.md")
);
await cp(
  path.join(repoRoot, "LICENSE"),
  path.join(cliDir, "LICENSE")
);

console.log("done. Artifacts in cli/dist/");
