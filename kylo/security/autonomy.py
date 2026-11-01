"""Autonomy modes and the command / file policy every Kylo agent tool applies.

Three modes, chosen by the user (``<DATA_DIR>/security/autonomy.json``):

* ``ask`` — **Ask Before Actions**: every command, file change and external
  (GitHub) write needs the user's approval.
* ``workspace`` — **Workspace Autonomy** (default): normal development
  commands inside the selected workspace run on their own; anything outside
  it, destructive, elevated, or touching sensitive locations asks first.
* ``advanced`` — **Advanced Autonomy**: commands may run outside the
  workspace too. Destructive, elevated and sensitive operations still ask, and
  catastrophic ones stay blocked.

The policy is enforced by the tools themselves (see ``kylo.security.approvals``),
not only by the generic risk tier, because a chat in "bypass" stance would
otherwise auto-approve everything. A decision of ``ask`` here means a *human*
must approve it, whatever the chat stance says.
"""
from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from loguru import logger

from kylo.safety.command_impact import DESTRUCTIVE, classify_command
from kylo.terminal.profiles import windows_path_to_wsl

AutonomyMode = Literal["ask", "workspace", "advanced"]
Verdict = Literal["allow", "ask", "block"]
AUTONOMY_MODES: tuple[str, ...] = ("ask", "workspace", "advanced")

# Never run, whatever the mode: wipes a disk, the OS or the boot config.
_CATASTROPHIC = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)[a-z-]*\s+(/|/\*|~|~/|\$HOME|/mnt/[a-z]/?)(\s|$)",
        r"\bmkfs(\.\w+)?\b",
        r"\bdd\b[^|;&]*\bof=/dev/(sd|nvme|hd|disk)",
        r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",
        r"\bformat(\.com)?\s+[a-z]:",
        r"\bdiskpart\b",
        r"\bbcdedit\b",
        r"\bremove-item\b[^|;&]*\s-recurse\b[^|;&]*\s['\"]?[a-z]:\\?['\"]?(\s|$)",
        r"\brd\s+/s\s+/q\s+[a-z]:\\?(\s|$)",
        r"\bdel\s+/[fsq](\s+/[fsq])*\s+[a-z]:\\(\*|\s|$)",
        r"\breg\s+delete\s+hk(lm|ey_local_machine)",
        r"\bshutdown\b",
        r"\bstop-computer\b|\brestart-computer\b",
        r"\bchmod\s+-r\s+[0-7]{3,4}\s+/(\s|$)",
        r"\bchown\s+-r\s+\S+\s+/(\s|$)",
    )
]

_ELEVATION = re.compile(
    r"(^|[\s;&|(])(sudo|doas|su\s|runas|gsudo|pkexec)\b|-verb\s+runas|start-process[^|;&]*-verb\s+['\"]?runas",
    re.IGNORECASE,
)

_REMOTE_EXEC = re.compile(
    r"\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression|python3?)\b",
    re.IGNORECASE,
)

_SYSTEM_MODIFY = re.compile(
    r"\b(set-executionpolicy|set-itemproperty\s+-path\s+['\"]?hklm|reg\s+add\s+hklm|netsh\s+advfirewall|"
    r"set-mppreference|sc(\.exe)?\s+(config|delete|create)|systemctl\s+(disable|mask|stop)|"
    r"apt(-get)?\s+(remove|purge)|setx\s+/m|winget\s+uninstall|choco\s+uninstall)\b",
    re.IGNORECASE,
)

_SENSITIVE_DEFAULT: tuple[str, ...] = (
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker/config.json",
    ".config/gh",
    ".git-credentials",
    ".netrc",
    "id_rsa",
    "id_ed25519",
    "/etc/shadow",
    "/etc/sudoers",
    "AppData/Roaming/Microsoft/Credentials",
    "AppData/Local/Microsoft/Credentials",
    "Microsoft/Protect",
    "Login Data",
    "Cookies",
    "keyring",
    "credentials.json",
    "service-account",
    "Windows/System32",
    "Windows/SysWOW64",
)


@dataclass(slots=True)
class AutonomySettings:
    mode: str = "workspace"
    extra_sensitive: list[str] = field(default_factory=list)
    allowed_roots: list[str] = field(default_factory=list)
    approval_timeout_s: int = 300

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_autonomy(raw: dict[str, Any]) -> AutonomySettings:
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object")
    mode = raw.get("mode", "workspace")
    if mode not in AUTONOMY_MODES:
        raise ValueError(f"mode must be one of {', '.join(AUTONOMY_MODES)}")
    extra = raw.get("extra_sensitive") or []
    roots = raw.get("allowed_roots") or []
    for name, value in (("extra_sensitive", extra), ("allowed_roots", roots)):
        if not isinstance(value, list) or not all(isinstance(v, str) and 0 < len(v) <= 1024 for v in value):
            raise ValueError(f"{name} must be a list of paths")
    timeout = raw.get("approval_timeout_s", 300)
    if not isinstance(timeout, int) or not 15 <= timeout <= 3600:
        raise ValueError("approval_timeout_s must be between 15 and 3600")
    return AutonomySettings(mode=mode, extra_sensitive=extra[:100], allowed_roots=roots[:50], approval_timeout_s=timeout)


class AutonomyStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()

    def load(self) -> AutonomySettings:
        with self._lock:
            try:
                raw = json.loads(self._path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return AutonomySettings()
            except (OSError, ValueError) as exc:
                logger.warning("autonomy settings unreadable ({}); using Workspace Autonomy", exc)
                return AutonomySettings()
        try:
            return validate_autonomy(raw)
        except ValueError as exc:
            logger.warning("autonomy settings invalid ({}); using Workspace Autonomy", exc)
            return AutonomySettings()

    def save(self, settings: AutonomySettings) -> None:
        with self._lock:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(settings.to_dict(), indent=2), encoding="utf-8")
            os.replace(tmp, self._path)


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    verdict: Verdict
    reasons: tuple[str, ...]
    category: str  # read | modify | destructive | elevation | outside-workspace | sensitive | catastrophic | ...

    def to_dict(self) -> dict[str, Any]:
        return {"verdict": self.verdict, "reasons": list(self.reasons), "category": self.category}


def _norm(path: str) -> str:
    return path.replace("\\", "/").rstrip("/").lower()


def _is_within(path: str, root: str) -> bool:
    p, r = _norm(path), _norm(root)
    return bool(r) and (p == r or p.startswith(r + "/"))


def path_inside_workspace(path: str, workspace: str | None, allowed_roots: list[str] | None = None) -> bool:
    """True when ``path`` (Windows, WSL /mnt/x or Git Bash /x form) is inside a root."""
    if not path:
        return False
    roots = [r for r in [workspace, *(allowed_roots or [])] if r]
    if not roots:
        return False
    candidates = {path}
    if re.match(r"^[A-Za-z]:[\\/]", path):
        candidates.add(windows_path_to_wsl(path))
    else:
        m = re.match(r"^/mnt/([a-zA-Z])(/.*)?$", path) or re.match(r"^/([a-zA-Z])(/.*)?$", path)
        if m:
            candidates.add(f"{m.group(1)}:{m.group(2) or '/'}")
    for root in roots:
        root_forms = {root}
        if re.match(r"^[A-Za-z]:[\\/]", root):
            root_forms.add(windows_path_to_wsl(root))
        for cand in candidates:
            for form in root_forms:
                if _is_within(cand, form):
                    return True
    return False


def _mentions_sensitive(text: str, patterns: list[str]) -> str | None:
    lowered = text.replace("\\", "/").lower()
    for pat in patterns:
        if pat.replace("\\", "/").lower() in lowered:
            return pat
    return None


_CD_TARGET = re.compile(r"(?:^|[;&|]\s*)(?:cd|set-location|pushd|chdir)\s+(?:/d\s+)?['\"]?([^'\";&|]+)", re.IGNORECASE)
_ABS_PATH = re.compile(r"(?<![\w/])(?:[A-Za-z]:[\\/][^\s'\";|&]*|/(?:mnt|home|etc|usr|var|opt|root|tmp)\b[^\s'\";|&]*)")


def evaluate_command(
    command: str,
    *,
    cwd: str | None,
    workspace: str | None,
    settings: AutonomySettings,
) -> PolicyDecision:
    """Decide whether an agent command may run unattended."""
    text = command.strip()
    for pattern in _CATASTROPHIC:
        if pattern.search(text):
            return PolicyDecision("block", ("this command could destroy the system or a whole disk",), "catastrophic")
    reasons: list[str] = []
    category = "read"
    if _ELEVATION.search(text):
        reasons.append("requests administrator / root privileges")
        category = "elevation"
    if _REMOTE_EXEC.search(text):
        reasons.append("downloads and executes a remote script")
        category = "remote-exec"
    if _SYSTEM_MODIFY.search(text):
        reasons.append("changes system configuration")
        category = "system"
    impact = classify_command(text)
    if impact.level == DESTRUCTIVE:
        reasons.append("deletes or overwrites data (" + ", ".join(dict.fromkeys(impact.commands)) + ")")
        category = "destructive" if category == "read" else category
    elif impact.level != "read" and category == "read":
        category = "modify"
    sensitive = _mentions_sensitive(text, [*_SENSITIVE_DEFAULT, *settings.extra_sensitive])
    if sensitive:
        reasons.append(f"touches a sensitive location ({sensitive})")
        category = "sensitive" if category in ("read", "modify") else category
    if reasons:
        return PolicyDecision("ask", tuple(reasons), category)

    if settings.mode == "ask":
        return PolicyDecision("ask", ("Ask Before Actions mode: every command needs approval",), category)
    if settings.mode == "workspace":
        if not workspace:
            return PolicyDecision("ask", ("no workspace is selected, so the command is outside any workspace",), "outside-workspace")
        if cwd and not path_inside_workspace(cwd, workspace, settings.allowed_roots):
            return PolicyDecision("ask", (f"runs outside the workspace ({cwd})",), "outside-workspace")
        for target in [*_CD_TARGET.findall(text), *_ABS_PATH.findall(text)]:
            target = target.strip()
            if target.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", target):
                if target in ("/dev/null", "/tmp") or target.startswith("/tmp/"):
                    continue
                if not path_inside_workspace(target, workspace, settings.allowed_roots):
                    return PolicyDecision("ask", (f"refers to a path outside the workspace ({target})",), "outside-workspace")
            elif target.startswith(".."):
                return PolicyDecision("ask", (f"leaves the workspace ({target})",), "outside-workspace")
    return PolicyDecision("allow", (), category)


def evaluate_file_write(path: str, *, workspace: str | None, settings: AutonomySettings) -> PolicyDecision:
    """Decide whether an agent may create/modify ``path`` unattended."""
    sensitive = _mentions_sensitive(path, [*_SENSITIVE_DEFAULT, *settings.extra_sensitive])
    if sensitive:
        return PolicyDecision("ask", (f"sensitive location ({sensitive})",), "sensitive")
    if settings.mode == "ask":
        return PolicyDecision("ask", ("Ask Before Actions mode: file changes need approval",), "modify")
    if not path_inside_workspace(path, workspace, settings.allowed_roots):
        return PolicyDecision("ask", (f"outside the workspace ({path})",), "outside-workspace")
    return PolicyDecision("allow", (), "modify")


def evaluate_external(action: str, *, write: bool, settings: AutonomySettings) -> PolicyDecision:
    """GitHub and other external operations: writes ask unless Advanced Autonomy."""
    if not write:
        return PolicyDecision("allow", (), "read")
    if settings.mode == "advanced":
        return PolicyDecision("allow", (), "external")
    return PolicyDecision("ask", (f"{action} changes something on GitHub",), "external")

