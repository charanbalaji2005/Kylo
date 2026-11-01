"""Human approval queue for Kylo agent actions.

When :mod:`kylo.security.autonomy` says an action needs approval and no human
has approved it yet (for example a chat in "bypass" stance), the tool parks
the action here. The desktop UI shows a permission dialog for every pending
request (``/api/terminals/events`` → ``approval.requested``), and the user's
answer (``POST /api/terminals/approvals/{id}``) releases the tool. Unanswered
requests are denied when they time out — never approved.

"Always allow" is scoped and exact: it remembers the precise command (or
action) for the current workspace until the app restarts.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from loguru import logger


@dataclass(slots=True)
class ApprovalRequest:
    id: str
    kind: str  # command | file | github | ...
    title: str
    detail: dict[str, Any]
    reasons: list[str]
    workspace: str | None
    created_at: float = field(default_factory=time.time)
    expires_at: float = 0.0
    future: asyncio.Future[tuple[bool, str]] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "detail": self.detail,
            "reasons": self.reasons,
            "workspace": self.workspace,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
        }


class ApprovalQueue:
    def __init__(self) -> None:
        self._pending: dict[str, ApprovalRequest] = {}
        self._listeners: set[Callable[[dict[str, Any]], None]] = set()
        self._always: set[tuple[str, str, str]] = set()

    def add_listener(self, listener: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def _emit(self, event: dict[str, Any]) -> None:
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception as exc:  # noqa: BLE001
                logger.debug("approval listener failed: {}", exc)

    @staticmethod
    def _key(kind: str, subject: str, workspace: str | None) -> tuple[str, str, str]:
        return (kind, subject.strip(), workspace or "")

    def pending(self) -> list[dict[str, Any]]:
        return [r.to_dict() for r in self._pending.values()]

    async def request(
        self,
        *,
        kind: str,
        title: str,
        subject: str,
        detail: dict[str, Any],
        reasons: list[str],
        workspace: str | None,
        timeout_s: float = 300.0,
    ) -> tuple[bool, str]:
        """Wait for the user's decision. Returns ``(approved, how)``."""
        if self._key(kind, subject, workspace) in self._always:
            return True, "always-allowed"
        loop = asyncio.get_running_loop()
        req = ApprovalRequest(
            id=uuid.uuid4().hex[:12],
            kind=kind,
            title=title,
            detail={**detail, "subject": subject},
            reasons=reasons,
            workspace=workspace,
            expires_at=time.time() + timeout_s,
            future=loop.create_future(),
        )
        self._pending[req.id] = req
        self._emit({"type": "approval.requested", "approval": req.to_dict()})
        try:
            assert req.future is not None
            return await asyncio.wait_for(asyncio.shield(req.future), timeout=timeout_s)
        except TimeoutError:
            return False, "timeout"
        except asyncio.CancelledError:
            return False, "cancelled"
        finally:
            self._pending.pop(req.id, None)
            self._emit({"type": "approval.resolved", "id": req.id})

    def resolve(self, approval_id: str, approved: bool, *, always: bool = False) -> bool:
        req = self._pending.get(approval_id)
        if req is None or req.future is None or req.future.done():
            return False
        if approved and always:
            self._always.add(self._key(req.kind, str(req.detail.get("subject", "")), req.workspace))
        req.future.set_result((approved, "user" if approved else "denied"))
        return True

    def deny_all(self) -> int:
        count = 0
        for req in list(self._pending.values()):
            if req.future is not None and not req.future.done():
                req.future.set_result((False, "denied"))
                count += 1
        return count
