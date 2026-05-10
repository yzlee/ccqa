# Contributing to CCQA

Thanks for your interest! CCQA is alpha-stage software — issues and PRs
are very welcome, especially for new coder adapters, prompt
improvements, and UI fixes.

## Local setup

```bash
git clone <your-fork>
cd ccqa
npm install
cp .env.example .env  # ANTHROPIC_API_KEY is optional;
                      # if unset, supervisor calls fall back to your
                      # signed-in `claude` CLI via OAuth.
```

Two terminals:

```bash
npm run dev:server   # http://127.0.0.1:4317
npm run dev:web      # http://127.0.0.1:4318  (proxies /api → server)
```

Or headless via the CLI:

```bash
npm run cli -- health
npm run cli -- project new --name demo --repo https://github.com/owner/repo --flow-file ./flow.txt
npm run cli -- run start <projectId>
```

## Repo layout

| Path | What lives here |
| --- | --- |
| [shared/](shared/) | TypeScript types shared across server/web/cli. No runtime logic. |
| [server/](server/) | Fastify + better-sqlite3. SQLite schema in [server/src/db/schema.ts](server/src/db/schema.ts), CRUD helpers in [server/src/db/repo.ts](server/src/db/repo.ts). |
| [server/src/coders/](server/src/coders/) | Adapters that wrap each coder (Claude Code, Codex, ...). Adding a new one means: implement the `Coder` interface, register in [coders/index.ts](server/src/coders/index.ts), add the option to the web form + CLI flag. |
| [server/src/flow/](server/src/flow/) | Supervisor LLM logic: `generate.ts`, `edit.ts`, `judge.ts`, `report.ts`, plus the `execute.ts` walker. Anything that asks an LLM to *decide* something lives here. |
| [server/src/llm/](server/src/llm/) | Thin Anthropic wrapper with `claude -p` fallback. |
| [web/](web/) | React + Vite + ReactFlow + Tailwind. Pages in `src/pages`, the canvas in `src/components/FlowCanvas.tsx`. |
| [cli/](cli/) | Commander-based CLI. Talks to the running server via HTTP/WebSocket. |

## Conventions

- **LLM-decides over hard rules.** Anywhere you're tempted to write
  regex, threshold-based pass/fail, severity heuristics, or branch-
  selection logic — let the LLM decide instead. CCQA's value comes from
  not encoding those judgements. Hard logic is reserved for graph
  topology, persistence, transport, and abort handling.
- **Read-only is non-negotiable.** New coders MUST disallow
  `Write`/`Edit`/`NotebookEdit` (or the vendor's equivalent) and warn
  about it in their adapter's preamble. The repo under test is
  production-grade artifact; CCQA never mutates it.
- **Tolerate sloppy LLM JSON.** Defensive defaults at every JSON
  boundary — missing fields, wrong shapes, plain strings instead of
  objects — must not crash a flow. See the existing fixes in
  [`flow/generate.ts`](server/src/flow/generate.ts) and
  [`flow/edit.ts`](server/src/flow/edit.ts) for examples.
- **Keep events generic.** Don't add typed event variants for every
  vendor — yield free-form `CoderEvent`s with a `kind` string. Both the
  judge LLM and the UI consume them as opaque transcript.

## Adding a new coder

1. Create `server/src/coders/<name>.ts` exporting a class implementing
   the `Coder` interface ([types.ts](server/src/coders/types.ts)).
2. In your `run()` method:
   - Set `cwd` from the request.
   - Inject a read-only system preamble (copy from `claudeCode.ts`).
   - Stream the vendor's events into `onEvent({ kind, text, tool, raw })`.
   - On termination, return `{ finalText, usage? }`.
   - Honor `req.signal` for cancellation.
3. Register in [coders/index.ts](server/src/coders/index.ts) and add
   the kind to the `CoderKind` union in [shared/src/index.ts](shared/src/index.ts).
4. Add it to the web form's `<select>` and the CLI's `--coder`
   choices.
5. Smoke-test by creating a project with `--coder <name>` and a flow
   that exercises Read / Bash / cancel.

## Adjusting supervisor prompts

The flow-generator, judge, dialogue editor, and report writer all live
under `server/src/flow/`. When tweaking prompts:

- Run a real project before/after — token counts and judgements drift
  surprisingly fast under prompt changes.
- Keep `success_criteria` framed as **what a careful reviewer would
  say**, not as code or regex. The judge has to read the agent's
  transcript and compare against it.
- Don't bake schemas the LLM "must" follow — keep validation defensive
  on our side.

## Recording a demo

The screenshots in `docs/` were captured with Chrome headless against
the running dev server:

```bash
# In one terminal:
npm run dev:server
# In another:
npm run dev:web
# In a third (assumes a project + run already exist):
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1600,1000 --virtual-time-budget=10000 \
  --screenshot=docs/screenshot-flow.png \
  "http://127.0.0.1:4318/projects/<PROJECT_ID>/flow"
```

Demo GIFs are not checked in. If you want one, the easiest path is
[`vhs`](https://github.com/charmbracelet/vhs):

```bash
brew install vhs
# Write a .tape script that drives the CLI, then:
vhs demo.tape    # outputs demo.gif
```

For terminal recordings, [`asciinema`](https://asciinema.org) is the
lightweight option (`brew install asciinema`).

## Releasing

`@ccqa/cli` is the only published package. Release flow:

1. Bump the version in `cli/package.json` (and ideally `package.json`,
   `shared/package.json`, `server/package.json`, `web/package.json` so
   git history matches).
2. Commit: `git commit -am "release v0.1.1"`
3. Tag: `git tag v0.1.1 && git push --follow-tags`
4. The [release workflow](.github/workflows/release.yml) verifies the
   tag matches `cli/package.json`'s version, runs typecheck + build,
   then `npm publish --provenance --access public`. It also opens a
   GitHub Release with auto-generated notes.

The workflow needs an `NPM_TOKEN` secret on the repo (Settings →
Secrets → Actions → "New repository secret"). Generate one at
<https://www.npmjs.com/settings/~/tokens> with **Automation** type so
it bypasses 2FA. Provenance is opt-in but recommended.

To publish manually instead:

```bash
npm --workspace cli run build
cd cli && npm publish --access public
```

## Filing bugs

Useful info to include:
- Coder kind (claude-code / codex / kimi)
- Whether ANTHROPIC_API_KEY was set or you were on the `claude -p`
  fallback
- A run id (if you have one), and the relevant tail of `data/runs/<id>/transcript.log`
- The free-form main flow text you fed it (redact anything sensitive)
