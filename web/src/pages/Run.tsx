import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../lib/api";
import { FlowCanvas } from "../components/FlowCanvas";
import type { RunEvent } from "@ccqa/shared";

export function RunPage() {
  const { runId } = useParams() as { runId: string };
  const runQ = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.getRun(runId),
    refetchInterval: 2000,
  });
  const flowQ = useQuery({
    queryKey: ["run-flow", runId],
    queryFn: async () => {
      const r = await api.getRun(runId);
      return api.getFlow(r.run.projectId);
    },
  });

  const [eventList, setEventList] = useState<RunEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setEventList([]);
    const ws = api.streamRun(runId, (e) =>
      setEventList((cur) => [...cur, e])
    );
    wsRef.current = ws;
    return () => ws.close();
  }, [runId]);

  // Build node-id → status map for the canvas.
  const statuses = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const s of runQ.data?.steps ?? []) m[s.nodeId] = s.status;
    return m;
  }, [runQ.data?.steps]);

  if (!runQ.data || !flowQ.data) {
    return <div className="p-6 text-zinc-400">Loading run…</div>;
  }
  const { run, steps, bugs } = runQ.data;
  const flow = flowQ.data;

  const tail = eventList.slice(-300);
  const finished = run.status !== "running" && run.status !== "queued";

  const cancel = async () => {
    await api.cancelRun(runId);
  };

  return (
    <div className="h-[calc(100vh-49px)] grid grid-cols-12">
      <div className="col-span-7 relative border-r border-zinc-800">
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <Link
            to={`/projects/${run.projectId}`}
            className="text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-900/80 backdrop-blur px-2 py-1 rounded"
          >
            ← project
          </Link>
          <span className="text-xs bg-zinc-900/80 px-2 py-1 rounded text-zinc-300">
            run <span className="font-mono">{run.id}</span> ·{" "}
            <span
              className={
                run.status === "passed"
                  ? "text-emerald-400"
                  : run.status === "failed"
                  ? "text-red-400"
                  : run.status === "running"
                  ? "text-amber-400"
                  : run.status === "cancelled"
                  ? "text-zinc-300"
                  : "text-zinc-300"
              }
            >
              {run.status}
            </span>
          </span>
          {!finished && (
            <button
              onClick={cancel}
              className="text-xs bg-red-600 hover:bg-red-500 text-white rounded px-3 py-1.5"
            >
              Stop
            </button>
          )}
        </div>
        <FlowCanvas flow={flow} statuses={statuses} />
      </div>

      <div className="col-span-5 flex flex-col min-h-0">
        <section className="border-b border-zinc-800 p-4">
          <h2 className="text-sm font-semibold mb-2">Steps</h2>
          <ul className="space-y-1 text-sm">
            {steps.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 border border-zinc-800 rounded p-2"
              >
                <div>
                  <div className="font-medium">{s.title}</div>
                  {s.judgement && (
                    <div className="text-xs text-zinc-400 mt-1">
                      {s.judgement}
                    </div>
                  )}
                </div>
                <span
                  className={`text-xs ${
                    s.status === "passed"
                      ? "text-emerald-400"
                      : s.status === "failed"
                      ? "text-red-400"
                      : s.status === "running"
                      ? "text-amber-400"
                      : s.status === "blocked"
                      ? "text-orange-400"
                      : "text-zinc-400"
                  }`}
                >
                  {s.status}
                </span>
              </li>
            ))}
            {!steps.length && (
              <li className="text-xs text-zinc-500">No steps yet…</li>
            )}
          </ul>
        </section>

        <section className="border-b border-zinc-800 p-4 max-h-[30vh] overflow-y-auto scroll-thin">
          <h2 className="text-sm font-semibold mb-2">Bugs</h2>
          {bugs.length === 0 && <div className="text-xs text-zinc-500">None.</div>}
          <ul className="space-y-2">
            {bugs.map((b) => (
              <li
                key={b.id}
                className={`rounded border p-2 ${
                  b.blocking
                    ? "border-red-600/60 bg-red-900/20"
                    : "border-zinc-800"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{b.title}</div>
                  <div className="text-xs">
                    <span
                      className={
                        b.severity === "critical" || b.severity === "high"
                          ? "text-red-400"
                          : b.severity === "medium"
                          ? "text-amber-400"
                          : "text-zinc-400"
                      }
                    >
                      {b.severity}
                    </span>
                    {b.blocking && (
                      <span className="ml-2 text-red-400">blocking</span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-zinc-300 mt-1 whitespace-pre-wrap">
                  {b.description}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex-1 min-h-0 p-4 overflow-y-auto scroll-thin">
          <h2 className="text-sm font-semibold mb-2">Live activity</h2>
          <div className="space-y-1 text-xs font-mono">
            {tail.map((e) => (
              <div key={e.id} className="flex gap-2">
                <span className="text-zinc-500 shrink-0">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
                <span
                  className={`shrink-0 ${
                    e.type.startsWith("bug")
                      ? "text-red-400"
                      : e.type.startsWith("step")
                      ? "text-indigo-300"
                      : e.type.startsWith("agent.tool")
                      ? "text-emerald-300"
                      : e.type.startsWith("agent.text")
                      ? "text-zinc-200"
                      : "text-zinc-400"
                  }`}
                >
                  {e.type}
                </span>
                <span className="text-zinc-300 truncate">
                  {summarize(e)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {run.report && (
          <section className="border-t border-zinc-800 p-4 max-h-[40vh] overflow-y-auto scroll-thin">
            <h2 className="text-sm font-semibold mb-2">Report</h2>
            <article className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{run.report}</ReactMarkdown>
            </article>
          </section>
        )}
      </div>
    </div>
  );
}

function summarize(e: RunEvent): string {
  const p = e.payload as any;
  if (e.type === "agent.text") return String(p.text ?? "").slice(0, 200);
  if (e.type === "agent.tool_use") return `${p.tool}: ${p.preview ?? ""}`.slice(0, 200);
  if (e.type === "agent.tool_result") return String(p.preview ?? "").slice(0, 200);
  if (e.type === "step.started") return `→ ${p.title}`;
  if (e.type === "step.finished") return `${p.status} — ${p.reason ?? ""}`.slice(0, 200);
  if (e.type === "bug.found") return `${p.severity}${p.blocking ? "/blocking" : ""}: ${p.title}`;
  return JSON.stringify(p).slice(0, 200);
}
