import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
} from "reactflow";
import type { Flow } from "@ccqa/shared";
import { useEffect, useMemo, useState } from "react";

export interface FlowCanvasProps {
  flow: Flow;
  /** runId-state map: stepId / nodeId → status. */
  statuses?: Record<string, string>;
  selectedNodeId?: string;
  onSelectNode?: (id: string | null) => void;
  onLayoutChange?: (positions: Record<string, { x: number; y: number }>) => void;
}

export function FlowCanvas({
  flow,
  statuses,
  selectedNodeId,
  onSelectNode,
  onLayoutChange,
}: FlowCanvasProps) {
  const initial = useMemo(() => toReactFlow(flow, statuses), [flow]);
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);

  useEffect(() => {
    const fresh = toReactFlow(flow, statuses);
    setNodes((cur) =>
      fresh.nodes.map((n) => {
        const prev = cur.find((c) => c.id === n.id);
        return prev ? { ...n, position: prev.position } : n;
      })
    );
    setEdges(fresh.edges);
  }, [flow, statuses]);

  const handleNodeChanges = (changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, nodes);
    setNodes(next);
    if (onLayoutChange && changes.some((c) => c.type === "position" && (c as any).dragging === false)) {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of next) positions[n.id] = n.position;
      onLayoutChange(positions);
    }
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodeChanges}
      onEdgesChange={(c: EdgeChange[]) => setEdges((e) => applyEdgeChanges(c, e))}
      onNodeClick={(_, n) => onSelectNode?.(n.id === selectedNodeId ? null : n.id)}
      onPaneClick={() => onSelectNode?.(null)}
      fitView
    >
      <Background />
      <MiniMap pannable zoomable />
      <Controls />
    </ReactFlow>
  );
}

function toReactFlow(
  flow: Flow,
  statuses?: Record<string, string>
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = flow.nodes.map((n) => {
    const st = statuses?.[n.id] ?? "";
    return {
      id: n.id,
      position: n.position ?? { x: 0, y: 0 },
      data: { label: <NodeLabel title={n.title} kind={n.kind} status={st} /> },
      style: {},
      type: "default",
      className: `rf-node ${n.kind} ${st}`,
    };
  });
  const edges: Edge[] = flow.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: statuses?.[e.source] === "running",
    style: { stroke: "#52525b" },
    labelStyle: { fill: "#a1a1aa", fontSize: 11 },
  }));
  return { nodes, edges };
}

function NodeLabel({
  title,
  kind,
  status,
}: {
  title: string;
  kind: string;
  status: string;
}) {
  return (
    <div className="text-left">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex justify-between">
        <span>{kind}</span>
        {status && <span className="text-zinc-300">{status}</span>}
      </div>
      <div className="text-sm font-medium">{title}</div>
    </div>
  );
}
