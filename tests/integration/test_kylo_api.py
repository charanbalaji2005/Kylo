"""Kylo terminal / memory / GitHub routes, end to end through FastAPI.

Uses real shells (PowerShell on Windows, sh elsewhere) and real PTYs — the
point is to prove the pieces work together, not to re-test them in isolation.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from kylo.memory import project_store
from kylo.terminal import services as services_mod

WIN = sys.platform == "win32"
SHELL = "powershell" if WIN else "posix"
PROFILE = "powershell" if WIN else None


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    services_mod.reset_services_for_tests()
    project_store.reset_memory_store_for_tests()
    services_mod.get_services(tmp_path / "data")
    project_store.get_memory_store(tmp_path / "data" / "memory.db")
    from kylo.ui.web import surface_security
    from kylo.ui.web.kylo_workspace_routes import env_router, github_router, memory_router
    from kylo.ui.web.terminal_routes import router

    monkeypatch.setattr("kylo.ui.web.terminal_routes.credentials_valid", lambda scope: True)
    assert surface_security  # imported for the patch target above
    app = FastAPI()
    for r in (router, env_router, github_router, memory_router):
        app.include_router(r)
    with TestClient(app) as c:
        yield c
    services_mod.reset_services_for_tests()
    project_store.reset_memory_store_for_tests()


def _workspace(client: TestClient, tmp_path: Path) -> Path:
    ws = tmp_path / "proj"
    ws.mkdir(exist_ok=True)
    (ws / "AGENTS.md").write_text("Always run the linter before committing.", encoding="utf-8")
    res = client.put("/api/terminals/workspace", json={"path": str(ws)})
    assert res.status_code == 200, res.text
    assert res.json()["imported_instructions"] == ["AGENTS.md"]
    return ws


def test_profiles_and_settings(client: TestClient) -> None:
    data = client.get("/api/terminals/profiles").json()
    assert data["profiles"] and data["default_profile"]
    bad = client.put("/api/terminals/settings", json={"agent_mode": "nope"})
    assert bad.status_code == 422
    ok = client.put("/api/terminals/settings", json={"agent_mode": "dedicated", "env": {"KYLO_TEST": "1"}})
    assert ok.status_code == 200 and client.get("/api/terminals/settings").json()["env"] == {"KYLO_TEST": "1"}
    assert client.put("/api/terminals/autonomy", json={"mode": "everything"}).status_code == 422
    assert client.put("/api/terminals/autonomy", json={"mode": "advanced"}).json()["mode"] == "advanced"


def test_interactive_session_attach_replay_rename_close(client: TestClient, tmp_path: Path) -> None:
    created = client.post("/api/terminals/sessions", json={"profile_id": PROFILE, "cwd": str(tmp_path), "cols": 100, "rows": 30})
    assert created.status_code == 200, created.text
    sid = created.json()["id"]
    assert created.json()["owner"] == "user"
    with client.websocket_connect(f"/api/terminals/sessions/{sid}/attach") as ws:
        assert ws.receive_json()["t"] == "ready"
        ws.send_json({"t": "i", "d": "echo kylo-attach-ok\r"})
        seen = ""
        deadline = time.time() + 20
        while "kylo-attach-ok" not in seen.replace("echo kylo-attach-ok", "") and time.time() < deadline:
            frame = ws.receive_json()
            seen += frame.get("d", "")
    # Re-attaching replays what the shell printed.
    with client.websocket_connect(f"/api/terminals/sessions/{sid}/attach") as ws:
        assert ws.receive_json()["t"] == "ready"
        replay = ws.receive_json()
        assert replay["t"] == "replay" and "kylo-attach-ok" in replay["d"]
    assert client.get(f"/api/terminals/sessions/{sid}/history").json()["history"] == ["echo kylo-attach-ok"]
    assert client.patch(f"/api/terminals/sessions/{sid}", json={"name": "Build"}).json()["name"] == "Build"
    assert client.delete(f"/api/terminals/sessions/{sid}").status_code == 200
    assert client.get("/api/terminals/sessions").json()["sessions"] == []


def test_agent_run_in_workspace_runs_unattended(client: TestClient, tmp_path: Path) -> None:
    ws = _workspace(client, tmp_path)
    res = client.post("/api/terminals/runs", json={"command": "echo hello-from-agent", "shell": SHELL})
    body = res.json()
    assert body["status"] == "succeeded", body
    assert "hello-from-agent" in body["stdout"]
    assert Path(body["cwd"]).resolve() == ws.resolve()
    runs = client.get("/api/terminals/runs").json()["runs"]
    assert runs[0]["id"] == body["run_id"] and runs[0]["owner"] == "agent"
    assert "hello-from-agent" in client.get(f"/api/terminals/runs/{body['run_id']}").json()["stdout"]


def test_blocked_command_never_runs(client: TestClient, tmp_path: Path) -> None:
    _workspace(client, tmp_path)
    body = client.post("/api/terminals/runs", json={"command": "format c:", "shell": SHELL}).json()
    assert body["status"] == "blocked"
    assert client.get("/api/terminals/runs").json()["runs"] == []


def test_risky_command_waits_for_approval_dialog(client: TestClient, tmp_path: Path) -> None:
    ws = _workspace(client, tmp_path)
    victim = ws / "victim.txt"
    victim.write_text("x", encoding="utf-8")
    command = f"Remove-Item -LiteralPath '{victim}'" if WIN else f"rm '{victim}'"
    results: dict[str, dict] = {}

    def run(key: str) -> None:
        results[key] = client.post("/api/terminals/runs", json={"command": command, "shell": SHELL}).json()

    # Deny first.
    t = threading.Thread(target=run, args=("denied",))
    t.start()
    pending = _wait_for_approval(client)
    assert pending["kind"] == "command" and pending["detail"]["command"] == command
    assert any("deletes" in r for r in pending["reasons"])
    assert client.post(f"/api/terminals/approvals/{pending['id']}", json={"approved": False}).status_code == 200
    t.join(30)
    assert results["denied"]["status"] == "denied" and victim.exists()

    # Then approve.
    t = threading.Thread(target=run, args=("approved",))
    t.start()
    pending = _wait_for_approval(client)
    client.post(f"/api/terminals/approvals/{pending['id']}", json={"approved": True})
    t.join(60)
    assert results["approved"]["status"] == "succeeded", results["approved"]
    assert not victim.exists()


def _wait_for_approval(client: TestClient) -> dict:
    deadline = time.time() + 20
    while time.time() < deadline:
        pending = client.get("/api/terminals/approvals").json()["approvals"]
        if pending:
            return pending[0]
        time.sleep(0.1)
    raise AssertionError("no approval request appeared")


def test_background_run_and_stop(client: TestClient, tmp_path: Path) -> None:
    _workspace(client, tmp_path)
    command = "Write-Output started; Start-Sleep -Seconds 60" if WIN else "echo started; sleep 60"
    body = client.post("/api/terminals/runs", json={"command": command, "shell": SHELL, "background": True}).json()
    assert body["still_running"] is True and "started" in body["stdout"]
    assert client.post("/api/terminals/agent/stop").json()["stopped"] == 1
    deadline = time.time() + 15
    while time.time() < deadline:
        run = client.get(f"/api/terminals/runs/{body['run_id']}").json()["run"]
        if run["status"] != "running":
            break
        time.sleep(0.2)
    assert run["status"] == "cancelled"


def test_memory_api_isolation_and_secret_refusal(client: TestClient, tmp_path: Path) -> None:
    ws = _workspace(client, tmp_path)
    ok = client.post("/api/kylo-memory/entries", json={"scope": "project", "kind": "test_command", "content": "pytest -q", "project": str(ws)})
    assert ok.status_code == 200 and ok.json()["created"] is True
    leak = client.post("/api/kylo-memory/entries", json={"scope": "global", "kind": "note", "content": "token ghp_abcdefghijklmnopqrstuvwxyz0123456789"})
    assert leak.status_code == 422
    entries = client.get("/api/kylo-memory/entries", params={"scope": "project", "project": str(ws)}).json()["entries"]
    assert {e["kind"] for e in entries} == {"test_command", "instruction"}
    other = client.get("/api/kylo-memory/entries", params={"scope": "project", "project": str(tmp_path / "other")}).json()
    assert other["entries"] == []
    ctx = client.get("/api/kylo-memory/context", params={"project": str(ws), "task": "run tests"}).json()
    flat = [i["content"] for items in ctx["sections"].values() for i in items]
    assert "pytest -q" in flat and any("linter" in c for c in flat)
    exported = client.get("/api/kylo-memory/export", params={"project": str(ws)}).json()
    assert len(exported["entries"]) == 2


def test_github_validation(client: TestClient) -> None:
    res = client.post("/api/github/clone", json={"repo": "a/b; rm -rf /", "dest": "."})
    assert res.status_code in (422, 424)
