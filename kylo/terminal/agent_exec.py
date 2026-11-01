"""The one entry point through which an AI agent runs a terminal command.

Order of checks, for every command:

1. :func:`kylo.security.autonomy.evaluate_command` — ``block`` stops here.
2. ``ask`` without a human approval → the Kylo approval queue (permission
   dialog). Denied or timed out → the command does not run.
3. The agent terminal mode decides *where* it runs:
   ``dedicated`` (default) → :class:`CommandRunner` (pipes, streamed into the
   "Kylo AI" panel); ``new`` → the AI's own interactive PTY session;
   ``shared`` → the user's active terminal, only when the user enabled
   ``allow_agent_shared_terminal`` in terminal settings.
"""
from __future__ import annotations

import asyncio
from typing import Any

from kylo.security.autonomy import evaluate_command
from kylo.terminal.command_runner import CommandRunnerError, resolve_shell
from kylo.terminal.hub import TerminalHubError
from kylo.terminal.services import KyloServices, get_services

HUMAN_APPROVALS = frozenset({"user", "explicit-intent"})
_BACKGROUND_PEEK_S = 4.0


async def agent_run(
    command: str,
    *,
    shell: str = "auto",
    cwd: str | None = None,
    workspace: str | None = None,
    timeout_s: float | None = None,
    background: bool = False,
    mode: str | None = None,
    approved_by: str | None = None,
    services: KyloServices | None = None,
) -> dict[str, Any]:
    svc = services or get_services()
    settings = svc.settings.load()
    autonomy = svc.autonomy.load()
    workspace = workspace or svc.current_workspace
    mode = mode or settings.agent_mode
    command = (command or "").strip()
    if not command:
        return {"status": "error", "error": "command is empty"}
    if mode not in ("dedicated", "new", "shared"):
        return {"status": "error", "error": f"unknown agent terminal mode {mode!r}"}

    try:
        resolved = resolve_shell(shell, settings)
    except CommandRunnerError as exc:
        return {"status": "error", "error": str(exc)}
    effective_cwd = cwd or svc.runner.remembered_cwd("agent", workspace, resolved.kind) or workspace

    decision = evaluate_command(command, cwd=effective_cwd, workspace=workspace, settings=autonomy)
    if decision.verdict == "block":
        return {"status": "blocked", "error": "; ".join(decision.reasons), "policy": decision.to_dict()}
    approval = "policy"
    if decision.verdict == "ask" and approved_by not in HUMAN_APPROVALS:
        approved, how = await svc.approvals.request(
            kind="command",
            title=f"Run in {resolved.label}",
            subject=command,
            detail={"command": command, "shell": resolved.label, "cwd": effective_cwd, "mode": mode},
            reasons=list(decision.reasons),
            workspace=workspace,
            timeout_s=autonomy.approval_timeout_s,
        )
        if not approved:
            return {
                "status": "denied",
                "error": "the user did not approve this command" if how != "timeout" else "approval timed out",
                "policy": decision.to_dict(),
            }
        approval = how
    elif decision.verdict == "ask":
        approval = approved_by or "user"

    if mode == "shared":
        if not settings.allow_agent_shared_terminal:
            return {"status": "error", "error": "sharing the user's terminal with the AI is disabled in Terminal settings"}
        session_id = svc.hub.active_user_session
        if session_id is None:
            return {"status": "error", "error": "there is no active user terminal to share"}
        try:
            result = await svc.hub.run_command(session_id, command, timeout_s=float(timeout_s or 120))
        except TerminalHubError as exc:
            return {"status": "error", "error": str(exc)}
        return {**result, "mode": "shared", "approval": approval, "policy": decision.to_dict()}

    if mode == "new":
        try:
            session = await svc.hub.agent_session(workspace)
            if cwd:
                await svc.hub.run_command(session.id, _cd_command(session.kind, cwd), timeout_s=15)
            result = await svc.hub.run_command(session.id, command, timeout_s=float(timeout_s or 120))
        except TerminalHubError as exc:
            return {"status": "error", "error": str(exc)}
        return {**result, "mode": "new", "approval": approval, "policy": decision.to_dict()}

    try:
        record = await svc.runner.start(
            command,
            shell=resolved.kind,
            cwd=effective_cwd,
            timeout_s=timeout_s if timeout_s is not None else (6 * 3600 if background else None),
            owner="agent",
            workspace=workspace,
            background=background,
        )
    except CommandRunnerError as exc:
        return {"status": "error", "error": str(exc)}
    if background:
        await svc.runner.wait(record.id, timeout=_BACKGROUND_PEEK_S)
    else:
        await svc.runner.wait(record.id)
    out = svc.runner.output(record.id) or {}
    run = out.get("run", record.to_dict())
    return {
        "run_id": record.id,
        "status": run.get("status"),
        "exit_code": run.get("exit_code"),
        "shell": run.get("shell_label"),
        "cwd": run.get("cwd"),
        "final_cwd": run.get("final_cwd"),
        "stdout": out.get("stdout", ""),
        "stderr": out.get("stderr", ""),
        "truncated": out.get("truncated", False),
        "background": background,
        "still_running": svc.runner.is_running(record.id),
        "error": run.get("error"),
        "mode": "dedicated",
        "approval": approval,
        "policy": decision.to_dict(),
    }


def _cd_command(kind: str, cwd: str) -> str:
    if kind in ("pwsh", "powershell"):
        return "Set-Location -LiteralPath '" + cwd.replace("'", "''") + "'"
    if kind == "cmd":
        return f'cd /d "{cwd}"'
    return "cd -- '" + cwd.replace("'", "'\\''") + "'"


async def agent_stop(run_id: str | None = None, *, services: KyloServices | None = None) -> dict[str, Any]:
    """Stop one agent run, or every agent run and pending agent approval."""
    svc = services or get_services()
    if run_id:
        return {"stopped": int(svc.runner.cancel(run_id))}
    stopped = svc.runner.cancel_all("agent")
    denied = svc.approvals.deny_all()
    await asyncio.sleep(0)
    return {"stopped": stopped, "approvals_denied": denied}
