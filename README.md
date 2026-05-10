# CCQA — LLM-driven QA harness

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-339933)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange)

A standalone tool that drives **Claude Code** / **Codex** / Kimi to test
your projects from a natural-language description, the way you'd hand
a tester a sticky note. You set up a project once (a name, some git
repos, a free-form description of the test flow), CCQA turns that into
a structured flow with steps and success criteria, then a coder agent
walks the flow while reading code only, judging each step, and
recording bugs. At the end you get a markdown report.

The harness is **read-only** — the agents can grep the cloned repos,
run linters / curl APIs / ssh into staging, but never `Write`, `Edit`,
or commit code.

> **Status: alpha.** Smoke-tested locally end-to-end (project create →
> flow generate → flow edit via dialogue → run → cancel → report).
> No automated test suite yet. Expect rough edges — see
> [issues](../../issues) and PRs welcome.

## Screenshots

**1. Project setup** — paste git repos, pick a coder, write the test flow in plain language.

![Projects page](docs/screenshot-projects.png)

**2. Flow designer** — the LLM turns your description into a structured flow. Drag nodes, edit them inline, or chat with the flow ("split step 2 into two steps", "add a config note about ANTHROPIC_API_KEY"). Off-flow notes/configs live in the side list.

![Flow designer](docs/screenshot-flow.png)

**3. Live run** — each node lights up as the coder agent works on it. The right panel streams agent text / tool calls / judge verdicts in real time, and the markdown report appears at the end.

![Run live view](docs/screenshot-run.png)

> Per the design directive: **wherever an LLM can decide, an LLM
> decides.** Step success, bug severity, blocking-vs-not, branch
> selection, flow generation, flow edits, report writing — none of it
> is hard-coded. The harness is a coordinator; the LLM is the brain.

## Repo layout

| Package | Purpose |
| --- | --- |
| [shared/](shared/) | Cross-package types (Project / Flow / Run / Bug / Event). |
| [server/](server/) | Fastify + SQLite, hosts the API, runs the executor, streams events over WebSocket. |
| [web/](web/) | React + ReactFlow UI: project setup, flow canvas, live run view, chat-based flow editor. |
| [cli/](cli/) | `ccqa` CLI for headless workflows. |
| [data/](data/) | SQLite + cloned repos + transcripts. Gitignored. |

## Requirements

- Node ≥ 20
- `claude` CLI signed in (the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) drives Claude Code via the same auth)
- `git` on your `$PATH`
- Optional: `codex` CLI signed in if you want the Codex coder
- An `ANTHROPIC_API_KEY` for the small "supervisor" calls (flow generation, judge, report writer)

## Setup

```bash
npm install
cp .env.example .env  # then fill in ANTHROPIC_API_KEY
```

Minimum env (`.env` in repo root):

```bash
ANTHROPIC_API_KEY=sk-ant-...
# CCQA_PORT=4317
# CCQA_HOST=127.0.0.1
# CCQA_DEFAULT_CODER=claude-code   # claude-code | codex | kimi
# CCQA_JUDGE_MODEL=claude-sonnet-4-6
# CCQA_CODEX_CLI=codex
```

## Run

Two terminals:

```bash
# 1) backend  (port 4317)
npm run dev:server

# 2) web UI  (port 4318)
npm run dev:web
```

Then open <http://127.0.0.1:4318>. Or use the CLI:

```bash
npm run cli -- health
npm run cli -- project new \
  --name "rey-early" \
  --coder claude-code \
  --repo https://github.com/your-org/your-repo \
  --flow-file ./flow.txt \
  --notes "ssh creds in 1Password / aws --profile early"
npm run cli -- project clone <id>
npm run cli -- flow generate <id>
npm run cli -- run start <id>           # streams events to your terminal
```

## How it works

```
┌─────────┐   "main flow text"     ┌─────────────────┐
│  user   │ ─────────────────────▶ │ flow generator  │  (LLM)
└─────────┘                        └────────┬────────┘
                                            ▼
              ┌─────────── structured Flow (nodes/edges/notes) ─────────┐
              │   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐        │
              │   │ start  ├─▶│ step 1 ├─▶│ step 2 ├─▶│  end   │        │
              │   └────────┘  └────────┘  └────────┘  └────────┘        │
              │                                                         │
              │  side notes / configs (off-flow list)                   │
              └─────────────────────────────────────────────────────────┘
                                            │
                                  ┌─────────┴──────────┐
                                  │   flow executor    │
                                  └─────────┬──────────┘
                                            ▼
              ┌─────────────────────────────────────────────────────────┐
              │  for each step:                                         │
              │   1. coder.run({ cwd, prompt: step, read-only })        │
              │      Claude Code / Codex streams text + tool calls.     │
              │   2. judge LLM reads transcript → pass/fail + bugs.     │
              │   3. blocking bug? → stop early. otherwise continue.    │
              └─────────────────────────────────────────────────────────┘
                                            │
                                            ▼
                            report writer LLM → markdown
```

### Flow generation
[server/src/flow/generate.ts](server/src/flow/generate.ts) hands the user's free-form text plus the
project's repos to an LLM and asks for `{overall_goal, expected_outcome,
steps[], notes[]}`. Steps become canvas nodes, notes become the off-flow
list rendered to the right.

### Flow editing via dialogue
[server/src/flow/edit.ts](server/src/flow/edit.ts). The user types "split step 3 into two
steps" or "add a config note about ANTHROPIC_API_KEY", we hand the LLM
the current flow JSON + the instruction, and it returns the *complete*
new flow plus a one-line summary for the chat panel.

### Coder adapters
[server/src/coders/](server/src/coders/) wraps each agent behind a uniform `Coder` interface
that yields `CoderEvent`s and returns a final summary. Read-only is
enforced via `disallowedTools = ["Write", "Edit", "NotebookEdit"]` (Claude
Code) and `--sandbox read-only` (Codex). The system prompt also restates
the rule.

### Judge
[server/src/flow/judge.ts](server/src/flow/judge.ts). After every step, the agent's transcript +
the step's success criteria are handed to a judge LLM. The judge returns
`{passed, status, reason, bugs[]}`. Each bug carries an LLM-decided
severity *and* an LLM-decided `blocking` flag — non-blocking bugs are
recorded and the run continues, blocking bugs stop it.

### Live UI
The flow canvas is React Flow. Each node listens for the run's
`step.started` / `step.finished` events over WebSocket
([web/src/pages/Run.tsx](web/src/pages/Run.tsx)). The right panel streams the agent's
text / tool_use / tool_result lines as they happen, so you see what the
agent is *currently looking at* mid-step. When the run ends, the
markdown report shows up under the activity log.

### Sample main-flow text

The system was built around prompts like the ones you used to paste
into Cursor — long natural-language test scripts with prerequisites,
edge cases, and gotchas. Drop the same text into the **Main flow text**
field and click **Generate flow**. The LLM will:

- pull setup work into "config" notes (ssh creds, AWS account hints,
  archive-delete prerequisites, etc.)
- create one flow node per logical phase ("clean prior installs",
  "install hi via openclaw", "register 6 users", "exchange listings",
  "verify zoom link is real, not hallucinated", "stress test", …)
- copy your "重点测的核心点" into each node's `testPoints`
- copy your success language into each node's `successCriteria`

Then click **Run tests** and watch each node light up.

## Notes & limits

- **Branching:** the executor walks topologically by default. When a
  node has multiple outgoing edges, it asks the judge LLM to pick the
  branch given the just-finished transcript. Loops aren't first-class
  yet — model retries by repeating a step description.
- **Cancellation:** the **Stop** button (web) and `ccqa run cancel`
  (CLI) abort the current coder turn via `AbortController`. The judge
  still runs on the partial transcript so you don't lose context.
- **Resumes:** runs are immutable. Re-run from the project page.
- **Cost:** every step costs (a) the coder's tokens for investigation
  and (b) one judge LLM call. The report adds one more. Coder usage
  shows up in the run's `usage` field if the SDK reports it.

## Adding a new coder

Implement `Coder` in [server/src/coders/](server/src/coders/) (see [claudeCode.ts](server/src/coders/claudeCode.ts)
or [codex.ts](server/src/coders/codex.ts) as templates), wire it into
[index.ts](server/src/coders/index.ts), and add the option to the web's
project form + CLI's `--coder` choices. The executor doesn't care which
coder you used — it just consumes the event stream.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local-dev tips, the layout
of each package, and conventions for adding adapters / supervisor
prompts.

## License

[MIT](LICENSE)
