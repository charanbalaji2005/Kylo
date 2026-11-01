import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocaleChunk } from "@/i18n";
import type { ApprovalRequest, RunRecord, TerminalSession } from "@/lib/kyloApi";
import { applyKyloEvent, onRunEvent, useKyloStore } from "@/store/kylo";
import { KyloApprovalDialog } from "./KyloApprovalDialog";

const session: TerminalSession = {
  id: "s1",
  name: "PowerShell 1",
  owner: "user",
  profile_id: "powershell",
  profile_label: "Windows PowerShell",
  kind: "powershell",
  cwd: "C:\\work",
  created_at: 1,
  pid: 10,
  status: "running",
  exit_code: null,
  workspace: null,
  viewers: 0,
  agent_busy: false,
};

const run: RunRecord = {
  id: "r1",
  command: "npm test",
  shell: "wsl",
  shell_label: "WSL: Ubuntu",
  cwd: "/mnt/c/work",
  owner: "agent",
  workspace: "C:\\work",
  status: "running",
  exit_code: null,
  final_cwd: null,
  started_at: 100,
  ended_at: null,
  error: null,
  background: false,
};

const approval: ApprovalRequest = {
  id: "a1",
  kind: "command",
  title: "Run in WSL: Ubuntu",
  detail: { command: "rm -rf build", shell: "WSL: Ubuntu", cwd: "/mnt/c/work", subject: "rm -rf build" },
  reasons: ["deletes or overwrites data (rm)"],
  workspace: "C:\\work",
  created_at: Date.now() / 1000,
  expires_at: Date.now() / 1000 + 300,
};

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  close() {}
  send() {}
}

beforeEach(async () => {
  useKyloStore.setState({ sessions: [], approvals: [], runs: [], workspace: null, agentCommands: [], connected: false });
  vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
  await loadLocaleChunk("kylo");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("kylo event store", () => {
  it("applies hello, sessions, cwd and workspace events", () => {
    applyKyloEvent({ type: "hello", sessions: [session], active_runs: [run], approvals: [], workspace: "C:\\work" });
    expect(useKyloStore.getState().sessions).toHaveLength(1);
    expect(useKyloStore.getState().runs[0].id).toBe("r1");
    applyKyloEvent({ type: "cwd", session_id: "s1", cwd: "C:\\work\\src" });
    expect(useKyloStore.getState().sessions[0].cwd).toBe("C:\\work\\src");
    applyKyloEvent({ type: "workspace", workspace: null });
    expect(useKyloStore.getState().workspace).toBeNull();
  });

  it("updates runs on exit and fans run events out to listeners", () => {
    const seen: string[] = [];
    const off = onRunEvent((e) => seen.push(e.type));
    applyKyloEvent({ type: "run.started", run });
    applyKyloEvent({ type: "run.output", run_id: "r1", stream: "stdout", data: "ok\n" });
    applyKyloEvent({ type: "run.exit", run: { ...run, status: "succeeded", exit_code: 0 } });
    off();
    applyKyloEvent({ type: "run.output", run_id: "r1", stream: "stdout", data: "late" });
    expect(seen).toEqual(["run.started", "run.output", "run.exit"]);
    expect(useKyloStore.getState().runs).toHaveLength(1);
    expect(useKyloStore.getState().runs[0].status).toBe("succeeded");
  });

  it("adds and removes approvals", () => {
    applyKyloEvent({ type: "approval.requested", approval });
    expect(useKyloStore.getState().approvals).toHaveLength(1);
    applyKyloEvent({ type: "approval.resolved", id: "a1" });
    expect(useKyloStore.getState().approvals).toHaveLength(0);
  });
});

describe("KyloApprovalDialog", () => {
  it("renders nothing without a pending approval", () => {
    render(<KyloApprovalDialog />);
    expect(screen.queryByTestId("kylo-approval-dialog")).toBeNull();
  });

  it("shows the command and reasons, and approving posts the decision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ resolved: "a1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<KyloApprovalDialog />);
    act(() => applyKyloEvent({ type: "approval.requested", approval }));
    const dialog = await screen.findByTestId("kylo-approval-dialog");
    expect(dialog.textContent).toContain("rm -rf build");
    expect(dialog.textContent).toContain("deletes or overwrites data");
    fireEvent.click(screen.getByTestId("kylo-approval-allow"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/terminals/approvals/a1");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ approved: true, always: false });
    await waitFor(() => expect(screen.queryByTestId("kylo-approval-dialog")).toBeNull());
  });

  it("denying posts approved=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<KyloApprovalDialog />);
    act(() => applyKyloEvent({ type: "approval.requested", approval }));
    fireEvent.click(await screen.findByTestId("kylo-approval-deny"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).approved).toBe(false);
  });
});
