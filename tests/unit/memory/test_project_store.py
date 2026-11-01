"""Kylo persistent memory store: scopes, isolation, dedup, secrets, search, export."""
from __future__ import annotations

from pathlib import Path

import pytest

from kylo.memory.project_store import MemoryError_, MemoryStore, project_key

A = r"C:\work\alpha"
B = r"C:\work\beta"


@pytest.fixture
def store(tmp_path: Path) -> MemoryStore:
    return MemoryStore(tmp_path / "memory.db")


def test_project_key_normalizes_windows_paths() -> None:
    assert project_key(r"C:\Work\Alpha\\") == project_key("c:/work/alpha")
    assert project_key("/home/me/Proj") == "/home/me/Proj"


def test_scopes_and_validation(store: MemoryStore) -> None:
    entry, created = store.add(scope="global", kind="preference", content="Prefers pnpm over npm")
    assert created and entry.project == ""
    with pytest.raises(MemoryError_):
        store.add(scope="project", kind="stack", content="React")  # no workspace
    with pytest.raises(MemoryError_):
        store.add(scope="universe", kind="note", content="x")
    with pytest.raises(MemoryError_):
        store.add(scope="global", kind="bogus", content="x")


def test_dedup_refreshes_instead_of_duplicating(store: MemoryStore) -> None:
    first, created = store.add(scope="project", kind="test_command", content="pnpm  test", project=A)
    again, created_again = store.add(scope="project", kind="test_command", content="PNPM test", project=A)
    assert created and not created_again and again.id == first.id
    assert len(store.list(scope="project", project=A)) == 1


@pytest.mark.parametrize(
    "secret",
    [
        "OPENAI key sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        "aws AKIAABCDEFGHIJKLMNOP",
        "password: hunter2hunter2",
        "postgres://admin:supersecret@db/app",
    ],
)
def test_secrets_are_refused(store: MemoryStore, secret: str) -> None:
    with pytest.raises(MemoryError_, match="secret"):
        store.add(scope="global", kind="note", content=secret)


def test_project_isolation_in_search_and_context(store: MemoryStore) -> None:
    store.add(scope="project", kind="build_command", content="cargo build --release", project=A)
    store.add(scope="project", kind="build_command", content="npm run build for the vite app", project=B)
    store.add(scope="global", kind="preference", content="Use WSL for builds")
    hits_a = store.search("build", project=A)
    contents = {e.content for e in hits_a}
    assert "cargo build --release" in contents
    assert not any("vite" in c for c in contents)
    ctx = store.context_for("fix the build", B)
    flat = [i["content"] for items in ctx["sections"].values() for i in items]
    assert any("vite" in c for c in flat) and not any("cargo" in c for c in flat)
    assert any("WSL" in c for c in flat)


def test_update_delete_and_forget(store: MemoryStore) -> None:
    entry, _ = store.add(scope="project", kind="issue", content="Flaky login test", project=A)
    updated = store.update(entry.id, content="Login test is flaky on CI", pinned=True)
    assert updated.pinned and "CI" in updated.content
    with pytest.raises(MemoryError_):
        store.update(entry.id, content="api_key=abcdefgh12345678")
    store.record_task(A, "Fixed flaky test", changes="tests/login.spec.ts", unfinished="Retry logic")
    assert len(store.list(scope="task", project=A)) == 3
    assert store.delete(entry.id)
    assert store.forget_project(A) == 3
    assert store.list(project=A, scope="task") == []


def test_agents_md_import(store: MemoryStore, tmp_path: Path) -> None:
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "AGENTS.md").write_text("# Rules\nRun `make test` before committing.", encoding="utf-8")
    assert store.import_agents_md(str(proj)) == ["AGENTS.md"]
    assert store.import_agents_md(str(proj)) == ["AGENTS.md"]  # idempotent (dedup)
    entries = store.list(scope="project", project=str(proj))
    assert len(entries) == 1 and entries[0].pinned and entries[0].kind == "instruction"
    assert store.projects()[0]["entries"] == 1


def test_export_import_roundtrip(store: MemoryStore, tmp_path: Path) -> None:
    store.add(scope="global", kind="preference", content="Tabs, not spaces")
    store.add(scope="project", kind="stack", content="Next.js 15 + Prisma", project=A)
    payload = store.export()
    assert len(payload["entries"]) == 2
    other = MemoryStore(tmp_path / "other.db")
    assert other.import_(payload) == {"created": 2, "skipped": 0}
    assert other.import_(payload) == {"created": 0, "skipped": 2}
    with pytest.raises(MemoryError_):
        other.import_({"format": "nope"})
