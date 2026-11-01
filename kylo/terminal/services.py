"""Process-wide Kylo terminal services: one hub, one runner, one approval queue.

The web routes and the agent tools run in the same process and must share the
same sessions, runs and approvals, so they are created once, lazily, under
``<DATA_DIR>/terminal`` and ``<DATA_DIR>/security``.
"""
from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kylo.security.approvals import ApprovalQueue
from kylo.security.autonomy import AutonomyStore
from kylo.terminal.command_runner import CommandRunner, RunLog
from kylo.terminal.hub import TerminalHub
from kylo.terminal.profiles import TerminalSettingsStore


@dataclass
class KyloServices:
    root: Path
    settings: TerminalSettingsStore
    autonomy: AutonomyStore
    hub: TerminalHub
    runner: CommandRunner
    approvals: ApprovalQueue
    _event_queues: set[asyncio.Queue[dict[str, Any]]] = field(default_factory=set)
    current_workspace: str | None = None

    def set_workspace(self, path: str | None) -> str | None:
        """Select the workspace agents operate in (persisted across restarts)."""
        self.current_workspace = str(Path(path).resolve()) if path else None
        target = self.root / "terminal" / "workspace.json"
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps({"workspace": self.current_workspace}), encoding="utf-8")
        except OSError:
            pass
        self.publish({"type": "workspace", "workspace": self.current_workspace})
        return self.current_workspace

    def _load_workspace(self) -> None:
        try:
            data = json.loads((self.root / "terminal" / "workspace.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        path = data.get("workspace") if isinstance(data, dict) else None
        if isinstance(path, str) and Path(path).is_dir():
            self.current_workspace = path

    def subscribe(self) -> tuple[asyncio.Queue[dict[str, Any]], Callable[[], None]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=5000)
        self._event_queues.add(queue)
        return queue, lambda: self._event_queues.discard(queue)

    def publish(self, event: dict[str, Any]) -> None:
        for queue in list(self._event_queues):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self._event_queues.discard(queue)


_lock = threading.Lock()
_services: KyloServices | None = None


def _default_root() -> Path:
    from kylo.core.config import DATA_DIR

    return Path(DATA_DIR)


def get_services(root: Path | None = None) -> KyloServices:
    global _services
    with _lock:
        if _services is None:
            base = root or _default_root()
            settings = TerminalSettingsStore(base / "terminal" / "settings.json")
            services = KyloServices(
                root=base,
                settings=settings,
                autonomy=AutonomyStore(base / "security" / "autonomy.json"),
                hub=TerminalHub(settings, base / "terminal" / "layout.json"),
                runner=CommandRunner(RunLog(base / "terminal" / "runs.db"), settings.load),
                approvals=ApprovalQueue(),
            )
            services.hub.add_listener(services.publish)
            services.runner.add_listener(services.publish)
            services.approvals.add_listener(services.publish)
            services._load_workspace()
            _services = services
        return _services


def reset_services_for_tests() -> None:
    global _services
    with _lock:
        _services = None
