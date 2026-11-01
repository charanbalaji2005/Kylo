"""Kylo terminal tools: run commands in WSL / PowerShell / CMD / Git Bash.

``terminal_run`` is the agent's controlled execution API. Every call goes
through :func:`kylo.terminal.agent_exec.agent_run`, which applies the user's
autonomy mode (Ask / Workspace / Advanced), asks for approval in a permission
dialog when the policy requires a human, and runs the command in the agent
terminal the user chose (a dedicated AI terminal by default). Output is
streamed live into Kylo's Terminal panel; the tool returns stdout, stderr,
the exit code and the directory the command ended in (the next command
continues from there).

``terminal_output`` reads a background run (dev servers, watchers), and
``terminal_stop`` stops one run or every AI command.
"""
from __future__ import annotations

from typing import Any

from kylo.core.protocols import ExecutionContext, ToolResult
from kylo.safety.command_impact import DESTRUCTIVE, classify_command

_SHELLS = ["auto", "wsl", "powershell", "pwsh", "cmd", "bash"]


class TerminalRunTool:
    name: str = "terminal_run"
    read_only: bool = False
    risk_tier: str = "monitor"
    description: str = (
        "Run a command in a real terminal on the user's Windows PC and get stdout, stderr and the "
        "exit code. shell='wsl' runs Bash in WSL 2 Ubuntu (default for coding: npm, pip, git, make, "
        "compilers; Windows drives are under /mnt/c/...). shell='powershell' / 'pwsh' for Windows "
        "tasks, 'cmd' for batch files, 'bash' for Git Bash. The working directory persists between "
        "calls (cd carries over); default is the selected workspace. Use background=true for "
        "long-running processes such as dev servers or watchers, then read them with terminal_output "
        "and stop them with terminal_stop. Destructive, elevated or out-of-workspace commands may "
        "need the user's approval."
    )
    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "The command line, written for the chosen shell"},
            "shell": {"type": "string", "enum": _SHELLS, "default": "auto"},
            "cwd": {
                "type": "string",
                "description": "Working directory (Windows path, or a Linux path for wsl). Omit to continue in the last one.",
            },
            "timeout_s": {"type": "number", "description": "Seconds before the command is stopped (default 120)"},
            "background": {
                "type": "boolean",
                "default": False,
                "description": "Start and return after a few seconds; the process keeps running",
            },
            "terminal": {
                "type": "string",
                "enum": ["dedicated", "new", "shared"],
                "description": "Where to run: the AI terminal (default from settings), a new AI session, or the user's active terminal (only if the user allowed it)",
            },
        },
        "required": ["command"],
    }

    def risk_tier_for_args(self, args: dict[str, Any]) -> str | None:
        command = (args.get("command") or "").strip()
        if command and classify_command(command).level == DESTRUCTIVE:
            return "ask"
        return None

    def describe_args(self, args: dict[str, Any]) -> dict[str, str] | None:
        command = (args.get("command") or "").strip()
        if not command:
            return None
        impact = classify_command(command)
        return {"level": impact.level, "commands": ", ".join(dict.fromkeys(impact.commands))}

    async def execute(self, args: dict[str, Any], ctx: ExecutionContext) -> ToolResult:
        from kylo.terminal.agent_exec import agent_run

        try:
            timeout = float(args["timeout_s"]) if args.get("timeout_s") not in (None, "") else None
        except (TypeError, ValueError):
            timeout = None
        result = await agent_run(
            str(args.get("command") or ""),
            shell=str(args.get("shell") or "auto"),
            cwd=(str(args["cwd"]) if args.get("cwd") else None),
            timeout_s=timeout,
            background=bool(args.get("background", False)),
            mode=(str(args["terminal"]) if args.get("terminal") else None),
            approved_by=ctx.approved_by,
        )
        status = result.get("status")
        ok = status in ("succeeded",) or (result.get("background") and status == "running")
        return ToolResult(success=bool(ok), output=result, error=None if ok else (result.get("error") or f"command {status}"))


class TerminalOutputTool:
    name: str = "terminal_output"
    read_only: bool = True
    risk_tier: str = "safe"
    description: str = (
        "Read the current output and status of a terminal_run command by run_id (for background "
        "processes such as dev servers). Without run_id, lists recent and running AI commands."
    )
    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "run_id": {"type": "string"},
            "max_chars": {"type": "integer", "default": 20000},
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ExecutionContext) -> ToolResult:
        from kylo.terminal.services import get_services

        runner = get_services().runner
        run_id = str(args.get("run_id") or "").strip()
        if not run_id:
            return ToolResult(success=True, output={"active": runner.active(), "recent": runner.recent(15, "agent")})
        try:
            max_chars = max(1000, min(int(args.get("max_chars") or 20000), 200_000))
        except (TypeError, ValueError):
            max_chars = 20000
        out = runner.output(run_id, max_chars=max_chars)
        if out is None:
            return ToolResult(success=False, output=None, error=f"no run {run_id}")
        out.pop("chunks", None)
        return ToolResult(success=True, output=out)


class TerminalStopTool:
    name: str = "terminal_stop"
    read_only: bool = False
    risk_tier: str = "safe"
    description: str = (
        "Stop a running terminal_run command (run_id), e.g. a dev server, killing its whole process "
        "tree. Without run_id, stops every command the AI is running."
    )
    schema: dict[str, Any] = {"type": "object", "properties": {"run_id": {"type": "string"}}}

    async def execute(self, args: dict[str, Any], ctx: ExecutionContext) -> ToolResult:
        from kylo.terminal.agent_exec import agent_stop

        result = await agent_stop(str(args.get("run_id") or "").strip() or None)
        return ToolResult(success=True, output=result)
