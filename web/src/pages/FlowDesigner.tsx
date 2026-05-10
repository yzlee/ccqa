import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { FlowCanvas } from "../components/FlowCanvas";
import { useEffect, useMemo, useState } from "react";
import type { Flow, FlowNode } from "@ccqa/shared";

export function FlowDesignerPage() {
  const { id } = useParams() as { id: string };
  const qc = useQueryClient();
  const nav = useNavigate();
  const projectQ = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
  });
  const flowQ = useQuery({
    queryKey: ["flow", id],
    queryFn: () => api.getFlow(id),
  });
  const chatQ = useQuery({
    queryKey: ["flow-chat", id],
    queryFn: () => api.getFlowChat(id),
  });

  const [selected, setSelected] = useState<string | null>(null);

  const editM = useMutation({
    mutationFn: (instruction: string) => api.editFlow(id, instruction),
    onSuccess: (res) => {
      qc.setQueryData(["flow", id], res.flow);
      qc.setQueryData(["flow-chat", id], res.chat);
    },
  });
  const saveM = useMutation({
    mutationFn: (flow: Flow) => api.putFlow(id, flow),
    onSuccess: (flow) => qc.setQueryData(["flow", id], flow),
  });
  const startRun = useMutation({
    mutationFn: () => api.startRun(id),
    onSuccess: (run) => nav(`/runs/${run.id}`),
  });

  const [instruction, setInstruction] = useState("");
  const flow = flowQ.data;
  const proj = projectQ.data;

  // NOTE: every hook MUST be called before the early-return below, or
  // React throws "Rendered more hooks than during the previous render"
  // when the queries flip from pending to resolved.
  const selectedNode = useMemo<FlowNode | null>(() => {
    if (!selected || !flow) return null;
    return (
      flow.nodes.find((n) => n.id === selected) ??
      flow.sideItems.find((s) => s.id === selected) ??
      null
    );
  }, [selected, flow]);

  if (!flow || !proj)
    return <div className="p-6 text-zinc-400">Loading flow…</div>;

  return (
    <div className="h-[calc(100vh-49px)] grid grid-cols-12">
      <div className="col-span-7 relative border-r border-zinc-800">
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <Link
            to={`/projects/${id}`}
            className="text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-900/80 backdrop-blur px-2 py-1 rounded"
          >
            ← {proj.name}
          </Link>
          <button
            onClick={() => startRun.mutate()}
            className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded px-3 py-1.5"
          >
            {startRun.isPending ? "Starting…" : "Run tests"}
          </button>
        </div>
        <FlowCanvas
          flow={flow}
          selectedNodeId={selected ?? undefined}
          onSelectNode={setSelected}
          onLayoutChange={(positions) => {
            const next: Flow = {
              ...flow,
              nodes: flow.nodes.map((n) =>
                positions[n.id] ? { ...n, position: positions[n.id] } : n
              ),
              updatedAt: new Date().toISOString(),
            };
            saveM.mutate(next);
          }}
        />
      </div>

      <div className="col-span-5 flex flex-col min-h-0">
        <section className="border-b border-zinc-800 p-4 max-h-[40vh] overflow-y-auto scroll-thin">
          <h2 className="text-sm font-semibold mb-2">
            Goal & expected outcome
          </h2>
          <div className="text-sm text-zinc-300">
            <div>
              <span className="text-zinc-500">Goal: </span>
              {flow.overallGoal ?? "(none)"}
            </div>
            <div className="mt-1">
              <span className="text-zinc-500">Expected: </span>
              {flow.expectedOutcome ?? "(none)"}
            </div>
          </div>

          <h2 className="text-sm font-semibold mt-4 mb-2">
            Notes & configs
          </h2>
          <ul className="space-y-2">
            {flow.sideItems.map((s) => (
              <li
                key={s.id}
                className="rounded border border-zinc-800 p-2 cursor-pointer hover:border-zinc-700"
                onClick={() => setSelected(s.id)}
              >
                <div className="text-xs uppercase tracking-wider text-zinc-500">
                  {s.kind}
                </div>
                <div className="text-sm font-medium">{s.title}</div>
                {s.description && (
                  <div className="text-xs text-zinc-400 mt-1 line-clamp-3">
                    {s.description}
                  </div>
                )}
              </li>
            ))}
            {!flow.sideItems.length && (
              <li className="text-xs text-zinc-500">(no side notes)</li>
            )}
          </ul>
        </section>

        <section className="border-b border-zinc-800 p-4 overflow-y-auto scroll-thin max-h-[35vh]">
          <h2 className="text-sm font-semibold mb-2">Selected step</h2>
          {selectedNode ? (
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-zinc-500">Title: </span>
                {selectedNode.title}
              </div>
              <div>
                <span className="text-zinc-500">Kind: </span>
                {selectedNode.kind}
              </div>
              {selectedNode.description && (
                <div>
                  <span className="text-zinc-500">Description: </span>
                  {selectedNode.description}
                </div>
              )}
              {selectedNode.testPoints?.length ? (
                <div>
                  <div className="text-zinc-500">Test points:</div>
                  <ul className="list-disc list-inside text-zinc-300">
                    {selectedNode.testPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {selectedNode.successCriteria && (
                <div>
                  <div className="text-zinc-500">Success criteria:</div>
                  <div className="text-zinc-300">{selectedNode.successCriteria}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              Click a node or note to inspect / edit it. Use the chat below to
              modify the flow with natural language.
            </p>
          )}
        </section>

        <section className="flex-1 flex flex-col min-h-0 p-4">
          <h2 className="text-sm font-semibold mb-2">Chat with the flow</h2>
          <div className="flex-1 overflow-y-auto scroll-thin space-y-2 mb-3 text-sm">
            {(chatQ.data ?? []).map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "bg-zinc-900/70 border border-zinc-800 rounded-lg p-2"
                    : "bg-indigo-950/30 border border-indigo-900/50 rounded-lg p-2"
                }
              >
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {m.role}
                </div>
                <div className="text-zinc-200 whitespace-pre-wrap">
                  {m.content}
                </div>
              </div>
            ))}
            {!chatQ.data?.length && (
              <div className="text-xs text-zinc-500">
                e.g. "split step 2 into two steps", "add a config note about
                ANTHROPIC_API_KEY", "remove the stop-keyword test"…
              </div>
            )}
          </div>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-sm h-20"
            placeholder="Type a flow edit instruction…"
          />
          <button
            disabled={!instruction || editM.isPending}
            onClick={() => {
              const text = instruction;
              setInstruction("");
              editM.mutate(text);
            }}
            className="mt-2 self-end text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded px-3 py-1.5"
          >
            {editM.isPending ? "Editing…" : "Apply edit"}
          </button>
          {editM.error && (
            <div className="text-xs text-red-400 mt-2">
              {(editM.error as Error).message}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
