/**
 * Typed client for Kylo's terminal, environment, GitHub and memory APIs
 * (kylo/ui/web/terminal_routes.py, kylo/ui/web/kylo_workspace_routes.py).
 *
 * Errors are thrown as `KyloApiError` carrying the HTTP status and the
 * backend's message, so a view can show it verbatim.
 */

export class KyloApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "KyloApiError";
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { detail?: unknown };
      const detail = data.detail;
      if (typeof detail === "string") message = detail;
      else if (detail && typeof detail === "object") {
        const d = detail as { message?: string; code?: string };
        if (d.message) message = d.message;
        code = d.code;
        if (Array.isArray(detail)) message = detail.map((x: { msg?: string }) => x.msg ?? "").join("; ");
      }
    } catch {
      /* body was not JSON */
    }
    throw new KyloApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

const get = <T>(url: string) => request<T>("GET", url);
const post = <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {});
const put = <T>(url: string, body: unknown) => request<T>("PUT", url, body);
const patch = <T>(url: string, body: unknown) => request<T>("PATCH", url, body);
const del = <T>(url: string) => request<T>("DELETE", url);
const q = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const text = s.toString();
  return text ? `?${text}` : "";
};

export function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}`;
}

// --------------------------------------------------------------------------- terminals
export type ProfileKind = "wsl" | "pwsh" | "powershell" | "cmd" | "bash" | "posix" | "custom";

export interface TerminalProfile {
  id: string;
  label: string;
  kind: ProfileKind;
  argv: string[];
  env: Record<string, string>;
  cwd: string | null;
  distro: string | null;
  builtin: boolean;
}

export interface WslDistro {
  name: string;
  state: string;
  version: number;
  default: boolean;
}

export interface TerminalSession {
  id: string;
  name: string;
  owner: "user" | "agent";
  profile_id: string;
  profile_label: string;
  kind: ProfileKind;
  cwd: string | null;
  created_at: number;
  pid: number;
  status: "starting" | "running" | "exited";
  exit_code: number | null;
  workspace: string | null;
  viewers: number;
  agent_busy: boolean;
}

export interface CustomProfile {
  id: string;
  label: string;
  path: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
}

export type AgentTerminalMode = "dedicated" | "shared" | "new";

export interface TerminalSettings {
  default_profile: string | null;
  wsl_distro: string | null;
  agent_mode: AgentTerminalMode;
  agent_default_shell: "auto" | "wsl" | "powershell" | "cmd" | "bash" | "posix";
  allow_agent_shared_terminal: boolean;
  env: Record<string, string>;
  startup_cwd: string | null;
  custom_profiles: CustomProfile[];
}

export type AutonomyMode = "ask" | "workspace" | "advanced";

export interface AutonomySettings {
  mode: AutonomyMode;
  extra_sensitive: string[];
  allowed_roots: string[];
  approval_timeout_s: number;
  workspace?: string | null;
}

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled" | "timeout" | "error";

export interface RunRecord {
  id: string;
  command: string;
  shell: string;
  shell_label: string;
  cwd: string;
  owner: "agent" | "user";
  workspace: string | null;
  status: RunStatus;
  exit_code: number | null;
  final_cwd: string | null;
  started_at: number;
  ended_at: number | null;
  error: string | null;
  background: boolean;
  duration_s?: number;
}

export interface RunOutput {
  run: RunRecord;
  stdout: string;
  stderr: string;
  chunks: { stream: "stdout" | "stderr" | "system"; data: string }[];
  truncated: boolean;
}

export interface ApprovalRequest {
  id: string;
  kind: "command" | "file" | "github" | string;
  title: string;
  detail: Record<string, unknown> & { subject?: string; command?: string; shell?: string; cwd?: string };
  reasons: string[];
  workspace: string | null;
  created_at: number;
  expires_at: number;
}

export type KyloEvent =
  | { type: "hello"; sessions: TerminalSession[]; active_runs: RunRecord[]; approvals: ApprovalRequest[]; workspace: string | null }
  | { type: "sessions"; sessions: TerminalSession[] }
  | { type: "cwd"; session_id: string; cwd: string }
  | { type: "agent-command"; session_id: string; command: string }
  | { type: "run.started"; run: RunRecord }
  | { type: "run.output"; run_id: string; stream: "stdout" | "stderr" | "system"; data: string }
  | { type: "run.cancelling"; run_id: string }
  | { type: "run.exit"; run: RunRecord }
  | { type: "approval.requested"; approval: ApprovalRequest }
  | { type: "approval.resolved"; id: string }
  | { type: "workspace"; workspace: string | null }
  | { type: "ping" };

export const terminalsApi = {
  profiles: (refresh = false) =>
    get<{ profiles: TerminalProfile[]; default_profile: string | null; wsl_distros: WslDistro[] }>(
      `/api/terminals/profiles${q({ refresh: refresh || undefined })}`,
    ),
  settings: () => get<TerminalSettings>("/api/terminals/settings"),
  saveSettings: (s: TerminalSettings) => put<TerminalSettings>("/api/terminals/settings", s),
  autonomy: () => get<AutonomySettings & { modes: AutonomyMode[] }>("/api/terminals/autonomy"),
  saveAutonomy: (s: AutonomySettings) => put<AutonomySettings>("/api/terminals/autonomy", s),
  workspace: () => get<{ workspace: string | null }>("/api/terminals/workspace"),
  setWorkspace: (path: string | null) =>
    put<{ workspace: string | null; imported_instructions: string[] }>("/api/terminals/workspace", { path }),
  sessions: () => get<{ sessions: TerminalSession[]; active: string | null; restorable: number }>("/api/terminals/sessions"),
  create: (body: { profile_id?: string | null; name?: string; cwd?: string | null; cols?: number; rows?: number }) =>
    post<TerminalSession>("/api/terminals/sessions", body),
  rename: (id: string, name: string) => patch<TerminalSession>(`/api/terminals/sessions/${id}`, { name }),
  close: (id: string) => del<{ closed: string }>(`/api/terminals/sessions/${id}`),
  input: (id: string, data: string, execute = false) =>
    post<{ sent: number }>(`/api/terminals/sessions/${id}/input`, { data, execute }),
  clear: (id: string) => post<{ cleared: string }>(`/api/terminals/sessions/${id}/clear`),
  history: (id: string) => get<{ history: string[] }>(`/api/terminals/sessions/${id}/history`),
  setActive: (sessionId: string | null) => put<{ active: string | null }>("/api/terminals/active", { session_id: sessionId }),
  restore: () => post<{ sessions: TerminalSession[] }>("/api/terminals/restore"),
  runs: (limit = 100, owner?: string) =>
    get<{ runs: RunRecord[]; active: RunRecord[] }>(`/api/terminals/runs${q({ limit, owner })}`),
  run: (id: string) => get<RunOutput>(`/api/terminals/runs/${id}`),
  startRun: (body: { command: string; shell?: string; cwd?: string | null; timeout_s?: number; background?: boolean }) =>
    post<Record<string, unknown>>("/api/terminals/runs", body),
  cancelRun: (id: string) => post<{ cancelled: boolean }>(`/api/terminals/runs/${id}/cancel`),
  clearRuns: () => del<{ deleted: number }>("/api/terminals/runs"),
  stopAgent: () => post<{ stopped: number; approvals_denied: number }>("/api/terminals/agent/stop"),
  approvals: () => get<{ approvals: ApprovalRequest[] }>("/api/terminals/approvals"),
  decide: (id: string, approved: boolean, always = false) =>
    post<{ resolved: string }>(`/api/terminals/approvals/${id}`, { approved, always }),
};

// --------------------------------------------------------------------------- environment
export interface ToolStatus {
  id: string;
  name: string;
  category: "core" | "runtime" | "ai" | "agent" | string;
  installed: boolean;
  version: string | null;
  path: string | null;
  status: "ok" | "missing" | "warning" | "error";
  detail: string | null;
  install: { command?: string; shell?: string; url?: string; note?: string } | null;
  extra: Record<string, unknown>;
}

export interface EnvironmentReport {
  platform: string;
  tools: ToolStatus[];
  wsl_toolchain: { distro: string | null; tools: { id: string; installed: boolean; path: string | null; version: string | null }[]; error: string | null };
  terminals: TerminalProfile[];
  recommendations: { level: "important" | "suggested" | "optional"; text: string; tool?: string }[];
  duration_s: number;
  checked_at: number;
}

export const environmentApi = {
  report: (refresh = false) => get<EnvironmentReport>(`/api/environment${q({ refresh: refresh || undefined })}`),
};

// --------------------------------------------------------------------------- GitHub
export interface GitHubStatus {
  git_installed: boolean;
  gh_installed: boolean;
  gh_version?: string | null;
  authenticated: boolean;
  login: string | null;
  name: string | null;
  avatar_url?: string;
  html_url?: string;
  scopes: string[];
  install_url: string;
  login_command: string;
  error?: string;
}

export interface GitHubRepo {
  name: string;
  nameWithOwner: string;
  description: string | null;
  visibility: string;
  isPrivate: boolean;
  isFork: boolean;
  updatedAt: string;
  url: string;
  primaryLanguage: { name: string } | null;
  stargazerCount: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  author: { login: string } | null;
  labels: { name: string; color?: string }[];
  updatedAt: string;
  url: string;
}

export interface GitHubPull {
  number: number;
  title: string;
  state: string;
  author: { login: string } | null;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  updatedAt: string;
  url: string;
  reviewDecision: string | null;
}

export interface GitHubRun {
  databaseId: number;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  workflowName: string;
  headBranch: string;
  event: string;
  createdAt: string;
  url: string;
}

const repoPath = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");

export const githubApi = {
  status: () => get<GitHubStatus>("/api/github/status"),
  repos: (owner?: string, limit = 100) => get<{ repos: GitHubRepo[] }>(`/api/github/repos${q({ owner, limit })}`),
  repoForFolder: (folder: string) => get<{ repo: { nameWithOwner: string; url: string } | null }>(`/api/github/repo${q({ folder })}`),
  issues: (repo: string, state = "open") => get<{ issues: GitHubIssue[] }>(`/api/github/repos/${repoPath(repo)}/issues${q({ state })}`),
  pulls: (repo: string, state = "open") => get<{ pulls: GitHubPull[] }>(`/api/github/repos/${repoPath(repo)}/pulls${q({ state })}`),
  runs: (repo: string) => get<{ runs: GitHubRun[] }>(`/api/github/repos/${repoPath(repo)}/runs`),
  run: (repo: string, id: number, failedLogs = false) =>
    get<Record<string, unknown> & { failed_log?: string }>(`/api/github/repos/${repoPath(repo)}/runs/${id}${q({ failed_logs: failedLogs || undefined })}`),
  clone: (repo: string, dest: string) => post<{ repo: string; path: string }>("/api/github/clone", { repo, dest }),
  create: (body: { name: string; private: boolean; description?: string; source?: string | null; push?: boolean }) =>
    post<{ name: string; url: string | null }>("/api/github/create", body),
  createIssue: (repo: string, title: string, body: string) =>
    post<{ url: string | null }>(`/api/github/repos/${repoPath(repo)}/issues`, { title, body }),
  createPull: (body: { folder: string; title: string; body?: string; base?: string; draft?: boolean }) =>
    post<{ url: string | null }>("/api/github/pulls", body),
  merge: (repo: string, number: number, method: "merge" | "squash" | "rebase") =>
    post<{ merged: boolean }>(`/api/github/repos/${repoPath(repo)}/pulls/${number}/merge`, { method }),
};

// --------------------------------------------------------------------------- memory
export type MemoryScope = "global" | "project" | "task";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  project: string;
  kind: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface MemoryProject {
  key: string;
  path: string;
  name: string;
  created_at: number;
  last_used: number;
  entries: number;
}

export const memoryApi = {
  meta: () => get<{ scopes: MemoryScope[]; kinds: string[] }>("/api/kylo-memory/meta"),
  entries: (params: { scope?: MemoryScope; project?: string | null; q?: string }) =>
    get<{ entries: MemoryEntry[] }>(`/api/kylo-memory/entries${q(params)}`),
  add: (body: { scope: MemoryScope; kind: string; content: string; project?: string | null; title?: string; pinned?: boolean }) =>
    post<{ entry: MemoryEntry; created: boolean }>("/api/kylo-memory/entries", body),
  update: (id: string, body: Partial<Pick<MemoryEntry, "content" | "title" | "kind" | "pinned" | "tags">>) =>
    patch<{ entry: MemoryEntry }>(`/api/kylo-memory/entries/${id}`, body),
  remove: (id: string) => del<{ deleted: string }>(`/api/kylo-memory/entries/${id}`),
  projects: () => get<{ projects: MemoryProject[]; current: string | null }>("/api/kylo-memory/projects"),
  forgetProject: (path: string) => del<{ deleted: number }>(`/api/kylo-memory/projects${q({ path })}`),
  importAgentsMd: (folder: string) => post<{ imported: string[] }>("/api/kylo-memory/import-agents-md", { folder }),
  exportAll: (project?: string | null) => get<Record<string, unknown>>(`/api/kylo-memory/export${q({ project })}`),
  importAll: (payload: unknown) => post<{ created: number; skipped: number }>("/api/kylo-memory/import", payload),
};

// --------------------------------------------------------------------------- desktop bridge
/** The Electron preload bridge (desktop/electron/preload.ts); absent in a browser. */
export interface KyloDesktopBridge {
  platform: string;
  version: string;
  selectFolder: (options?: { title?: string; defaultPath?: string }) => Promise<string | null>;
  notify: (title: string, body: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  revealPath: (path: string) => Promise<void>;
}

export function desktopBridge(): KyloDesktopBridge | null {
  const bridge = (window as unknown as { kylo?: KyloDesktopBridge }).kylo;
  return bridge && typeof bridge.selectFolder === "function" ? bridge : null;
}

/** Ask the user for a folder: the native dialog in the desktop app, else the backend picker. */
export async function pickFolder(title: string): Promise<string | null> {
  const bridge = desktopBridge();
  if (bridge) return bridge.selectFolder({ title });
  try {
    const res = await fetch("/api/agentic-ide/folders/native", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: null }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { path?: string | null; cancelled?: boolean };
    return data.cancelled ? null : (data.path ?? null);
  } catch {
    return null;
  }
}
