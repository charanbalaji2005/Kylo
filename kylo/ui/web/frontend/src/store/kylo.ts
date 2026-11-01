/**
 * Kylo live state: terminal sessions, the selected workspace, agent command
 * runs and pending permission requests, fed by ONE events socket
 * (`/api/terminals/events`, kylo/ui/web/terminal_routes.py).
 *
 * The socket is opened once for the whole app (`useKyloEventsConnection`,
 * mounted in App.tsx) so a permission dialog appears wherever the user is.
 * Run output is not kept in React state chunk by chunk — it is fanned out to
 * listeners (`onRunEvent`) that write straight into xterm, and only the run
 * list (status, exit code) lives in the store.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { translate } from "@/i18n";
import {
  desktopBridge,
  wsUrl,
  type ApprovalRequest,
  type KyloEvent,
  type RunRecord,
  type TerminalSession,
} from "@/lib/kyloApi";

export type RunEvent = Extract<KyloEvent, { type: "run.started" | "run.output" | "run.exit" | "run.cancelling" }>;

interface KyloState {
  connected: boolean;
  sessions: TerminalSession[];
  workspace: string | null;
  approvals: ApprovalRequest[];
  runs: RunRecord[];
  /** Commands the AI typed into a shared / agent PTY session, newest last. */
  agentCommands: { session_id: string; command: string; at: number }[];
  setSessions: (sessions: TerminalSession[]) => void;
  setWorkspace: (workspace: string | null) => void;
  setRuns: (runs: RunRecord[]) => void;
}

const MAX_RUNS = 200;

export const useKyloStore = create<KyloState>((set) => ({
  connected: false,
  sessions: [],
  workspace: null,
  approvals: [],
  runs: [],
  agentCommands: [],
  setSessions: (sessions) => set({ sessions }),
  setWorkspace: (workspace) => set({ workspace }),
  setRuns: (runs) => set({ runs: runs.slice(0, MAX_RUNS) }),
}));

const runListeners = new Set<(event: RunEvent) => void>();

/** Subscribe to live agent run events (start / output / exit). */
export function onRunEvent(listener: (event: RunEvent) => void): () => void {
  runListeners.add(listener);
  return () => runListeners.delete(listener);
}

function upsertRun(runs: RunRecord[], run: RunRecord): RunRecord[] {
  const rest = runs.filter((r) => r.id !== run.id);
  return [run, ...rest].sort((a, b) => b.started_at - a.started_at).slice(0, MAX_RUNS);
}

export function applyKyloEvent(event: KyloEvent): void {
  const store = useKyloStore;
  switch (event.type) {
    case "hello":
      store.setState((s) => ({
        sessions: event.sessions,
        approvals: event.approvals,
        workspace: event.workspace,
        runs: event.active_runs.reduce(upsertRun, s.runs),
      }));
      return;
    case "sessions":
      store.setState({ sessions: event.sessions });
      return;
    case "cwd":
      store.setState((s) => ({
        sessions: s.sessions.map((x) => (x.id === event.session_id ? { ...x, cwd: event.cwd } : x)),
      }));
      return;
    case "agent-command":
      store.setState((s) => ({
        agentCommands: [...s.agentCommands.slice(-99), { session_id: event.session_id, command: event.command, at: Date.now() }],
      }));
      return;
    case "run.started":
    case "run.exit":
      store.setState((s) => ({ runs: upsertRun(s.runs, event.run) }));
      break;
    case "approval.requested": {
      store.setState((s) => ({ approvals: [...s.approvals.filter((a) => a.id !== event.approval.id), event.approval] }));
      const bridge = desktopBridge();
      if (bridge && !document.hasFocus()) {
        void bridge.notify(translate("kylo.approval.notify_title"), event.approval.title).catch(() => undefined);
      }
      return;
    }
    case "approval.resolved":
      store.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== event.id) }));
      return;
    case "workspace":
      store.setState({ workspace: event.workspace });
      return;
    default:
      break;
  }
  if (event.type === "run.started" || event.type === "run.output" || event.type === "run.exit" || event.type === "run.cancelling") {
    for (const listener of runListeners) {
      try {
        listener(event);
      } catch {
        /* a broken view must not stop the others */
      }
    }
  }
}

let socket: WebSocket | null = null;
let users = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = 1000;

function connect(): void {
  if (socket || users === 0) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl("/api/terminals/events"));
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    backoff = 1000;
    useKyloStore.setState({ connected: true });
  };
  ws.onmessage = (ev) => {
    try {
      applyKyloEvent(JSON.parse(ev.data as string) as KyloEvent);
    } catch {
      /* malformed frame */
    }
  };
  ws.onclose = () => {
    socket = null;
    useKyloStore.setState({ connected: false });
    scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  };
}

function scheduleReconnect(): void {
  if (users === 0 || retry) return;
  retry = setTimeout(() => {
    retry = null;
    connect();
  }, backoff);
  backoff = Math.min(backoff * 2, 15000);
}

/** Keep the events socket open while the calling component is mounted. */
export function useKyloEventsConnection(): void {
  useEffect(() => {
    users += 1;
    connect();
    return () => {
      users -= 1;
      if (users === 0) {
        if (retry) clearTimeout(retry);
        retry = null;
        socket?.close();
        socket = null;
      }
    };
  }, []);
}
