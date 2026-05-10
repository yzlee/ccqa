import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function ProjectsPage() {
  const qc = useQueryClient();
  const { data: list } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const [name, setName] = useState("");
  const [reposText, setReposText] = useState("");
  const [pathsText, setPathsText] = useState("");
  const [coder, setCoder] = useState<"claude-code" | "codex" | "kimi">(
    "claude-code"
  );
  const [mainFlowText, setMainFlowText] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const gitRepos = reposText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const [url, ref] = line.split(/\s+/);
          return ref
            ? { url, ref, kind: "git" as const }
            : { url, kind: "git" as const };
        });
      const localRepos = pathsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => ({ url: p, kind: "local" as const }));
      return api.createProject({
        name,
        coder,
        mainFlowText,
        notes,
        repos: [...gitRepos, ...localRepos],
      });
    },
    onSuccess: () => {
      setName("");
      setReposText("");
      setPathsText("");
      setMainFlowText("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <div className="max-w-screen-2xl mx-auto px-5 py-6 grid grid-cols-12 gap-6">
      <section className="col-span-7">
        <h1 className="text-xl font-semibold mb-4">Projects</h1>
        <div className="space-y-2">
          {(list ?? []).map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="block rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-zinc-500">
                  {p.coder} · {p.repos.length} repo
                  {p.repos.length === 1 ? "" : "s"}
                </div>
              </div>
              {p.description && (
                <div className="text-sm text-zinc-400 mt-1">{p.description}</div>
              )}
              <div className="text-xs text-zinc-500 mt-2 truncate">
                {p.repos.map((r) => r.url).join("  ·  ") || "(no repos)"}
              </div>
            </Link>
          ))}
          {!list?.length && (
            <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
              No projects yet. Create one →
            </div>
          )}
        </div>
      </section>

      <aside className="col-span-5">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-semibold mb-3">New project</h2>
          <div className="space-y-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="my-product / e2e-flow"
              />
            </Field>
            <Field label="Git repos (one per line, optional `<url> <ref>`)">
              <textarea
                value={reposText}
                onChange={(e) => setReposText(e.target.value)}
                className="input h-20 font-mono text-xs"
                placeholder="https://github.com/owner/repo
https://github.com/owner/other main"
              />
            </Field>
            <Field label="Local folders (one path per line, no clone)">
              <textarea
                value={pathsText}
                onChange={(e) => setPathsText(e.target.value)}
                className="input h-20 font-mono text-xs"
                placeholder="/Users/me/code/my-project
~/work/another-checkout"
              />
            </Field>
            <Field label="Coder">
              <select
                value={coder}
                onChange={(e) => setCoder(e.target.value as any)}
                className="input"
              >
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="kimi">Kimi (placeholder)</option>
              </select>
            </Field>
            <Field label="Main flow (free-form)">
              <textarea
                value={mainFlowText}
                onChange={(e) => setMainFlowText(e.target.value)}
                className="input h-40"
                placeholder="Describe the main test flow in plain language: what the agent should do, in what order, what to look for…"
              />
            </Field>
            <Field label="Notes / configs (free-form)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input h-24"
                placeholder="Credential hints, environment quirks, gotchas — anything that should apply to every run."
              />
            </Field>
            <button
              disabled={!name || create.isPending}
              onClick={() => create.mutate()}
              className="btn-primary w-full"
            >
              {create.isPending ? "Creating…" : "Create project"}
            </button>
            {create.error && (
              <div className="text-xs text-red-400">
                {(create.error as Error).message}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-zinc-500 mt-3 px-1">
          The system clones repos read-only into <code>data/projects/&lt;id&gt;/repos</code>.
          The coder you pick can read them but never writes or commits.
        </p>
      </aside>

      <style>{`
        .input { width: 100%; background: #09090b; border: 1px solid #27272a; border-radius: 8px; padding: 8px 10px; color: #e4e4e7; outline: none; }
        .input:focus { border-color: #52525b; }
        .btn-primary { background: #4f46e5; color: white; border-radius: 8px; padding: 9px 12px; font-weight: 500; }
        .btn-primary:hover { background: #4338ca; }
        .btn-primary:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      {children}
    </label>
  );
}
