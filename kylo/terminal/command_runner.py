"""Agent command execution: one command, streamed, with an exit code.

This is the *controlled execution API* agents use (``terminal-run`` tool,
``POST /api/terminals/runs``). It is deliberately separate from the interactive
PTY sessions in :mod:`kylo.terminal.hub`:

* stdout and stderr arrive on separate pipes, so an agent can tell them apart,
* the exit code is the command's own, and the working directory it ended in is
  reported back (``final_cwd``) so the next command continues from there,
* every run is cancellable: the whole process tree is terminated (Job Object on
  Windows, process group on POSIX), not just the shell,
* every run is logged to SQLite (``<DATA_DIR>/terminal/runs.db``) for review.

Shells and how the command reaches them — never by splicing the command into
a shell line we build:

* **WSL**: ``wsl.exe -d <distro> --exec bash -lc <FIXED_SCRIPT> kylo <cwd> <command>``.
  The script is a constant; the command and cwd are positional parameters that
  the script ``eval``s / ``cd``s into.
* **Git Bash / POSIX sh**: the same fixed script with ``bash -lc`` / ``sh -c``.
* **PowerShell / pwsh**: ``-EncodedCommand`` of a fixed wrapper; the command
  and cwd are embedded as base64 literals, which cannot break out of a string.
* **CMD**: ``cmd.exe /d /s /c "<command>"`` with the process cwd set; CMD
  commands must be a single line.

The command text itself is of course a shell command — that is the point of
the tool. Whether it may run is decided *before* it gets here, by the risk
tier / autonomy policy (``kylo.security.autonomy``).
"""
from __future__ import annotations

import asyncio
import base64
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from loguru import logger

from kylo.core.process_tree import make_process_tree
from kylo.terminal.profiles import (
    TerminalSettings,
    list_wsl_distros,
    preferred_wsl_distro,
    windows_path_to_wsl,
    wsl_exe_path,
)
from kylo.terminal.shells import discover_shells

ShellKind = Literal["wsl", "powershell", "pwsh", "cmd", "bash", "posix"]
RunStatus = Literal["running", "succeeded", "failed", "cancelled", "timeout", "error"]
Stream = Literal["stdout", "stderr", "system"]

SHELL_KINDS: tuple[str, ...] = ("auto", "wsl", "powershell", "pwsh", "cmd", "bash", "posix")
MAX_TIMEOUT_S = 6 * 3600
DEFAULT_TIMEOUT_S = 120.0
MAX_BUFFER_CHARS = 2_000_000
TAIL_PERSIST_CHARS = 64_000
CWD_MARKER = "\x1eKYLO_CWD:"
_CWD_MARKER_RE = re.compile(r"\r?\n?\x1eKYLO_CWD:(.*?)\x1e\r?\n?")
_EXIT_CANNOT_CD = 97

# Constant script for bash-family shells. $1 = cwd, $2 = the command.
# The EXIT trap reports the final directory even if the command calls `exit`.
_BASH_WRAPPER = (
    "__kylo_report() { printf '\\n\\036KYLO_CWD:%s\\036\\n' \"$PWD\"; }; "
    "__kylo_d=\"$1\"; case \"$__kylo_d\" in \"~\"*) __kylo_d=\"$HOME${__kylo_d#\\~}\";; esac; "
    "cd -- \"$__kylo_d\" 2>/dev/null || { printf 'kylo: cannot change directory to %s\\n' \"$1\" >&2; exit 97; }; "
    "trap __kylo_report EXIT; "
    "eval \"$2\""
)

_PS_WRAPPER = r"""
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$__kc = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__CMD__'))
$__kd = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('__CWD__'))
try { Set-Location -LiteralPath $__kd -ErrorAction Stop } catch { [Console]::Error.WriteLine("kylo: cannot change directory to $__kd"); exit 97 }
$global:LASTEXITCODE = 0
$__kok = $true
$__krc = 0
$__kerr = $Error.Count
try {
  try {
    & { Invoke-Expression $__kc } 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { [Console]::Error.WriteLine($_.ToString()) } else { $_ }
    } | Out-Default
    if ($Error.Count -gt $__kerr) { $__kok = $false }
  } catch { [Console]::Error.WriteLine($_.ToString()); $__kok = $false }
  if ($global:LASTEXITCODE -ne 0 -and $null -ne $global:LASTEXITCODE) { $__krc = $global:LASTEXITCODE } elseif (-not $__kok) { $__krc = 1 }
} finally {
  # Runs even when the command itself calls `exit`, like the bash EXIT trap.
  try { $__kp = (Get-Location).ProviderPath } catch { $__kp = $__kd }
  [Console]::Out.WriteLine('')
  [Console]::Out.WriteLine([string][char]30 + 'KYLO_CWD:' + $__kp + [string][char]30)
}
exit $__krc
"""


class CommandRunnerError(ValueError):
    """The command cannot be started as requested (bad shell, cwd, …)."""


@dataclass(slots=True)
class ResolvedShell:
    kind: ShellKind
    label: str
    distro: str | None = None
    program: str | None = None


@dataclass(slots=True)
class RunRecord:
    id: str
    command: str
    shell: str
    shell_label: str
    cwd: str
    owner: str = "agent"
    workspace: str | None = None
    status: RunStatus = "running"
    exit_code: int | None = None
    final_cwd: str | None = None
    started_at: float = field(default_factory=time.time)
    ended_at: float | None = None
    error: str | None = None
    background: bool = False

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["duration_s"] = (
            round((self.ended_at or time.time()) - self.started_at, 3)
        )
        return data


@dataclass(slots=True)
class _LiveRun:
    record: RunRecord
    proc: subprocess.Popen[bytes] | None = None
    tree: Any = None
    chunks: list[tuple[str, str]] = field(default_factory=list)
    chars: int = 0
    truncated: bool = False
    done: asyncio.Event = field(default_factory=asyncio.Event)
    cancel_requested: bool = False
    timed_out: bool = False
    stdout_carry: str = ""


# --------------------------------------------------------------------------- #
# Shell resolution / argv                                                      #
# --------------------------------------------------------------------------- #
def _find_shell(shell_id_prefix: str) -> str | None:
    for shell in discover_shells():
        if shell.id == shell_id_prefix or shell.id.startswith(shell_id_prefix + "-"):
            return shell.argv[0]
    return None


def resolve_shell(requested: str, settings: TerminalSettings) -> ResolvedShell:
    """Map ``auto|wsl|powershell|pwsh|cmd|bash|posix`` to a concrete shell."""
    requested = (requested or "auto").lower()
    if requested not in SHELL_KINDS:
        raise CommandRunnerError(f"unknown shell {requested!r}; use one of {', '.join(SHELL_KINDS)}")
    if requested == "auto":
        requested = settings.agent_default_shell or "auto"
    if sys.platform != "win32":
        if requested in ("wsl", "powershell", "cmd"):
            raise CommandRunnerError(f"{requested} is only available on Windows")
        if requested == "pwsh":
            program = _find_shell("pwsh")
            if program is None:
                raise CommandRunnerError("PowerShell 7 (pwsh) is not installed")
            return ResolvedShell("pwsh", "PowerShell 7", program=program)
        bash = _find_shell("bash") or "/bin/sh"
        return ResolvedShell("posix", Path(bash).name, program=bash)
    if requested == "auto":
        # Linux-compatible coding work defaults to WSL when it exists.
        requested = "wsl" if preferred_wsl_distro(settings) else "powershell"
    if requested == "wsl":
        distro = preferred_wsl_distro(settings)
        if distro is None or wsl_exe_path() is None:
            raise CommandRunnerError(
                "WSL is not available: install it with `wsl --install -d Ubuntu` "
                "(PowerShell as administrator), then restart Kylo"
            )
        return ResolvedShell("wsl", f"WSL: {distro}", distro=distro, program=wsl_exe_path())
    if requested == "pwsh":
        program = _find_shell("pwsh")
        if program is None:
            raise CommandRunnerError("PowerShell 7 (pwsh) is not installed")
        return ResolvedShell("pwsh", "PowerShell 7", program=program)
    if requested == "powershell":
        program = _find_shell("powershell") or "powershell.exe"
        return ResolvedShell("powershell", "Windows PowerShell", program=program)
    if requested == "cmd":
        return ResolvedShell("cmd", "Command Prompt", program=os.environ.get("ComSpec", "cmd.exe"))
    if requested in ("bash", "posix"):
        program = _find_shell("bash")
        if program is None:
            raise CommandRunnerError("Git Bash is not installed; use shell=wsl or powershell")
        return ResolvedShell("bash", "Git Bash", program=program)
    raise CommandRunnerError(f"shell {requested!r} is not available")


def _ps_encoded(script: str) -> str:
    return base64.b64encode(script.encode("utf-16-le")).decode("ascii")


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def build_argv(shell: ResolvedShell, command: str, cwd: str) -> tuple[list[str] | str, str | None]:
    """Return ``(argv_or_cmdline, process_cwd)`` for one command.

    ``process_cwd`` is the directory the *Windows* process starts in (``None``
    when the shell changes into ``cwd`` itself, as WSL and bash do).
    """
    if shell.kind == "wsl":
        assert shell.program and shell.distro
        linux_cwd = cwd if cwd.startswith(("/", "~")) else windows_path_to_wsl(cwd)
        return (
            [shell.program, "-d", shell.distro, "--exec", "bash", "-lc", _BASH_WRAPPER, "kylo", linux_cwd, command],
            None,
        )
    if shell.kind in ("bash", "posix"):
        assert shell.program
        flag = "-lc" if Path(shell.program).name.lower().startswith("bash") else "-c"
        return ([shell.program, flag, _BASH_WRAPPER, "kylo", cwd, command], None)
    if shell.kind in ("powershell", "pwsh"):
        assert shell.program
        script = _PS_WRAPPER.replace("__CMD__", _b64(command)).replace("__CWD__", _b64(cwd))
        return (
            [
                shell.program,
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                _ps_encoded(script),
            ],
            None,
        )
    if shell.kind == "cmd":
        if "\n" in command or "\r" in command:
            raise CommandRunnerError("CMD commands must be a single line; chain with &&")
        program = shell.program or "cmd.exe"
        # A raw command line: list2cmdline would escape quotes with backslashes,
        # which cmd.exe does not understand. /s strips exactly the outer quotes.
        return (f'"{program}" /d /s /c "{command}"', cwd)
    raise CommandRunnerError(f"unsupported shell {shell.kind}")


_CMD_CD_RE = re.compile(r'^\s*(?:cd|chdir)(?:\s+/d)?\s+"?([^"&|<>]+?)"?\s*$', re.IGNORECASE)


def _cmd_cd_target(command: str, cwd: str) -> str | None:
    match = _CMD_CD_RE.match(command)
    if not match:
        return None
    target = Path(match.group(1).strip())
    resolved = target if target.is_absolute() else Path(cwd) / target
    try:
        resolved = resolved.resolve()
    except OSError:
        return None
    return str(resolved) if resolved.is_dir() else None


def msys_path_to_windows(path: str) -> str:
    """Git Bash reports ``/c/Users/me``; Windows APIs need ``C:\\Users\\me``."""
    match = re.match(r"^/([a-zA-Z])(?:/(.*))?$", path or "")
    if sys.platform != "win32" or not match:
        return path
    return f"{match.group(1).upper()}:\\" + (match.group(2) or "").replace("/", "\\")


def split_cwd_marker(text: str) -> tuple[str, str | None]:
    """Remove the trailing cwd report from stdout; return (clean, cwd)."""
    match = None
    for match in _CWD_MARKER_RE.finditer(text):
        pass
    if match is None:
        return text, None
    return text[: match.start()] + text[match.end():], match.group(1).strip() or None


# --------------------------------------------------------------------------- #
# Run log                                                                      #
# --------------------------------------------------------------------------- #
class RunLog:
    """SQLite log of every command run (agent and user)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, command TEXT NOT NULL, shell TEXT, shell_label TEXT,
                    cwd TEXT, final_cwd TEXT, owner TEXT, workspace TEXT, status TEXT,
                    exit_code INTEGER, error TEXT, started_at REAL, ended_at REAL,
                    stdout_tail TEXT, stderr_tail TEXT, background INTEGER DEFAULT 0)"""
            )
            db.execute("CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at DESC)")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self._path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def save(self, record: RunRecord, stdout_tail: str, stderr_tail: str) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                """INSERT OR REPLACE INTO runs VALUES
                (:id,:command,:shell,:shell_label,:cwd,:final_cwd,:owner,:workspace,:status,
                 :exit_code,:error,:started_at,:ended_at,:stdout_tail,:stderr_tail,:background)""",
                {
                    **{k: v for k, v in asdict(record).items()},
                    "background": int(record.background),
                    "stdout_tail": stdout_tail[-TAIL_PERSIST_CHARS:],
                    "stderr_tail": stderr_tail[-TAIL_PERSIST_CHARS:],
                },
            )

    def recent(self, limit: int = 100, owner: str | None = None) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 1000))
        with self._lock, self._connect() as db:
            if owner:
                rows = db.execute(
                    "SELECT * FROM runs WHERE owner=? ORDER BY started_at DESC LIMIT ?", (owner, limit)
                ).fetchall()
            else:
                rows = db.execute("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        return dict(row) if row else None

    def clear(self) -> int:
        with self._lock, self._connect() as db:
            return db.execute("DELETE FROM runs").rowcount


# --------------------------------------------------------------------------- #
# Runner                                                                       #
# --------------------------------------------------------------------------- #
RunListener = Callable[[dict[str, Any]], None]


class CommandRunner:
    """Starts, streams, cancels and logs commands."""

    def __init__(self, log: RunLog, settings_provider: Callable[[], TerminalSettings]) -> None:
        self._log = log
        self._settings = settings_provider
        self._runs: dict[str, _LiveRun] = {}
        self._listeners: set[RunListener] = set()
        self._cwd_memory: dict[str, str] = {}
        self._lock = threading.Lock()

    # -- events -------------------------------------------------------------
    def add_listener(self, listener: RunListener) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def _emit(self, event: dict[str, Any]) -> None:
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception as exc:  # noqa: BLE001
                logger.debug("run listener failed: {}", exc)

    # -- cwd memory ----------------------------------------------------------
    @staticmethod
    def context_key(owner: str, workspace: str | None, shell: str) -> str:
        return f"{owner}|{workspace or ''}|{shell}"

    def remembered_cwd(self, owner: str, workspace: str | None, shell: str) -> str | None:
        return self._cwd_memory.get(self.context_key(owner, workspace, shell))

    # -- lifecycle ------------------------------------------------------------
    async def start(
        self,
        command: str,
        *,
        shell: str = "auto",
        cwd: str | None = None,
        timeout_s: float | None = None,
        owner: str = "agent",
        workspace: str | None = None,
        env: dict[str, str] | None = None,
        background: bool = False,
    ) -> RunRecord:
        command = (command or "").strip()
        if not command:
            raise CommandRunnerError("command is empty")
        if len(command) > 32_000:
            raise CommandRunnerError("command is too long")
        settings = self._settings()
        resolved = resolve_shell(shell, settings)
        key = self.context_key(owner, workspace, resolved.kind)
        effective_cwd = cwd or self._cwd_memory.get(key) or workspace or settings.startup_cwd or str(Path.home())
        if resolved.kind not in ("wsl",) and not Path(effective_cwd).is_dir():
            raise CommandRunnerError(f"working directory does not exist: {effective_cwd}")
        timeout = float(timeout_s if timeout_s is not None else DEFAULT_TIMEOUT_S)
        timeout = max(1.0, min(timeout, MAX_TIMEOUT_S))
        argv, proc_cwd = build_argv(resolved, command, effective_cwd)

        record = RunRecord(
            id=uuid.uuid4().hex[:16],
            command=command,
            shell=resolved.kind,
            shell_label=resolved.label,
            cwd=effective_cwd,
            owner=owner,
            workspace=workspace,
            background=background,
        )
        live = _LiveRun(record=record)
        child_env = {**os.environ, **settings.env, **(env or {})}
        child_env.setdefault("PYTHONIOENCODING", "utf-8")
        child_env["KYLO_AGENT_RUN"] = record.id
        for secret_like in ("JARVIS_CONTROL_KEY", "JARVIS_PTY_HOST_TOKEN"):
            child_env.pop(secret_like, None)
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        try:
            proc = subprocess.Popen(  # noqa: S603 - argv built above, never shell=True
                argv,
                cwd=proc_cwd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=child_env,
                creationflags=creationflags,
                start_new_session=(sys.platform != "win32"),
            )
        except OSError as exc:
            raise CommandRunnerError(f"could not start {resolved.label}: {exc}") from exc
        live.proc = proc
        live.tree = make_process_tree(f"kylo-run:{record.id}")
        try:
            live.tree.assign(proc.pid)
        except Exception as exc:  # noqa: BLE001
            logger.debug("run {} not contained: {}", record.id, exc)
        with self._lock:
            self._runs[record.id] = live
        self._emit({"type": "run.started", "run": record.to_dict()})

        loop = asyncio.get_running_loop()
        readers = [
            threading.Thread(target=self._reader, args=(live, proc.stdout, "stdout", loop), daemon=True),
            threading.Thread(target=self._reader, args=(live, proc.stderr, "stderr", loop), daemon=True),
        ]
        for t in readers:
            t.start()
        asyncio.create_task(self._supervise(live, readers, timeout, key, resolved), name=f"kylo-run-{record.id}")
        return record

    def _reader(self, live: _LiveRun, pipe: Any, stream: Stream, loop: asyncio.AbstractEventLoop) -> None:
        decoder_buf = b""
        try:
            while True:
                chunk = pipe.read1(8192) if hasattr(pipe, "read1") else pipe.read(8192)
                if not chunk:
                    break
                data = decoder_buf + chunk
                try:
                    text = data.decode("utf-8")
                    decoder_buf = b""
                except UnicodeDecodeError as exc:
                    if exc.start >= len(data) - 3:
                        text = data[: exc.start].decode("utf-8", errors="replace")
                        decoder_buf = data[exc.start:]
                    else:
                        text = data.decode("utf-8", errors="replace")
                        decoder_buf = b""
                loop.call_soon_threadsafe(self._append, live, stream, text)
            if decoder_buf:
                loop.call_soon_threadsafe(
                    self._append, live, stream, decoder_buf.decode("utf-8", errors="replace")
                )
        except (OSError, ValueError):
            pass

    def _append(self, live: _LiveRun, stream: Stream, text: str) -> None:
        if not text:
            return
        if stream == "stdout":
            # Remove complete cwd reports, then hold back a trailing fragment
            # that may be the start of one split across two reads.
            text = live.stdout_carry + text
            live.stdout_carry = ""
            text, marker_cwd = split_cwd_marker(text)
            if marker_cwd:
                live.record.final_cwd = marker_cwd
            idx = text.rfind("\x1e")
            if idx != -1:
                tail = text[idx:]
                if CWD_MARKER.startswith(tail[: len(CWD_MARKER)]) and "\x1e" not in tail[1:]:
                    live.stdout_carry = tail
                    text = text[:idx]
            if not text:
                return
        self._store(live, stream, text)

    def _store(self, live: _LiveRun, stream: Stream, text: str) -> None:
        live.chunks.append((stream, text))
        live.chars += len(text)
        while live.chars > MAX_BUFFER_CHARS and len(live.chunks) > 1:
            _, dropped = live.chunks.pop(0)
            live.chars -= len(dropped)
            live.truncated = True
        self._emit({"type": "run.output", "run_id": live.record.id, "stream": stream, "data": text})

    async def _supervise(
        self,
        live: _LiveRun,
        readers: list[threading.Thread],
        timeout: float,
        key: str,
        shell: ResolvedShell,
    ) -> None:
        proc = live.proc
        assert proc is not None
        loop = asyncio.get_running_loop()
        try:
            await asyncio.wait_for(loop.run_in_executor(None, proc.wait), timeout=timeout)
        except TimeoutError:
            live.timed_out = True
            self._kill(live)
            await loop.run_in_executor(None, proc.wait)
        except asyncio.CancelledError:
            self._kill(live)
            raise
        for t in readers:
            await loop.run_in_executor(None, t.join, 2.0)
        await asyncio.sleep(0)  # let queued _append callbacks run
        if live.stdout_carry:
            carry, live.stdout_carry = live.stdout_carry, ""
            clean, marker_cwd = split_cwd_marker(carry)
            if marker_cwd:
                live.record.final_cwd = marker_cwd
            if clean:
                self._store(live, "stdout", clean)
        try:
            if live.tree is not None:
                live.tree.close()
        except Exception:  # noqa: BLE001
            pass

        record = live.record
        record.ended_at = time.time()
        record.exit_code = _normalize_exit(proc.returncode)
        if live.cancel_requested:
            record.status = "cancelled"
        elif live.timed_out:
            record.status = "timeout"
            record.error = f"timed out after {timeout:g}s"
        elif record.exit_code == 0:
            record.status = "succeeded"
        else:
            record.status = "failed"
            if record.exit_code == _EXIT_CANNOT_CD:
                record.error = f"cannot change directory to {record.cwd}"
        if shell.kind == "cmd" and record.status == "succeeded":
            record.final_cwd = _cmd_cd_target(record.command, record.cwd) or record.cwd
        if record.final_cwd and shell.kind == "bash":
            record.final_cwd = msys_path_to_windows(record.final_cwd)
        if record.final_cwd:
            remembered = record.final_cwd
            if shell.kind == "wsl" or Path(remembered).is_dir():
                self._cwd_memory[key] = remembered
        stdout, stderr = self._joined(live, "stdout"), self._joined(live, "stderr")
        try:
            self._log.save(record, stdout, stderr)
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not log run {}: {}", record.id, exc)
        live.done.set()
        self._emit({"type": "run.exit", "run": record.to_dict()})
        # Keep finished runs in memory for a while so output can still be read.
        with self._lock:
            finished = [r for r in self._runs.values() if r.done.is_set()]
            for old in sorted(finished, key=lambda r: r.record.started_at)[:-50]:
                self._runs.pop(old.record.id, None)

    def _kill(self, live: _LiveRun) -> None:
        proc = live.proc
        try:
            if live.tree is not None:
                live.tree.close()
        except Exception:  # noqa: BLE001
            pass
        if proc is not None and proc.poll() is None:
            try:
                if sys.platform == "win32":
                    subprocess.run(  # noqa: S603 - fixed argv
                        ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                        capture_output=True,
                        timeout=10,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                        check=False,
                    )
                else:
                    import signal

                    os.killpg(proc.pid, signal.SIGKILL)
            except Exception:  # noqa: BLE001
                pass
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass

    # -- queries --------------------------------------------------------------
    @staticmethod
    def _joined(live: _LiveRun, stream: str) -> str:
        return "".join(text for s, text in live.chunks if s == stream)

    def cancel(self, run_id: str) -> bool:
        live = self._runs.get(run_id)
        if live is None or live.done.is_set():
            return False
        live.cancel_requested = True
        self._emit({"type": "run.cancelling", "run_id": run_id})
        self._kill(live)
        return True

    def cancel_all(self, owner: str | None = "agent") -> int:
        count = 0
        for run_id, live in list(self._runs.items()):
            if not live.done.is_set() and (owner is None or live.record.owner == owner):
                count += int(self.cancel(run_id))
        return count

    async def wait(self, run_id: str, timeout: float | None = None) -> RunRecord | None:
        live = self._runs.get(run_id)
        if live is None:
            return None
        try:
            await asyncio.wait_for(live.done.wait(), timeout=timeout)
        except TimeoutError:
            pass
        return live.record

    def is_running(self, run_id: str) -> bool:
        live = self._runs.get(run_id)
        return live is not None and not live.done.is_set()

    def output(self, run_id: str, *, max_chars: int = 40_000) -> dict[str, Any] | None:
        live = self._runs.get(run_id)
        if live is not None:
            stdout, stderr = self._joined(live, "stdout"), self._joined(live, "stderr")
            return {
                "run": live.record.to_dict(),
                "stdout": _tail(stdout, max_chars),
                "stderr": _tail(stderr, max_chars // 2),
                "chunks": [{"stream": s, "data": d} for s, d in live.chunks[-2000:]],
                "truncated": live.truncated or len(stdout) > max_chars or len(stderr) > max_chars // 2,
            }
        row = self._log.get(run_id)
        if row is None:
            return None
        stdout, stderr = row.pop("stdout_tail") or "", row.pop("stderr_tail") or ""
        row["duration_s"] = round((row.get("ended_at") or 0) - (row.get("started_at") or 0), 3)
        row["background"] = bool(row.get("background"))
        return {
            "run": row,
            "stdout": _tail(stdout, max_chars),
            "stderr": _tail(stderr, max_chars // 2),
            "chunks": [{"stream": "stdout", "data": stdout}, {"stream": "stderr", "data": stderr}],
            "truncated": len(stdout) >= TAIL_PERSIST_CHARS,
        }

    def active(self) -> list[dict[str, Any]]:
        return [r.record.to_dict() for r in self._runs.values() if not r.done.is_set()]

    def recent(self, limit: int = 100, owner: str | None = None) -> list[dict[str, Any]]:
        live = {r.record.id: r.record.to_dict() for r in self._runs.values() if not r.done.is_set()}
        rows = []
        for row in self._log.recent(limit, owner):
            row.pop("stdout_tail", None)
            row.pop("stderr_tail", None)
            row["background"] = bool(row.get("background"))
            rows.append(row)
        running = [r for r in live.values() if owner is None or r["owner"] == owner]
        return running + [r for r in rows if r["id"] not in live]

    def clear_history(self) -> int:
        return self._log.clear()

    def wsl_distros(self) -> list[dict[str, Any]]:
        return [d.to_dict() for d in list_wsl_distros()]


def _tail(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return "…[earlier output truncated]…\n" + text[-limit:]


def _normalize_exit(code: int | None) -> int | None:
    if code is None:
        return None
    if code > 0x7FFFFFFF:
        return code - 0x100000000
    return code
