"""Interactive terminal sessions shared by the user and AI agents.

A :class:`TerminalHub` owns every PTY session of the integrated Terminal panel:

* each session has an **owner** (``user`` or ``agent``) shown in the UI, a
  user-editable name, the profile it was started with and its live cwd,
* output is kept in a bounded **replay buffer**, so switching views, reloading
  the window or opening the same terminal in a split pane re-attaches to the
  running shell instead of killing it,
* any number of viewers can attach; each gets the replay, then live output,
* typed input is recorded as **history** (one entry per Enter),
* the cwd is tracked from OSC 7 reports, which Kylo asks bash (WSL, Git Bash)
  and PowerShell to emit through their prompt,
* :meth:`run_command` lets an agent type a command into a session and get its
  output and exit code back (used for the "shared" and "new session" agent
  terminal modes); every viewer is told the command came from the AI.

The hub never types into a user's session on its own: the caller (the
``terminal-run`` tool) checks ``allow_agent_shared_terminal`` first.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from loguru import logger

from kylo.terminal.profiles import (
    TerminalProfile,
    TerminalSettings,
    TerminalSettingsStore,
    all_profiles,
    default_profile,
    find_profile,
)
from kylo.terminal.pty_manager import PtyManager

REPLAY_LIMIT_CHARS = 512_000
HISTORY_LIMIT = 500
MAX_SESSIONS = 32
MAX_NAME_LEN = 60
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
_OSC7_RE = re.compile(r"\x1b\]7;([^\x07\x1b]*)(?:\x07|\x1b\\)")

# Prompt hooks that report the cwd with OSC 7 (VS Code / Windows Terminal style).
_BASH_PROMPT_COMMAND = 'printf "\\033]7;file://%s%s\\033\\\\" "${HOSTNAME:-localhost}" "$PWD"'
_PS_PROMPT_HOOK = (
    "$__kyloPrompt = $function:prompt; "
    "function global:prompt { "
    "$p = $executionContext.SessionState.Path.CurrentLocation.ProviderPath; "
    "[Console]::Write([string][char]27 + ']7;file://localhost/' + ($p -replace '\\\\','/') + [string][char]7); "
    "if ($__kyloPrompt) { & $__kyloPrompt } else { 'PS ' + $p + '> ' } }"
)

# cmd.exe: $e = ESC, $P = current path, $G = ">" — the usual prompt plus an OSC 7 report.
_CMD_PROMPT = "$e]7;file://localhost/$P$e\$P$G"

class TerminalHubError(ValueError):
    """A request the hub refuses (unknown session, limit reached, bad input)."""


@dataclass(eq=False)
class HubSession:
    id: str
    name: str
    owner: str
    profile_id: str
    profile_label: str
    kind: str
    cwd: str | None
    created_at: float
    pty_id: str | None = None
    pid: int = 0
    status: str = "starting"
    exit_code: int | None = None
    workspace: str | None = None
    replay: deque[str] = field(default_factory=deque)
    replay_chars: int = 0
    viewers: set[asyncio.Queue[dict[str, Any]]] = field(default_factory=set)
    history: deque[str] = field(default_factory=lambda: deque(maxlen=HISTORY_LIMIT))
    line_buffer: str = ""
    last_output_at: float = 0.0
    agent_busy: bool = False
    output_taps: set[Callable[[str], None]] = field(default_factory=set)

    def info(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "owner": self.owner,
            "profile_id": self.profile_id,
            "profile_label": self.profile_label,
            "kind": self.kind,
            "cwd": self.cwd,
            "created_at": self.created_at,
            "pid": self.pid,
            "status": self.status,
            "exit_code": self.exit_code,
            "workspace": self.workspace,
            "viewers": len(self.viewers),
            "agent_busy": self.agent_busy,
        }


def strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _osc7_path(uri: str, kind: str) -> str | None:
    try:
        parsed = urlparse(uri)
    except ValueError:
        return None
    path = unquote(parsed.path or "")
    if not path:
        return None
    if kind in ("pwsh", "powershell", "cmd") and re.match(r"^/[A-Za-z]:[/\\]", path):
        return path[1:].replace("/", "\\")
    if kind == "bash":
        match = re.match(r"^/([a-zA-Z])(/.*)?$", path)
        if match:
            return f"{match.group(1).upper()}:" + (match.group(2) or "/").replace("/", "\\")
    return path


class TerminalHub:
    """Every interactive terminal session in the Terminal panel."""

    def __init__(self, settings_store: TerminalSettingsStore, layout_path: Path, manager: PtyManager | None = None) -> None:
        self._store = settings_store
        self._layout_path = layout_path
        self._pty = manager or PtyManager()
        self._sessions: dict[str, HubSession] = {}
        self._listeners: set[Callable[[dict[str, Any]], None]] = set()
        self.active_user_session: str | None = None

    # -- settings / profiles ------------------------------------------------
    def settings(self) -> TerminalSettings:
        return self._store.load()

    def profiles(self, *, refresh: bool = False) -> list[TerminalProfile]:
        return all_profiles(self.settings(), refresh_wsl=refresh)

    # -- events --------------------------------------------------------------
    def add_listener(self, listener: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def _emit(self, event: dict[str, Any]) -> None:
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception as exc:  # noqa: BLE001
                logger.debug("terminal hub listener failed: {}", exc)

    def _changed(self) -> None:
        self._emit({"type": "sessions", "sessions": self.list()})
        self._save_layout()

    # -- queries ---------------------------------------------------------------
    def list(self) -> list[dict[str, Any]]:
        return [s.info() for s in sorted(self._sessions.values(), key=lambda s: s.created_at)]

    def get(self, session_id: str) -> HubSession:
        session = self._sessions.get(session_id)
        if session is None:
            raise TerminalHubError(f"no terminal session {session_id}")
        return session

    def history(self, session_id: str) -> list[str]:
        return list(self.get(session_id).history)

    # -- lifecycle ---------------------------------------------------------------
    def _spawn_argv(self, profile: TerminalProfile, cwd: str | None) -> tuple[tuple[str, ...], str | None, dict[str, str]]:
        env: dict[str, str] = {}
        argv = list(profile.argv)
        spawn_cwd = cwd
        if profile.kind == "wsl":
            # wsl.exe chooses the Linux cwd itself (--cd accepts Windows or Linux paths).
            if cwd:
                if "--cd" in argv:
                    argv[argv.index("--cd") + 1] = cwd
                else:
                    argv += ["--cd", cwd]
            spawn_cwd = None
            env["PROMPT_COMMAND"] = _BASH_PROMPT_COMMAND
            wslenv = os.environ.get("WSLENV", "")
            env["WSLENV"] = ":".join(p for p in (wslenv, "PROMPT_COMMAND/u") if p)
        elif profile.kind == "bash":
            env["PROMPT_COMMAND"] = _BASH_PROMPT_COMMAND
        elif profile.kind == "cmd":
            env["PROMPT"] = _CMD_PROMPT
        elif profile.kind in ("pwsh", "powershell"):
            argv = [argv[0], "-NoLogo", "-NoExit", "-Command", _PS_PROMPT_HOOK]
        if spawn_cwd and not Path(spawn_cwd).is_dir():
            raise TerminalHubError(f"working directory does not exist: {spawn_cwd}")
        return tuple(argv), spawn_cwd, env

    async def create(
        self,
        *,
        profile_id: str | None = None,
        name: str | None = None,
        cwd: str | None = None,
        cols: int = 120,
        rows: int = 30,
        owner: str = "user",
        workspace: str | None = None,
    ) -> HubSession:
        if owner not in ("user", "agent"):
            raise TerminalHubError("owner must be 'user' or 'agent'")
        live = [s for s in self._sessions.values() if s.status != "exited"]
        if len(live) >= MAX_SESSIONS:
            raise TerminalHubError(f"at most {MAX_SESSIONS} terminals can be open")
        settings = self.settings()
        profiles = all_profiles(settings)
        profile = find_profile(profile_id, profiles) if profile_id else default_profile(settings, profiles)
        if profile is None:
            raise TerminalHubError(f"unknown terminal profile {profile_id!r}" if profile_id else "no shell is available")
        fallback = "~" if profile.kind == "wsl" else (settings.startup_cwd or str(Path.home()))
        start_cwd = cwd or profile.cwd or workspace or fallback
        argv, spawn_cwd, hook_env = self._spawn_argv(profile, start_cwd)
        number = 1 + sum(1 for s in self._sessions.values() if s.owner == owner)
        default_name = f"Kylo AI {number}" if owner == "agent" else f"{profile.label.split(':')[-1].strip()} {number}"
        session = HubSession(
            id=uuid.uuid4().hex[:12],
            name=(name or default_name)[:MAX_NAME_LEN],
            owner=owner,
            profile_id=profile.id,
            profile_label=profile.label,
            kind=profile.kind,
            cwd=start_cwd,
            created_at=time.time(),
            workspace=workspace,
        )
        env = {**os.environ, **settings.env, **profile.env, **hook_env}
        cols = max(10, min(int(cols), 500))
        rows = max(4, min(int(rows), 200))

        async def on_output(_pty_id: str, data: str) -> None:
            self._on_output(session, data)

        async def on_closed(_pty_id: str, code: int) -> None:
            session.status = "exited"
            session.exit_code = code
            self._broadcast(session, {"t": "exit", "code": code})
            self._changed()

        try:
            pty = await self._pty.spawn(
                shell_argv=argv,
                shell_id=profile.id,
                cwd=spawn_cwd,
                cols=cols,
                rows=rows,
                on_output=on_output,
                on_closed=on_closed,
                env=env,
            )
        except Exception as exc:  # noqa: BLE001
            raise TerminalHubError(f"could not start {profile.label}: {exc}") from exc
        session.pty_id = pty.terminal_id
        session.pid = pty.pid
        session.status = "running"
        self._sessions[session.id] = session
        if owner == "user" and self.active_user_session is None:
            self.active_user_session = session.id
        logger.info("terminal {} started: profile={} owner={} pid={}", session.id, profile.id, owner, pty.pid)
        self._changed()
        return session

    async def close(self, session_id: str) -> None:
        session = self.get(session_id)
        if session.pty_id:
            self._pty.close(session.pty_id)
        self._broadcast(session, {"t": "closed"})
        self._sessions.pop(session_id, None)
        if self.active_user_session == session_id:
            self.active_user_session = next(
                (s.id for s in self._sessions.values() if s.owner == "user" and s.status == "running"), None
            )
        self._changed()

    async def close_all(self) -> None:
        for session in list(self._sessions.values()):
            if session.pty_id:
                self._pty.close(session.pty_id)
        self._sessions.clear()

    def rename(self, session_id: str, name: str) -> HubSession:
        session = self.get(session_id)
        name = (name or "").strip()
        if not name:
            raise TerminalHubError("name is empty")
        session.name = name[:MAX_NAME_LEN]
        self._changed()
        return session

    def set_active(self, session_id: str | None) -> None:
        if session_id is not None:
            session = self.get(session_id)
            if session.owner != "user":
                raise TerminalHubError("only a user terminal can be the active terminal")
        self.active_user_session = session_id

    # -- I/O -------------------------------------------------------------------
    def write(self, session_id: str, data: str, *, source: str = "user") -> None:
        session = self.get(session_id)
        if session.status != "running" or not session.pty_id:
            raise TerminalHubError("terminal is not running")
        if len(data) > 1_000_000:
            raise TerminalHubError("input too large")
        if source == "user":
            self._record_input(session, data)
        self._pty.write(session.pty_id, data)

    def resize(self, session_id: str, cols: int, rows: int) -> None:
        session = self.get(session_id)
        if session.pty_id:
            self._pty.resize(session.pty_id, max(10, min(int(cols), 500)), max(4, min(int(rows), 200)))

    def _record_input(self, session: HubSession, data: str) -> None:
        for ch in data:
            if ch in "\r\n":
                line = session.line_buffer.strip()
                session.line_buffer = ""
                if line:
                    session.history.append(line)
            elif ch in ("\x7f", "\b"):
                session.line_buffer = session.line_buffer[:-1]
            elif ch == "\x03" or ch == "\x15":
                session.line_buffer = ""
            elif ch == "\x1b" or ord(ch) < 32:
                continue
            else:
                session.line_buffer += ch
        if len(session.line_buffer) > 4000:
            session.line_buffer = session.line_buffer[-4000:]

    def _on_output(self, session: HubSession, data: str) -> None:
        session.last_output_at = time.monotonic()
        session.replay.append(data)
        session.replay_chars += len(data)
        while session.replay_chars > REPLAY_LIMIT_CHARS and len(session.replay) > 1:
            session.replay_chars -= len(session.replay.popleft())
        for match in _OSC7_RE.finditer(data):
            path = _osc7_path(match.group(1), session.kind)
            if path and path != session.cwd:
                session.cwd = path
                self._emit({"type": "cwd", "session_id": session.id, "cwd": path})
        for tap in list(session.output_taps):
            try:
                tap(data)
            except Exception:  # noqa: BLE001
                pass
        self._broadcast(session, {"t": "o", "d": data})

    def _broadcast(self, session: HubSession, frame: dict[str, Any]) -> None:
        for queue in list(session.viewers):
            try:
                queue.put_nowait(frame)
            except asyncio.QueueFull:
                # A viewer that cannot keep up is dropped; it can re-attach and replay.
                session.viewers.discard(queue)
                try:
                    queue.put_nowait({"t": "overflow"})
                except asyncio.QueueFull:
                    pass

    def attach(self, session_id: str) -> tuple[str, asyncio.Queue[dict[str, Any]]]:
        session = self.get(session_id)
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=4000)
        session.viewers.add(queue)
        self._emit({"type": "sessions", "sessions": self.list()})
        return "".join(session.replay), queue

    def detach(self, session_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        session = self._sessions.get(session_id)
        if session is not None:
            session.viewers.discard(queue)

    def clear_replay(self, session_id: str) -> None:
        session = self.get(session_id)
        session.replay.clear()
        session.replay_chars = 0

    # -- agent execution inside a PTY -------------------------------------------
    @staticmethod
    def marked_command(kind: str, command: str, token: str) -> str:
        """The line typed into the shell: the command plus an exit-code report.

        The report prints ``<RS>KYLO_DONE:<token>:<code><RS>``. The *echo* of the
        typed line shows the source text (``[char]30``, ``\\036``, ``%^errorlevel%``)
        rather than the rendered marker, so only the real report matches.
        """
        if kind in ("pwsh", "powershell"):
            return (
                f"{command}; $__kk = $?; Write-Host ([string][char]30 + 'KYLO_DONE:{token}:' + "
                f"$(if ($__kk) {{0}} elseif ($LASTEXITCODE) {{$LASTEXITCODE}} else {{1}}) + [string][char]30)"
            )
        if kind == "cmd":
            return f"{command} & call echo __KYLO_DONE_{token}_%^errorlevel%__"
        return f"{command}; printf '\\036KYLO_DONE:{token}:%s\\036\\n' \"$?\""

    @staticmethod
    def _done_pattern(kind: str, token: str) -> re.Pattern[str]:
        if kind == "cmd":
            return re.compile(rf"(?m)^__KYLO_DONE_{token}_(-?\d+)__\s*$")
        return re.compile(rf"\x1eKYLO_DONE:{token}:(-?\d+)\x1e")

    async def run_command(
        self,
        session_id: str,
        command: str,
        *,
        timeout_s: float = 120.0,
        cancel: asyncio.Event | None = None,
    ) -> dict[str, Any]:
        """Type ``command`` into a session (as the AI) and wait for its exit code."""
        session = self.get(session_id)
        if session.status != "running":
            raise TerminalHubError("terminal is not running")
        if session.agent_busy:
            raise TerminalHubError("the AI is already running a command in this terminal")
        if "\n" in command or "\r" in command:
            raise TerminalHubError("send one line at a time to an interactive terminal")
        token = uuid.uuid4().hex[:10]
        pattern = self._done_pattern(session.kind, token)
        collected: list[str] = []
        done = asyncio.Event()
        result: dict[str, Any] = {"exit_code": None}

        def tap(data: str) -> None:
            collected.append(data)
            # Matched on escape-free text: cmd.exe puts a window-title OSC (which
            # itself quotes the marker) on the same line as the real report.
            match = pattern.search(strip_ansi("".join(collected[-50:])))
            if match:
                result["exit_code"] = int(match.group(1))
                done.set()

        session.agent_busy = True
        session.output_taps.add(tap)
        self._broadcast(session, {"t": "agent", "command": command})
        self._emit({"type": "agent-command", "session_id": session.id, "command": command})
        started = time.time()
        status = "succeeded"
        try:
            self.write(session.id, self.marked_command(session.kind, command, token) + "\r", source="agent")
            waiters = [asyncio.create_task(done.wait())]
            if cancel is not None:
                waiters.append(asyncio.create_task(cancel.wait()))
            finished, pending = await asyncio.wait(waiters, timeout=timeout_s, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            if not done.is_set():
                status = "cancelled" if cancel is not None and cancel.is_set() else "timeout"
                if session.pty_id and session.status == "running":
                    self._pty.write(session.pty_id, "\x03")  # Ctrl+C the command
            elif result["exit_code"] != 0:
                status = "failed"
        finally:
            session.output_taps.discard(tap)
            session.agent_busy = False
            self._emit({"type": "sessions", "sessions": self.list()})
        output = strip_ansi("".join(collected))
        output = pattern.sub("", output)
        lines = output.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        # Drop the echoed command line(s) at the top.
        while lines and (token in lines[0] or not lines[0].strip()):
            lines.pop(0)
        return {
            "session_id": session.id,
            "command": command,
            "status": status,
            "exit_code": result["exit_code"],
            "output": "\n".join(line for line in lines if token not in line).strip("\n")[-40_000:],
            "cwd": session.cwd,
            "duration_s": round(time.time() - started, 3),
        }

    async def agent_session(self, workspace: str | None, profile_id: str | None = None) -> HubSession:
        """The AI's own terminal for a workspace ("new session" mode), reused across commands."""
        for session in self._sessions.values():
            if session.owner == "agent" and session.status == "running" and session.workspace == workspace and not session.agent_busy:
                if profile_id is None or session.profile_id == profile_id:
                    return session
        session = await self.create(profile_id=profile_id, owner="agent", workspace=workspace, cwd=workspace)
        await asyncio.sleep(1.5)  # let the shell print its prompt before typing
        return session

    # -- layout persistence (restore tabs after restart) ------------------------
    def _save_layout(self) -> None:
        layout = [
            {"name": s.name, "profile_id": s.profile_id, "cwd": s.cwd, "workspace": s.workspace}
            for s in sorted(self._sessions.values(), key=lambda s: s.created_at)
            if s.owner == "user" and s.status == "running"
        ]
        try:
            self._layout_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._layout_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(layout, indent=2), encoding="utf-8")
            os.replace(tmp, self._layout_path)
        except OSError as exc:
            logger.debug("terminal layout not saved: {}", exc)

    def saved_layout(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self._layout_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        return [d for d in data if isinstance(d, dict)][:MAX_SESSIONS] if isinstance(data, list) else []

    async def restore_layout(self) -> list[HubSession]:
        restored: list[HubSession] = []
        for entry in self.saved_layout():
            cwd = entry.get("cwd")
            if isinstance(cwd, str) and not cwd.startswith(("/", "~")) and not Path(cwd).is_dir():
                cwd = None
            try:
                restored.append(
                    await self.create(
                        profile_id=entry.get("profile_id"),
                        name=entry.get("name"),
                        cwd=cwd if isinstance(cwd, str) else None,
                        workspace=entry.get("workspace"),
                    )
                )
            except TerminalHubError as exc:
                logger.info("terminal not restored: {}", exc)
        return restored
