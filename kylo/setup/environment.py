"""Development environment detection for the Kylo setup dashboard.

Detects, without installing or changing anything:

* WSL 2 and its distributions, plus the Linux-side toolchain of the preferred
  distribution (git, node, npm, python3, pip, gcc, make, …),
* Git, GitHub CLI (installed, signed in, account), Node.js, npm, pnpm, yarn,
  Python, Docker (CLI and daemon), Ollama (installed, API running, models),
* coding agents: Claude Code, Gemini CLI, Antigravity, Codex, OpenCode, Cursor.

Every probe is a fixed argv with a timeout. Installation is never done here:
each missing tool carries an ``install`` hint (a command the user can run in
a visible Kylo terminal, or a download page), and the UI asks first.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import asdict, dataclass, field
from typing import Any

from kylo.terminal.profiles import list_wsl_distros, wsl_exe_path

_PROBE_TIMEOUT_S = 10.0
_CACHE_TTL_S = 60.0
_VERSION_RE = re.compile(r"(\d+\.\d+(?:\.\d+)?(?:[-+.\w]*)?)")
_IS_WIN = sys.platform == "win32"


@dataclass(slots=True)
class ToolStatus:
    id: str
    name: str
    category: str
    installed: bool = False
    version: str | None = None
    path: str | None = None
    status: str = "missing"  # ok | missing | warning | error
    detail: str | None = None
    install: dict[str, str] | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _run(argv: list[str], timeout: float = _PROBE_TIMEOUT_S, env: dict[str, str] | None = None) -> tuple[int, str, str]:
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv
            argv,
            capture_output=True,
            timeout=timeout,
            check=False,
            stdin=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            env={**os.environ, **(env or {}), "GH_PROMPT_DISABLED": "1", "NO_COLOR": "1"},
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return -1, "", str(exc)
    out = completed.stdout.decode("utf-8", errors="replace")
    err = completed.stderr.decode("utf-8", errors="replace")
    return completed.returncode, out, err


def _first_version(text: str) -> str | None:
    match = _VERSION_RE.search(text or "")
    return match.group(1) if match else None


def _which(*names: str) -> str | None:
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


_INSTALL: dict[str, dict[str, str]] = {
    "wsl": {"command": "wsl --install -d Ubuntu", "shell": "powershell", "note": "Run as administrator, then restart Windows.", "url": "https://learn.microsoft.com/windows/wsl/install"},
    "git": {"command": "winget install --id Git.Git -e", "shell": "powershell", "url": "https://git-scm.com/downloads"},
    "gh": {"command": "winget install --id GitHub.cli -e", "shell": "powershell", "url": "https://cli.github.com/"},
    "node": {"command": "winget install --id OpenJS.NodeJS.LTS -e", "shell": "powershell", "url": "https://nodejs.org/"},
    "npm": {"command": "winget install --id OpenJS.NodeJS.LTS -e", "shell": "powershell", "note": "npm ships with Node.js."},
    "pnpm": {"command": "npm install -g pnpm", "shell": "powershell", "url": "https://pnpm.io/installation"},
    "yarn": {"command": "npm install -g yarn", "shell": "powershell", "url": "https://yarnpkg.com/getting-started/install"},
    "python": {"command": "winget install --id Python.Python.3.12 -e", "shell": "powershell", "url": "https://www.python.org/downloads/"},
    "docker": {"command": "winget install --id Docker.DockerDesktop -e", "shell": "powershell", "url": "https://docs.docker.com/desktop/setup/install/windows-install/"},
    "ollama": {"command": "winget install --id Ollama.Ollama -e", "shell": "powershell", "url": "https://ollama.com/download"},
    "claude": {"command": "npm install -g @anthropic-ai/claude-code", "shell": "powershell", "url": "https://docs.anthropic.com/en/docs/claude-code"},
    "gemini": {"command": "npm install -g @google/gemini-cli", "shell": "powershell", "url": "https://github.com/google-gemini/gemini-cli"},
    "codex": {"command": "npm install -g @openai/codex", "shell": "powershell", "url": "https://github.com/openai/codex"},
    "opencode": {"command": "npm install -g opencode-ai", "shell": "powershell", "url": "https://opencode.ai/"},
    "agy": {"url": "https://antigravity.google/", "note": "Install Google Antigravity, then sign in from its app."},
    "cursor-agent": {"url": "https://cursor.com/cli", "note": "Install the Cursor CLI from cursor.com/cli."},
}

if not _IS_WIN:
    for key in ("git", "gh", "node", "npm", "python", "docker", "ollama"):
        _INSTALL[key] = {"url": _INSTALL[key].get("url", ""), "note": "Install with your system package manager."}


def _version_tool(tool_id: str, name: str, category: str, binaries: tuple[str, ...], argv_tail: tuple[str, ...] = ("--version",)) -> ToolStatus:
    status = ToolStatus(tool_id, name, category, install=_INSTALL.get(tool_id))
    path = _which(*binaries)
    if path is None:
        status.detail = f"{name} was not found on PATH"
        return status
    status.path = path
    rc, out, err = _run([path, *argv_tail])
    status.installed = True
    status.version = _first_version(out or err)
    status.status = "ok" if rc == 0 else "warning"
    if rc != 0:
        status.detail = (err or out).strip().splitlines()[-1][:300] if (err or out).strip() else f"exit {rc}"
    status.install = None if status.status == "ok" else status.install
    return status


def probe_git() -> ToolStatus:
    status = _version_tool("git", "Git", "core", ("git",))
    if status.installed:
        rc, out, _ = _run([status.path or "git", "config", "--global", "user.name"])
        status.extra["user_name"] = out.strip() or None
        if not out.strip():
            status.status = "warning"
            status.detail = "git user.name is not set (git config --global user.name \"Your Name\")"
    return status


def probe_gh() -> ToolStatus:
    status = _version_tool("gh", "GitHub CLI", "core", ("gh",))
    if not status.installed:
        return status
    gh = status.path or "gh"
    rc, out, err = _run([gh, "auth", "status", "--hostname", "github.com"])
    text = out + err
    authenticated = rc == 0
    status.extra["authenticated"] = authenticated
    if authenticated:
        rc2, login, _ = _run([gh, "api", "user", "--jq", ".login"])
        status.extra["login"] = login.strip() if rc2 == 0 else None
        match = re.search(r"Token scopes:\s*(.+)", text)
        if match:
            status.extra["scopes"] = [s.strip(" '") for s in match.group(1).split(",") if s.strip()]
        status.status = "ok"
        status.detail = f"Signed in as {status.extra.get('login') or 'unknown'}"
    else:
        status.status = "warning"
        status.detail = "Not signed in. Run `gh auth login` in a terminal."
        status.install = {"command": "gh auth login", "shell": "powershell", "note": "Sign in to GitHub (interactive)."}
    return status


def probe_python() -> ToolStatus:
    status = ToolStatus("python", "Python", "runtime", install=_INSTALL.get("python"))
    candidates = [["py", "-3", "--version"], ["python", "--version"], ["python3", "--version"]] if _IS_WIN else [["python3", "--version"], ["python", "--version"]]
    for argv in candidates:
        path = shutil.which(argv[0])
        if path is None or "WindowsApps" in path and argv[0] in ("python", "python3"):
            continue  # skip the Microsoft Store alias stub
        rc, out, err = _run([path, *argv[1:]])
        if rc == 0:
            status.installed, status.path, status.status = True, path, "ok"
            status.version = _first_version(out or err)
            status.install = None
            if _IS_WIN and argv[0] == "py":
                rc2, listing, _ = _run([path, "-0p"])
                status.extra["interpreters"] = [ln.strip() for ln in listing.splitlines() if ln.strip()][:10] if rc2 == 0 else []
            return status
    status.detail = "Python was not found"
    return status


def probe_docker() -> ToolStatus:
    status = _version_tool("docker", "Docker", "runtime", ("docker",))
    if not status.installed:
        return status
    rc, out, err = _run([status.path or "docker", "info", "--format", "{{.ServerVersion}}"], timeout=8)
    status.extra["daemon_running"] = rc == 0 and bool(out.strip())
    if rc == 0 and out.strip():
        status.extra["server_version"] = out.strip()
    else:
        status.status = "warning"
        status.detail = "Docker is installed but the engine is not running (start Docker Desktop)."
    return status


def probe_ollama() -> ToolStatus:
    status = _version_tool("ollama", "Ollama", "ai", ("ollama",))
    if not status.installed and _IS_WIN:
        local = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Ollama", "ollama.exe")
        if os.path.isfile(local):
            status.installed, status.path, status.status, status.install = True, local, "ok", None
    host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
    if not host.startswith("http"):
        host = "http://" + host
    try:
        with urllib.request.urlopen(host.rstrip("/") + "/api/tags", timeout=2.5) as resp:  # noqa: S310 - local API
            data = json.loads(resp.read().decode("utf-8"))
        models = [m.get("name") for m in data.get("models", []) if isinstance(m, dict)]
        status.extra.update({"api_running": True, "host": host, "models": models})
        if not status.installed:
            status.installed, status.status, status.install = True, "ok", None
        status.detail = f"API running, {len(models)} model(s)"
        if not models:
            status.status = "warning"
            status.detail = "API running but no models are pulled (e.g. `ollama pull llama3.2`)."
    except (OSError, ValueError):
        status.extra.update({"api_running": False, "host": host, "models": []})
        if status.installed:
            status.status = "warning"
            status.detail = "Ollama is installed but its API is not running (start Ollama or `ollama serve`)."
    return status


def probe_wsl() -> ToolStatus:
    status = ToolStatus("wsl", "WSL 2", "core", install=_INSTALL.get("wsl"))
    if not _IS_WIN:
        status.status, status.detail, status.install = "ok", "Not needed on this platform", None
        status.extra["not_applicable"] = True
        return status
    exe = wsl_exe_path()
    if exe is None:
        status.detail = "WSL is not installed"
        return status
    distros = [d for d in list_wsl_distros(refresh=True) if not d.name.lower().startswith("docker-desktop")]
    status.path = exe
    status.extra["distros"] = [d.to_dict() for d in distros]
    if not distros:
        status.status = "warning"
        status.installed = True
        status.detail = "WSL is present but no Linux distribution is installed (`wsl --install -d Ubuntu`)."
        return status
    status.installed = True
    rc, out, _ = _run([exe, "--version"], env={"WSL_UTF8": "1"})
    status.version = _first_version(out.replace("\x00", "")) if rc == 0 else None
    v1 = [d.name for d in distros if d.version != 2]
    status.status = "warning" if v1 and len(v1) == len(distros) else "ok"
    status.install = None
    status.detail = f"{len(distros)} distribution(s)" + (f"; WSL 1: {', '.join(v1)}" if v1 else "")
    return status


_LINUX_TOOLS = ("git", "node", "npm", "pnpm", "yarn", "python3", "pip3", "gcc", "g++", "make", "cmake", "go", "rustc", "cargo", "java", "docker", "gh")

_LINUX_PROBE = (
    "for t in " + " ".join(_LINUX_TOOLS) + "; do "
    "p=$(command -v $t 2>/dev/null); "
    "if [ -n \"$p\" ]; then v=$($t --version 2>&1 | head -n1); printf '%s\\t%s\\t%s\\n' \"$t\" \"$p\" \"$v\"; "
    "else printf '%s\\t\\t\\n' \"$t\"; fi; done"
)


def probe_wsl_toolchain(distro: str | None) -> dict[str, Any]:
    exe = wsl_exe_path()
    if not _IS_WIN or exe is None or not distro:
        return {"distro": distro, "tools": [], "error": None if not _IS_WIN else "WSL is not available"}
    rc, out, err = _run([exe, "-d", distro, "--exec", "bash", "-lc", _LINUX_PROBE], timeout=40)
    if rc != 0 and not out:
        return {"distro": distro, "tools": [], "error": (err or f"exit {rc}").strip()[:300]}
    tools = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0] in _LINUX_TOOLS:
            tools.append(
                {
                    "id": parts[0],
                    "installed": bool(parts[1]),
                    "path": parts[1] or None,
                    "version": _first_version(parts[2]) if len(parts) > 2 else None,
                }
            )
    return {"distro": distro, "tools": tools, "error": None}


_AGENT_CLIS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("claude", "Claude Code", ("claude",)),
    ("gemini", "Gemini CLI", ("gemini",)),
    ("agy", "Antigravity", ("agy",)),
    ("codex", "Codex CLI", ("codex",)),
    ("opencode", "OpenCode", ("opencode",)),
    ("cursor-agent", "Cursor CLI", ("cursor-agent", "agent")),
)


def probe_agents() -> list[ToolStatus]:
    statuses = []
    for tool_id, name, binaries in _AGENT_CLIS:
        statuses.append(_version_tool(tool_id, name, "agent", binaries))
    return statuses


_cache_lock = threading.Lock()
_cache: tuple[float, dict[str, Any]] | None = None


def detect_environment(*, refresh: bool = False, include_wsl_tools: bool = True) -> dict[str, Any]:
    """Full environment report (cached for a minute unless ``refresh``)."""
    global _cache
    with _cache_lock:
        if not refresh and _cache is not None and time.monotonic() - _cache[0] < _CACHE_TTL_S:
            return _cache[1]
    started = time.monotonic()
    probes = {
        "wsl": probe_wsl,
        "git": probe_git,
        "gh": probe_gh,
        "node": lambda: _version_tool("node", "Node.js", "runtime", ("node",)),
        "npm": lambda: _version_tool("npm", "npm", "runtime", ("npm",)),
        "pnpm": lambda: _version_tool("pnpm", "pnpm", "runtime", ("pnpm",)),
        "yarn": lambda: _version_tool("yarn", "Yarn", "runtime", ("yarn",)),
        "python": probe_python,
        "docker": probe_docker,
        "ollama": probe_ollama,
    }
    results: dict[str, ToolStatus] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8, thread_name_prefix="kylo-env") as pool:
        futures = {pool.submit(fn): key for key, fn in probes.items()}
        agents_future = pool.submit(probe_agents)
        for future in concurrent.futures.as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
            except Exception as exc:  # noqa: BLE001
                results[key] = ToolStatus(key, key, "core", status="error", detail=str(exc))
        agents = agents_future.result()

    from kylo.terminal.services import get_services

    settings = get_services().settings.load()
    from kylo.terminal.profiles import preferred_wsl_distro

    distro = preferred_wsl_distro(settings) if results["wsl"].installed else None
    wsl_tools = probe_wsl_toolchain(distro) if include_wsl_tools and distro else {"distro": distro, "tools": [], "error": None}
    ordered = [results[k] for k in probes] + agents
    report = {
        "platform": sys.platform,
        "tools": [t.to_dict() for t in ordered],
        "wsl_toolchain": wsl_tools,
        "terminals": [p.to_dict() for p in get_services().hub.profiles()],
        "recommendations": recommendations(ordered, wsl_tools),
        "duration_s": round(time.monotonic() - started, 2),
        "checked_at": time.time(),
    }
    with _cache_lock:
        _cache = (time.monotonic(), report)
    return report


def recommendations(tools: list[ToolStatus], wsl_tools: dict[str, Any]) -> list[dict[str, str]]:
    by_id = {t.id: t for t in tools}
    recs: list[dict[str, str]] = []

    def add(level: str, text: str, tool: str | None = None) -> None:
        recs.append({"level": level, "text": text, **({"tool": tool} if tool else {})})

    if _IS_WIN and not by_id["wsl"].installed:
        add("important", "Install WSL 2 with Ubuntu: agents run Linux builds and tests there by default.", "wsl")
    if not by_id["git"].installed:
        add("important", "Install Git: needed for version control and GitHub workflows.", "git")
    if not by_id["gh"].installed:
        add("important", "Install the GitHub CLI so Kylo can clone repositories and open pull requests.", "gh")
    elif not by_id["gh"].extra.get("authenticated"):
        add("important", "Sign in to GitHub with `gh auth login`.", "gh")
    if not by_id["node"].installed:
        add("suggested", "Install Node.js LTS for JavaScript/TypeScript projects.", "node")
    if not by_id["python"].installed:
        add("suggested", "Install Python 3 for Python projects and tooling.", "python")
    if not by_id["ollama"].installed:
        add("optional", "Install Ollama to run local models without an API key.", "ollama")
    elif not by_id["ollama"].extra.get("api_running"):
        add("suggested", "Start Ollama so its local models can be used.", "ollama")
    if not any(t.installed for t in tools if t.category == "agent"):
        add("optional", "Install a coding agent CLI (Claude Code, Gemini CLI, Codex) to delegate tasks to it.")
    linux = {t["id"]: t for t in wsl_tools.get("tools", [])}
    if linux:
        missing = [name for name in ("git", "node", "python3", "make", "gcc") if not linux.get(name, {}).get("installed")]
        if missing:
            add(
                "suggested",
                f"In WSL ({wsl_tools.get('distro')}), install: {', '.join(missing)} "
                "(e.g. `sudo apt update && sudo apt install -y build-essential git python3 python3-pip nodejs npm`).",
                "wsl",
            )
    return recs
