import type {
  Bug,
  CreateProjectRequest,
  Flow,
  Project,
  Run,
  RunEvent,
  RunStep,
} from "@ccqa/shared";

async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${method} ${url} → ${r.status}: ${text}`);
  }
  if (r.status === 204) return undefined as any;
  return (await r.json()) as T;
}

export const api = {
  health: () => http<{ ok: true }>("GET", "/api/health"),

  listProjects: () => http<Project[]>("GET", "/api/projects"),
  getProject: (id: string) => http<Project>("GET", `/api/projects/${id}`),
  createProject: (b: CreateProjectRequest) =>
    http<Project>("POST", "/api/projects", b),
  updateProject: (id: string, b: Partial<CreateProjectRequest>) =>
    http<Project>("PATCH", `/api/projects/${id}`, b),
  deleteProject: (id: string) => http<void>("DELETE", `/api/projects/${id}`),
  cloneRepos: (id: string) =>
    http<{ repos: any[] }>("POST", `/api/projects/${id}/clone`),

  getFlow: (id: string) => http<Flow>("GET", `/api/projects/${id}/flow`),
  generateFlow: (id: string, mainFlowText?: string) =>
    http<Flow>("POST", `/api/projects/${id}/flow/generate`, { mainFlowText }),
  editFlow: (id: string, instruction: string) =>
    http<{
      flow: Flow;
      summary: string;
      chat: { id: string; role: string; content: string; created_at: string }[];
    }>("POST", `/api/projects/${id}/flow/edit`, { instruction }),
  putFlow: (id: string, flow: Flow) =>
    http<Flow>("PUT", `/api/projects/${id}/flow`, { flow }),
  getFlowChat: (id: string) =>
    http<{ id: string; role: string; content: string; created_at: string }[]>(
      "GET",
      `/api/projects/${id}/flow/chat`
    ),

  startRun: (id: string, coder?: string) =>
    http<Run>("POST", `/api/projects/${id}/runs`, { coder }),
  listRuns: (id: string) =>
    http<Run[]>("GET", `/api/projects/${id}/runs`),
  getRun: (runId: string) =>
    http<{ run: Run; steps: RunStep[]; bugs: Bug[] }>(
      "GET",
      `/api/runs/${runId}`
    ),
  cancelRun: (runId: string) =>
    http<{ cancelled: boolean }>("POST", `/api/runs/${runId}/cancel`),

  streamRun(runId: string, onEvent: (e: RunEvent) => void): WebSocket {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/runs/${runId}/stream`);
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {}
    };
    return ws;
  },
};
