import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useState } from "react";

export function ProjectPage() {
  const { id } = useParams() as { id: string };
  const qc = useQueryClient();
  const nav = useNavigate();
  const proj = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
  });
  const runsQ = useQuery({
    queryKey: ["runs", id],
    queryFn: () => api.listRuns(id),
    refetchInterval: 5000,
  });
  const flowQ = useQuery({
    queryKey: ["flow", id],
    queryFn: () => api.getFlow(id),
  });

  const generate = useMutation({
    mutationFn: (text: string) => api.generateFlow(id, text || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flow", id] });
      nav(`/projects/${id}/flow`);
    },
  });
  const cloneM = useMutation({
    mutationFn: () => api.cloneRepos(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", id] }),
  });
  const startRun = useMutation({
    mutationFn: () => api.startRun(id),
    onSuccess: (run) => nav(`/runs/${run.id}`),
  });

  const [mainFlow, setMainFlow] = useState("");

  if (!proj.data) return <div className="p-6">Loading…</div>;
  const p = proj.data;
  const flowReady =
    !!flowQ.data && (flowQ.data.nodes?.length ?? 0) > 0;

  return (
    <div className="max-w-screen-2xl mx-auto px-5 py-6 grid grid-cols-12 gap-6">
      <section className="col-span-7 space-y-4">
        <div className="flex items-center gap-2">
          <Link to="/projects" className="text-zinc-500 hover:text-zinc-200 text-sm">
            ← Projects
          </Link>
        </div>
        <h1 className="text-xl font-semibold">{p.name}</h1>
        {p.description && <p className="text-zinc-400">{p.description}</p>}

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-sm font-semibold mb-2">Repos</div>
          <ul className="text-sm text-zinc-300 space-y-1">
            {p.repos.map((r, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate">
                  {r.url}
                  {r.ref ? ` @${r.ref}` : ""}
                </span>
                <span className="text-xs text-zinc-500">
                  {r.status ?? "pending"}
                  {r.error ? `: ${r.error.slice(0, 40)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => cloneM.mutate()}
              disabled={cloneM.isPending}
              className="btn"
            >
              {cloneM.isPending ? "Cloning…" : "Clone / refresh"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-sm font-semibold mb-2">Main flow text</div>
          <textarea
            defaultValue={p.mainFlowText ?? ""}
            onChange={(e) => setMainFlow(e.target.value)}
            className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded p-3 text-sm font-mono"
            placeholder="Describe the test flow in plain language…"
          />
          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              onClick={() => generate.mutate(mainFlow)}
              disabled={generate.isPending}
              className="btn-primary"
            >
              {generate.isPending
                ? "Generating…"
                : flowReady
                ? "Re-generate flow"
                : "Generate flow"}
            </button>
            {flowReady && (
              <Link to={`/projects/${id}/flow`} className="btn">
                Open flow designer
              </Link>
            )}
            <button
              onClick={() => startRun.mutate()}
              disabled={!flowReady || startRun.isPending}
              className="btn-success"
            >
              {startRun.isPending ? "Starting…" : "Run tests"}
            </button>
          </div>
          {generate.error && (
            <div className="text-xs text-red-400 mt-2">
              {(generate.error as Error).message}
            </div>
          )}
        </div>
      </section>

      <aside className="col-span-5 space-y-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-sm font-semibold mb-2">Recent runs</div>
          <ul className="space-y-1 text-sm">
            {(runsQ.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <Link
                  to={`/runs/${r.id}`}
                  className="text-indigo-300 hover:text-indigo-200 font-mono text-xs"
                >
                  {r.id}
                </Link>
                <span
                  className={`text-xs ${
                    r.status === "passed"
                      ? "text-emerald-400"
                      : r.status === "failed"
                      ? "text-red-400"
                      : r.status === "running"
                      ? "text-amber-400"
                      : "text-zinc-400"
                  }`}
                >
                  {r.status}
                </span>
              </li>
            ))}
            {!runsQ.data?.length && (
              <li className="text-xs text-zinc-500">No runs yet.</li>
            )}
          </ul>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm">
          <div className="font-semibold mb-2">Project info</div>
          <div className="text-zinc-400">Coder: {p.coder}</div>
          <div className="text-zinc-400 mt-1">Created: {new Date(p.createdAt).toLocaleString()}</div>
          {p.notes && (
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap mt-3 bg-zinc-950 border border-zinc-800 rounded p-3">{p.notes}</pre>
          )}
        </div>
      </aside>

      <style>{`
        .btn { background: #27272a; color: #e4e4e7; border-radius: 8px; padding: 8px 12px; font-size: 13px; border: 1px solid #3f3f46; }
        .btn:hover { background: #3f3f46; }
        .btn:disabled { opacity: 0.5; }
        .btn-primary { background: #4f46e5; color: white; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
        .btn-primary:hover { background: #4338ca; }
        .btn-primary:disabled { opacity: 0.5; }
        .btn-success { background: #059669; color: white; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
        .btn-success:hover { background: #047857; }
        .btn-success:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
}
