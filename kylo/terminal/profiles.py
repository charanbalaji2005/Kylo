"""Terminal profiles: which shells a terminal (or an agent command) can run in.

A *profile* is a named way to start a shell: PowerShell 7, Windows PowerShell,
CMD, Git Bash, one entry per installed WSL distribution, the POSIX shells on
macOS/Linux, and any custom profile the user configured (shell path, startup
arguments, environment variables, working directory).

The built-in ones come from :func:`kylo.terminal.shells.discover_shells` plus
WSL discovery here; the custom ones and the user's choices (default profile,
default WSL distribution, agent terminal mode) live in
``<DATA_DIR>/terminal/settings.json`` (:class:`TerminalSettingsStore`).

Every value that reaches a process is an argv element — nothing here builds a
command line by string concatenation.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from loguru import logger

from kylo.terminal.shells import discover_shells

ProfileKind = Literal["wsl", "pwsh", "powershell", "cmd", "bash", "posix", "custom"]
AgentTerminalMode = Literal["dedicated", "shared", "new"]

AGENT_TERMINAL_MODES: tuple[str, ...] = ("dedicated", "shared", "new")
_PROFILE_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$")
_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
_WSL_CACHE_TTL_S = 30.0
_WSL_PROBE_TIMEOUT_S = 8.0

# Distributions that exist only to back another product; never offer them as a shell.
_HIDDEN_WSL_DISTROS = frozenset({"docker-desktop", "docker-desktop-data"})


@dataclass(frozen=True, slots=True)
class TerminalProfile:
    """One startable shell."""

    id: str
    label: str
    kind: ProfileKind
    argv: tuple[str, ...]
    env: dict[str, str] = field(default_factory=dict)
    cwd: str | None = None
    distro: str | None = None
    builtin: bool = True

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["argv"] = list(self.argv)
        return data


# --------------------------------------------------------------------------- #
# WSL discovery                                                                #
# --------------------------------------------------------------------------- #
def _wsl_exe() -> str | None:
    if sys.platform != "win32":
        return None
    found = shutil.which("wsl.exe") or shutil.which("wsl")
    if found:
        return found
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    candidate = Path(system_root) / "System32" / "wsl.exe"
    return str(candidate) if candidate.is_file() else None


def _decode_wsl_output(raw: bytes) -> str:
    """``wsl.exe`` writes UTF-16LE to a pipe unless WSL_UTF8=1 is honoured."""
    if not raw:
        return ""
    if b"\x00" in raw[:64]:
        try:
            return raw.decode("utf-16-le", errors="replace").lstrip("\ufeff")
        except Exception:  # noqa: BLE001
            pass
    return raw.decode("utf-8", errors="replace").lstrip("\ufeff")


@dataclass(frozen=True, slots=True)
class WslDistro:
    name: str
    state: str
    version: int
    default: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def parse_wsl_verbose_list(text: str) -> list[WslDistro]:
    """Parse ``wsl.exe -l -v`` output.

    Format (columns separated by runs of spaces; ``*`` marks the default)::

          NAME              STATE           VERSION
        * Ubuntu            Stopped         2
          docker-desktop    Stopped         2
    """
    distros: list[WslDistro] = []
    for raw_line in text.splitlines():
        line = raw_line.replace("\x00", "").rstrip()
        if not line.strip():
            continue
        is_default = line.lstrip().startswith("*")
        body = line.lstrip().lstrip("*").strip()
        parts = re.split(r"\s{2,}|\t", body)
        if len(parts) < 3 or parts[0].upper() == "NAME":
            continue
        name, state, version = parts[0].strip(), parts[1].strip(), parts[-1].strip()
        if not name or not version.isdigit():
            continue
        distros.append(
            WslDistro(name=name, state=state, version=int(version), default=is_default)
        )
    return distros


_wsl_cache_lock = threading.Lock()
_wsl_cache: tuple[float, list[WslDistro]] | None = None


def list_wsl_distros(*, refresh: bool = False) -> list[WslDistro]:
    """Installed WSL distributions (cached for a few seconds; [] when WSL is absent)."""
    global _wsl_cache
    exe = _wsl_exe()
    if exe is None:
        return []
    with _wsl_cache_lock:
        if (
            not refresh
            and _wsl_cache is not None
            and time.monotonic() - _wsl_cache[0] < _WSL_CACHE_TTL_S
        ):
            return list(_wsl_cache[1])
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv
            [exe, "--list", "--verbose"],
            capture_output=True,
            timeout=_WSL_PROBE_TIMEOUT_S,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            env={**os.environ, "WSL_UTF8": "1"},
            check=False,
        )
        distros = (
            parse_wsl_verbose_list(_decode_wsl_output(completed.stdout))
            if completed.returncode == 0
            else []
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.debug("WSL probe failed: {}", exc)
        distros = []
    with _wsl_cache_lock:
        _wsl_cache = (time.monotonic(), distros)
    return list(distros)


def wsl_exe_path() -> str | None:
    return _wsl_exe()


def windows_path_to_wsl(path: str) -> str:
    """``C:\\Users\\me\\proj`` → ``/mnt/c/Users/me/proj``; POSIX paths pass through."""
    if not path:
        return path
    if path.startswith("/"):
        return path
    match = re.match(r"^([A-Za-z]):[\\/]*(.*)$", path)
    if not match:
        return path.replace("\\", "/")
    drive, rest = match.group(1).lower(), match.group(2).replace("\\", "/")
    return f"/mnt/{drive}/{rest}".rstrip("/") if rest else f"/mnt/{drive}"


def wsl_path_to_windows(path: str) -> str | None:
    """``/mnt/c/Users/me`` → ``C:\\Users\\me``; other Linux paths have no Windows twin."""
    match = re.match(r"^/mnt/([a-zA-Z])(?:/(.*))?$", path or "")
    if not match:
        return None
    drive, rest = match.group(1).upper(), (match.group(2) or "")
    return f"{drive}:\\" + rest.replace("/", "\\")


# --------------------------------------------------------------------------- #
# Settings                                                                     #
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class CustomProfile:
    id: str
    label: str
    path: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    cwd: str | None = None


@dataclass(slots=True)
class TerminalSettings:
    default_profile: str | None = None
    wsl_distro: str | None = None
    agent_mode: str = "dedicated"
    agent_default_shell: str = "auto"  # auto | wsl | powershell | cmd | bash | posix
    allow_agent_shared_terminal: bool = False
    env: dict[str, str] = field(default_factory=dict)
    startup_cwd: str | None = None
    custom_profiles: list[CustomProfile] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return data


def _clean_env(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(key, str) and _ENV_NAME_RE.match(key) and isinstance(value, str | int | float):
            out[key] = str(value)[:4096]
    return out


def validate_settings(raw: dict[str, Any]) -> TerminalSettings:
    """Build settings from untrusted JSON; raises ValueError on bad input."""
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object")
    settings = TerminalSettings()
    default_profile = raw.get("default_profile")
    if default_profile is not None:
        if not isinstance(default_profile, str) or not _PROFILE_ID_RE.match(default_profile):
            raise ValueError("default_profile is not a valid profile id")
        settings.default_profile = default_profile
    distro = raw.get("wsl_distro")
    if distro is not None:
        if not isinstance(distro, str) or not re.match(r"^[A-Za-z0-9._-]{1,64}$", distro):
            raise ValueError("wsl_distro is not a valid distribution name")
        settings.wsl_distro = distro
    mode = raw.get("agent_mode", "dedicated")
    if mode not in AGENT_TERMINAL_MODES:
        raise ValueError(f"agent_mode must be one of {', '.join(AGENT_TERMINAL_MODES)}")
    settings.agent_mode = mode
    shell = raw.get("agent_default_shell", "auto")
    if shell not in ("auto", "wsl", "powershell", "cmd", "bash", "posix"):
        raise ValueError("agent_default_shell is not a known shell kind")
    settings.agent_default_shell = shell
    settings.allow_agent_shared_terminal = bool(raw.get("allow_agent_shared_terminal", False))
    settings.env = _clean_env(raw.get("env"))
    startup_cwd = raw.get("startup_cwd")
    if startup_cwd:
        if not isinstance(startup_cwd, str) or len(startup_cwd) > 1024:
            raise ValueError("startup_cwd must be a path")
        settings.startup_cwd = startup_cwd
    customs: list[CustomProfile] = []
    seen: set[str] = set()
    for item in raw.get("custom_profiles") or []:
        if not isinstance(item, dict):
            raise ValueError("custom profile must be an object")
        pid = str(item.get("id") or "").strip()
        if not _PROFILE_ID_RE.match(pid) or pid in seen:
            raise ValueError(f"custom profile id {pid!r} is invalid or duplicated")
        seen.add(pid)
        path = str(item.get("path") or "").strip()
        if not path or len(path) > 1024:
            raise ValueError(f"custom profile {pid!r} needs a shell path")
        args = item.get("args") or []
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            raise ValueError(f"custom profile {pid!r} args must be a list of strings")
        customs.append(
            CustomProfile(
                id=pid,
                label=str(item.get("label") or pid)[:80],
                path=path,
                args=[a[:1024] for a in args][:64],
                env=_clean_env(item.get("env")),
                cwd=(str(item["cwd"])[:1024] if item.get("cwd") else None),
            )
        )
    settings.custom_profiles = customs
    return settings


class TerminalSettingsStore:
    """JSON-file backed terminal settings (atomic replace on save)."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()

    @property
    def path(self) -> Path:
        return self._path

    def load(self) -> TerminalSettings:
        with self._lock:
            try:
                raw = json.loads(self._path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return TerminalSettings()
            except (OSError, ValueError) as exc:
                logger.warning("terminal settings unreadable ({}); using defaults", exc)
                return TerminalSettings()
        try:
            return validate_settings(raw)
        except ValueError as exc:
            logger.warning("terminal settings invalid ({}); using defaults", exc)
            return TerminalSettings()

    def save(self, settings: TerminalSettings) -> None:
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(settings.to_dict(), indent=2), encoding="utf-8")
            os.replace(tmp, self._path)


# --------------------------------------------------------------------------- #
# Profile discovery                                                            #
# --------------------------------------------------------------------------- #
_SHELL_KIND = {"pwsh": "pwsh", "powershell": "powershell", "cmd": "cmd", "bash": "bash"}


def builtin_profiles(*, refresh_wsl: bool = False) -> list[TerminalProfile]:
    profiles: list[TerminalProfile] = []
    if sys.platform == "win32":
        exe = _wsl_exe()
        for distro in list_wsl_distros(refresh=refresh_wsl):
            if distro.name.lower() in _HIDDEN_WSL_DISTROS or exe is None:
                continue
            profiles.append(
                TerminalProfile(
                    id=f"wsl:{distro.name}",
                    label=f"WSL: {distro.name}" + ("" if distro.version == 2 else " (WSL 1)"),
                    kind="wsl",
                    argv=(exe, "-d", distro.name, "--cd", "~"),
                    distro=distro.name,
                )
            )
    for shell in discover_shells():
        if sys.platform == "win32":
            kind: ProfileKind = _SHELL_KIND.get(shell.id.split("-")[0], "custom")  # type: ignore[assignment]
            label = "Git Bash" if shell.id == "bash" else shell.label
        else:
            kind = "posix"
            label = shell.label
        profiles.append(TerminalProfile(id=shell.id, label=label, kind=kind, argv=shell.argv))
    return profiles


def custom_to_profile(custom: CustomProfile) -> TerminalProfile:
    return TerminalProfile(
        id=f"custom:{custom.id}",
        label=custom.label,
        kind="custom",
        argv=(custom.path, *custom.args),
        env=dict(custom.env),
        cwd=custom.cwd,
        builtin=False,
    )


def all_profiles(settings: TerminalSettings, *, refresh_wsl: bool = False) -> list[TerminalProfile]:
    return builtin_profiles(refresh_wsl=refresh_wsl) + [
        custom_to_profile(c) for c in settings.custom_profiles
    ]


def default_profile(settings: TerminalSettings, profiles: list[TerminalProfile]) -> TerminalProfile | None:
    """The user's default; else the preferred WSL distro; else the first shell."""
    by_id = {p.id: p for p in profiles}
    if settings.default_profile and settings.default_profile in by_id:
        return by_id[settings.default_profile]
    wsl = [p for p in profiles if p.kind == "wsl"]
    if settings.wsl_distro:
        for p in wsl:
            if p.distro == settings.wsl_distro:
                return p
    for kind in ("pwsh", "powershell", "posix", "cmd", "bash"):
        for p in profiles:
            if p.kind == kind:
                return p
    return profiles[0] if profiles else None


def find_profile(profile_id: str, profiles: list[TerminalProfile]) -> TerminalProfile | None:
    return next((p for p in profiles if p.id == profile_id), None)


def preferred_wsl_distro(settings: TerminalSettings) -> str | None:
    """The distro agents should use: the configured one if installed, else WSL's default."""
    distros = [d for d in list_wsl_distros() if d.name.lower() not in _HIDDEN_WSL_DISTROS]
    if not distros:
        return None
    if settings.wsl_distro and any(d.name == settings.wsl_distro for d in distros):
        return settings.wsl_distro
    for d in distros:
        if d.default:
            return d.name
    return distros[0].name
