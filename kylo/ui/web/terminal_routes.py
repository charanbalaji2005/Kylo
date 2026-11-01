"""Integrated Terminal API (``/api/terminals``).

Profiles and settings
    GET  /profiles                     shells + WSL distros + custom profiles
    GET  /settings · PUT /settings     default shell, WSL distro, env, agent mode …
    GET  /autonomy · PUT /autonomy     Ask / Workspace / Advanced autonomy
    PUT  /workspace                    the workspace agents operate in

Interactive sessions (PTY)
    GET  /sessions                     all sessions (owner user|agent)
    POST /sessions                     open a terminal {profile_id?, name?, cwd?, cols, rows}
    PATCH /sessions/{id}               rename
    DELETE /sessions/{id}              close (kills the shell)
    POST /sessions/{id}/input          send text ("Run selection", "Send command")
    POST /sessions/{id}/clear          drop the replay buffer
    GET  /sessions/{id}/history        commands typed into it
    PUT  /active                       which user terminal is "active"
    POST /restore                      reopen the terminals of the last run
    WS   /sessions/{id}/attach         replay + live output; {t:i|r} from the client

Agent command runs
    POST /runs                         run a command through the agent path (policy + approval)
    GET  /runs · GET /runs/{id}        history / output
    POST /runs/{id}/cancel · POST /agent/stop
    DELETE /runs                       clear the history

Approvals and events
    GET  /approvals · POST /approvals/{id} {approved, always}
    WS   /events                       sessions, run output, approvals, cwd
"""
from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from kylo.security.autonomy import AUTONOMY_MODES, validate_autonomy
from kylo.terminal.agent_exec import agent_run, agent_stop
from kylo.terminal.hub import TerminalHubError
from kylo.terminal.profiles import (
    default_profile,
    list_wsl_distros,
    validate_settings,
)
from kylo.terminal.services import get_services

from .surface_security import credentials_valid

router = APIRouter(prefix="/api/terminals", tags=["terminals"])


class CreateSession(BaseModel):
    profile_id: str | None = Field(default=None, max_length=80)
    name: str | None = Field(default=None, max_length=60)
    cwd: str | None = Field(default=None, max_length=1024)
    cols: int = Field(default=120, ge=10, le=500)
    rows: int = Field(default=30, ge=4, le=200)


class RenameSession(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class SendInput(BaseModel):
    data: str = Field(max_length=200_000)
    execute: bool = False


class ActiveSession(BaseModel):
    session_id: str | None = None


class RunRequest(BaseModel):
    command: str = Field(min_length=1, max_length=32_000)
    shell: str = Field(default="auto", max_length=16)
    cwd: str | None = Field(default=None, max_length=1024)
    timeout_s: float | None = Field(default=None, gt=0, le=6 * 3600)
    background: bool = False
    mode: str | None = Field(default=None, max_length=16)


class ApprovalDecision(BaseModel):
    approved: bool
    always: bool = False


class WorkspaceRequest(BaseModel):
    path: str | None = Field(default=None, max_length=1024)


def _hub_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------------------------- #
# Profiles / settings                                                          #
# --------------------------------------------------------------------------- #
@router.get("/profiles")
def get_profiles(refresh: bool = False) -> dict[str, Any]:
    svc = get_services()
    settings = svc.settings.load()
    profiles = svc.hub.profiles(refresh=refresh)
    default = default_profile(settings, profiles)
    return {
        "profiles": [p.to_dict() for p in profiles],
        "default_profile": default.id if default else None,
        "wsl_distros": [d.to_dict() for d in list_wsl_distros()],
    }


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return get_services().settings.load().to_dict()


@router.put("/settings")
def put_settings(body: dict[str, Any]) -> dict[str, Any]:
    try:
        settings = validate_settings(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    get_services().settings.save(settings)
    return settings.to_dict()


@router.get("/autonomy")
def get_autonomy() -> dict[str, Any]:
    svc = get_services()
    return {**svc.autonomy.load().to_dict(), "modes": list(AUTONOMY_MODES), "workspace": svc.current_workspace}


@router.put("/autonomy")
def put_autonomy(body: dict[str, Any]) -> dict[str, Any]:
    try:
        settings = validate_autonomy(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    get_services().autonomy.save(settings)
    return settings.to_dict()


@router.put("/workspace")
def put_workspace(body: WorkspaceRequest) -> dict[str, Any]:
    svc = get_services()
    imported: list[str] = []
    if body.path:
        path = Path(body.path)
        if not path.is_dir():
            raise HTTPException(status_code=404, detail="folder does not exist")
        svc.set_workspace(str(path))
        try:
            from kylo.memory.project_store import get_memory_store

            store = get_memory_store()
            store.touch_project(str(path.resolve()))
            imported = store.import_agents_md(str(path.resolve()))
        except Exception:  # noqa: BLE001 - memory is best effort
            imported = []
    else:
        svc.set_workspace(None)
    return {"workspace": svc.current_workspace, "imported_instructions": imported}


@router.get("/workspace")
def get_workspace() -> dict[str, Any]:
    return {"workspace": get_services().current_workspace}


# --------------------------------------------------------------------------- #
# Sessions                                                                     #
# --------------------------------------------------------------------------- #
@router.get("/sessions")
def list_sessions() -> dict[str, Any]:
    hub = get_services().hub
    return {"sessions": hub.list(), "active": hub.active_user_session, "restorable": len(hub.saved_layout())}


@router.post("/sessions")
async def create_session(body: CreateSession) -> dict[str, Any]:
    svc = get_services()
    try:
        session = await svc.hub.create(
            profile_id=body.profile_id,
            name=body.name,
            cwd=body.cwd,
            cols=body.cols,
            rows=body.rows,
            owner="user",
            workspace=svc.current_workspace,
        )
    except TerminalHubError as exc:
        raise _hub_error(exc) from exc
    return session.info()


@router.patch("/sessions/{session_id}")
def rename_session(session_id: str, body: RenameSession) -> dict[str, Any]:
    try:
        return get_services().hub.rename(session_id, body.name).info()
    except TerminalHubError as exc:
        raise _hub_error(exc) from exc


@router.delete("/sessions/{session_id}")
async def close_session(session_id: str) -> dict[str, Any]:
    try:
        await get_services().hub.close(session_id)
    except TerminalHubError as exc:
        raise _hub_error(exc) from exc
    return {"closed": session_id}


@router.post("/sessions/{session_id}/input")
def send_input(session_id: str, body: SendInput) -> dict[str, Any]:
    """User-initiated text into a terminal (Run Selection / Send Command)."""
    data = body.data.replace("\r\n", "\n")
    if body.execute:
        data = data.rstrip("\n").replace("\n", "\r") + "\r"
    try:
        get_services().hub.write(session_id, data, source="user")
    except TerminalHubError as exc:
        raise _hub_error(exc) from exc
    return {"sent": len(data)}


@router.post("/sessions/{session_id}/clear")
def clear_session(session_id: str) -> dict[str, Any]:
    try:
        get_services().hub.clear_replay(session_id)
    except TerminalHubError as exc:
        raise _hub_error(exc) from exc
    return {"cleared": session_id}


@router.get("/sessions/{session_id}/history")
def session_history(session_id: str) -> dict[str, Any]:
    try:
        return {"history": get_services().hub.history(session_id)}
    except TerminalHubError as exc:
        raise _hub_error(exc) from exc


@router.put("/active")
def set_active(body: ActiveSession) -> dict[str, Any]:
    try:
        get_services().hub.set_active(body.session_id)
    except TerminalHubError as exc:
        raise _hub_error(exc) from exc
    return {"active": body.session_id}


@router.post("/restore")
async def restore() -> dict[str, Any]:
    restored = await get_services().hub.restore_layout()
    return {"sessions": [s.info() for s in restored]}


@router.websocket("/sessions/{session_id}/attach")
async def attach(ws: WebSocket, session_id: str) -> None:
    await ws.accept()
    if not credentials_valid(ws.scope):
        await ws.close(code=4401, reason="unauthorized")
        return
    hub = get_services().hub
    try:
        replay, queue = hub.attach(session_id)
    except TerminalHubError:
        await ws.close(code=4404, reason="no such terminal")
        return
    session = hub.get(session_id)
    await ws.send_json({"t": "ready", "session": session.info()})
    if replay:
        await ws.send_json({"t": "replay", "d": replay})
    if session.status == "exited":
        await ws.send_json({"t": "exit", "code": session.exit_code})

    async def pump() -> None:
        while True:
            frame = await queue.get()
            await ws.send_json(frame)
            if frame.get("t") in ("closed", "overflow"):
                return

    sender = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("t") if isinstance(msg, dict) else None
            if kind == "i" and isinstance(msg.get("d"), str):
                with contextlib.suppress(TerminalHubError):
                    hub.write(session_id, msg["d"], source="user")
            elif kind == "r":
                with contextlib.suppress(TerminalHubError, TypeError, ValueError):
                    hub.resize(session_id, int(msg.get("cols", 80)), int(msg.get("rows", 24)))
            if sender.done():
                break
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        sender.cancel()
        hub.detach(session_id, queue)


# --------------------------------------------------------------------------- #
# Agent runs                                                                   #
# --------------------------------------------------------------------------- #
@router.post("/runs")
async def run_command(body: RunRequest) -> dict[str, Any]:
    """Run a command on the AI's behalf (used by the chat agent bridge and tests).

    The autonomy policy and approval queue apply exactly as for the agent tool.
    """
    return await agent_run(
        body.command,
        shell=body.shell,
        cwd=body.cwd,
        timeout_s=body.timeout_s,
        background=body.background,
        mode=body.mode,
    )


@router.get("/runs")
def list_runs(limit: int = Query(default=100, ge=1, le=1000), owner: str | None = None) -> dict[str, Any]:
    runner = get_services().runner
    return {"runs": runner.recent(limit, owner), "active": runner.active()}


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    out = get_services().runner.output(run_id, max_chars=200_000)
    if out is None:
        raise HTTPException(status_code=404, detail="no such run")
    return out


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str) -> dict[str, Any]:
    return {"cancelled": get_services().runner.cancel(run_id)}


@router.delete("/runs")
def clear_runs() -> dict[str, Any]:
    return {"deleted": get_services().runner.clear_history()}


@router.post("/agent/stop")
async def stop_agent() -> dict[str, Any]:
    return await agent_stop()


# --------------------------------------------------------------------------- #
# Approvals / events                                                           #
# --------------------------------------------------------------------------- #
@router.get("/approvals")
def list_approvals() -> dict[str, Any]:
    return {"approvals": get_services().approvals.pending()}


@router.post("/approvals/{approval_id}")
def decide(approval_id: str, body: ApprovalDecision) -> dict[str, Any]:
    if not get_services().approvals.resolve(approval_id, body.approved, always=body.always):
        raise HTTPException(status_code=404, detail="approval is no longer pending")
    return {"resolved": approval_id, "approved": body.approved}


@router.websocket("/events")
async def events(ws: WebSocket) -> None:
    await ws.accept()
    if not credentials_valid(ws.scope):
        await ws.close(code=4401, reason="unauthorized")
        return
    svc = get_services()
    queue, unsubscribe = svc.subscribe()
    await ws.send_json(
        {
            "type": "hello",
            "sessions": svc.hub.list(),
            "active_runs": svc.runner.active(),
            "approvals": svc.approvals.pending(),
            "workspace": svc.current_workspace,
        }
    )

    async def drain_client() -> None:
        with contextlib.suppress(WebSocketDisconnect, RuntimeError):
            while True:
                await ws.receive_text()

    reader = asyncio.create_task(drain_client())
    try:
        while not reader.done():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=20)
            except TimeoutError:
                event = {"type": "ping"}
            await ws.send_json(event)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        reader.cancel()
        unsubscribe()
