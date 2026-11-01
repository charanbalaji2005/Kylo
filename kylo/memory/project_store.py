"""Kylo persistent memory: global, per-project and per-task, in SQLite.

Three scopes, all in ``<DATA_DIR>/kylo_memory/memory.db``:

* **global** — the user's coding preferences, preferred terminal and
  providers, common tools, general instructions.
* **project** — isolated per workspace (keyed by the normalized folder path):
  purpose, tech stack, architecture, important files, build / test / dev
  commands, decisions, known issues, completed tasks.
* **task** — per-project task log: summaries, changes made, command results,
  errors, unfinished work, useful solutions.

Behaviour the spec asks for and where it lives:

* retrieval before a task: :meth:`MemoryStore.context_for` (FTS5 ranking +
  recency, global + this project only — never another project's memory),
* automatic update after work: the ``project-memory-save`` tool and
  :meth:`record_task`,
* inspect / edit / export / delete: the REST routes and the Memory view,
* no duplicates: exact duplicates (normalized text) refresh the existing row,
* never secrets: anything that looks like a credential is refused
  (:func:`kylo.memory.wiki.secret_guard.find_secrets` + AWS/Slack shapes),
* ``AGENTS.md`` / ``CLAUDE.md`` / ``GEMINI.md`` of a project are imported as
  project instructions (:meth:`import_agents_md`).

Embeddings are optional and not required: ranking is FTS5 BM25 with a recency
tie-break, which works offline with no model download.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from kylo.memory.wiki.secret_guard import find_secrets

SCOPES = ("global", "project", "task")
KINDS = (
    "preference", "instruction", "tool", "provider", "terminal",
    "purpose", "stack", "architecture", "file", "build_command", "test_command", "dev_command",
    "decision", "issue", "convention", "note",
    "task_summary", "change", "command_result", "error", "unfinished", "solution",
)
_PROJECT_KINDS_ORDER = (
    "instruction", "purpose", "stack", "architecture", "build_command", "test_command", "dev_command",
    "file", "convention", "decision", "issue", "note",
)
_EXTRA_SECRETS = (
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("github_fine_grained", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{30,}\b")),
    ("connection_string_password", re.compile(r"://[^/\s:@]+:[^/\s@]{6,}@")),
)
MAX_CONTENT = 8000
INSTRUCTION_FILES = ("AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules")


class MemoryError_(ValueError):
    """Rejected memory write (secret, bad scope, too long …)."""


def secret_findings(text: str) -> list[str]:
    found = list(find_secrets(text))
    found += [name for name, pat in _EXTRA_SECRETS if pat.search(text)]
    return found


def project_key(path: str | None) -> str:
    """Stable key for a workspace folder (case-insensitive on Windows, / separators)."""
    if not path:
        return ""
    norm = path.strip().replace("\\", "/").rstrip("/")
    if re.match(r"^[A-Za-z]:", norm):
        norm = norm.lower()
    return norm


def _content_hash(kind: str, text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    return hashlib.sha256(f"{kind}\x00{normalized}".encode()).hexdigest()


def _fts_query(text: str) -> str:
    words = re.findall(r"[A-Za-z0-9_][A-Za-z0-9_.-]{1,}", text or "")
    stop = {"the", "and", "for", "with", "this", "that", "from", "into", "what", "how", "please", "can", "you"}
    terms = [w.lower().strip(".-") for w in words if w.lower() not in stop][:24]
    return " OR ".join(f'"{t}"' for t in dict.fromkeys(terms) if t)


@dataclass(slots=True)
class Entry:
    id: str
    scope: str
    project: str
    kind: str
    title: str
    content: str
    tags: list[str]
    source: str
    pinned: bool
    created_at: float
    updated_at: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "scope": self.scope, "project": self.project, "kind": self.kind,
            "title": self.title, "content": self.content, "tags": self.tags, "source": self.source,
            "pinned": self.pinned, "created_at": self.created_at, "updated_at": self.updated_at,
        }


class MemoryStore:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS entries (
                    id TEXT PRIMARY KEY, scope TEXT NOT NULL, project TEXT NOT NULL DEFAULT '',
                    kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
                    tags TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'agent',
                    pinned INTEGER NOT NULL DEFAULT 0, hash TEXT NOT NULL,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS entries_dedup ON entries(scope, project, hash);
                CREATE INDEX IF NOT EXISTS entries_project ON entries(project, scope, updated_at DESC);
                CREATE TABLE IF NOT EXISTS projects (
                    key TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
                    created_at REAL NOT NULL, last_used REAL NOT NULL);
                CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
                    title, content, tags, content='entries', content_rowid='rowid');
                CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
                    INSERT INTO entries_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
                END;
                CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
                    INSERT INTO entries_fts(entries_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
                END;
                CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
                    INSERT INTO entries_fts(entries_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
                    INSERT INTO entries_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
                END;
                """
            )

    def _db(self) -> sqlite3.Connection:
        db = sqlite3.connect(self._path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def _row(row: sqlite3.Row) -> Entry:
        try:
            tags = json.loads(row["tags"]) if row["tags"] else []
        except ValueError:
            tags = []
        return Entry(
            id=row["id"], scope=row["scope"], project=row["project"], kind=row["kind"], title=row["title"],
            content=row["content"], tags=tags, source=row["source"], pinned=bool(row["pinned"]),
            created_at=row["created_at"], updated_at=row["updated_at"],
        )

    # -- projects --------------------------------------------------------------
    def touch_project(self, path: str, name: str | None = None) -> dict[str, Any]:
        key = project_key(path)
        if not key:
            raise MemoryError_("project path is empty")
        now = time.time()
        label = name or Path(path).name or key
        with self._lock, self._db() as db:
            db.execute(
                "INSERT INTO projects(key, path, name, created_at, last_used) VALUES (?,?,?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET last_used=excluded.last_used, path=excluded.path",
                (key, path, label, now, now),
            )
        return {"key": key, "path": path, "name": label}

    def projects(self) -> list[dict[str, Any]]:
        with self._lock, self._db() as db:
            rows = db.execute(
                "SELECT p.*, (SELECT COUNT(*) FROM entries e WHERE e.project=p.key) AS entries "
                "FROM projects p ORDER BY last_used DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    # -- writes ----------------------------------------------------------------
    def add(
        self,
        *,
        scope: str,
        kind: str,
        content: str,
        project: str | None = None,
        title: str = "",
        tags: list[str] | None = None,
        source: str = "agent",
        pinned: bool = False,
    ) -> tuple[Entry, bool]:
        """Insert a memory; returns ``(entry, created)``. Exact duplicates refresh the old row."""
        scope, kind = scope.strip().lower(), kind.strip().lower()
        if scope not in SCOPES:
            raise MemoryError_(f"scope must be one of {', '.join(SCOPES)}")
        if kind not in KINDS:
            raise MemoryError_(f"kind must be one of {', '.join(KINDS)}")
        content = (content or "").strip()
        title = (title or "").strip()[:200]
        if not content:
            raise MemoryError_("content is empty")
        if len(content) > MAX_CONTENT:
            raise MemoryError_(f"content is longer than {MAX_CONTENT} characters; summarize it")
        findings = secret_findings(f"{title}\n{content}")
        if findings:
            raise MemoryError_(f"refused: looks like a secret ({', '.join(findings)}); memory never stores credentials")
        key = "" if scope == "global" else project_key(project)
        if scope != "global" and not key:
            raise MemoryError_("project and task memory need a workspace")
        clean_tags = [t.strip()[:40] for t in (tags or []) if isinstance(t, str) and t.strip()][:12]
        now = time.time()
        digest = _content_hash(kind, content)
        with self._lock, self._db() as db:
            existing = db.execute(
                "SELECT * FROM entries WHERE scope=? AND project=? AND hash=?", (scope, key, digest)
            ).fetchone()
            if existing is not None:
                db.execute("UPDATE entries SET updated_at=?, pinned=MAX(pinned, ?) WHERE id=?", (now, int(pinned), existing["id"]))
                row = db.execute("SELECT * FROM entries WHERE id=?", (existing["id"],)).fetchone()
                return self._row(row), False
            entry_id = uuid.uuid4().hex[:16]
            db.execute(
                "INSERT INTO entries(id, scope, project, kind, title, content, tags, source, pinned, hash, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (entry_id, scope, key, kind, title, content, json.dumps(clean_tags), source[:20], int(pinned), digest, now, now),
            )
            row = db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        if key and project:
            self.touch_project(project)
        return self._row(row), True

    def update(self, entry_id: str, *, content: str | None = None, title: str | None = None,
               kind: str | None = None, tags: list[str] | None = None, pinned: bool | None = None) -> Entry:
        with self._lock, self._db() as db:
            row = db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
            if row is None:
                raise MemoryError_("no such memory")
            current = self._row(row)
            new_content = (content if content is not None else current.content).strip()
            new_title = (title if title is not None else current.title).strip()[:200]
            new_kind = (kind or current.kind).strip().lower()
            if new_kind not in KINDS:
                raise MemoryError_("unknown kind")
            if not new_content or len(new_content) > MAX_CONTENT:
                raise MemoryError_("content is empty or too long")
            findings = secret_findings(f"{new_title}\n{new_content}")
            if findings:
                raise MemoryError_(f"refused: looks like a secret ({', '.join(findings)})")
            new_tags = tags if tags is not None else current.tags
            try:
                db.execute(
                    "UPDATE entries SET content=?, title=?, kind=?, tags=?, pinned=?, hash=?, updated_at=? WHERE id=?",
                    (new_content, new_title, new_kind, json.dumps(new_tags[:12]),
                     int(current.pinned if pinned is None else pinned), _content_hash(new_kind, new_content), time.time(), entry_id),
                )
            except sqlite3.IntegrityError as exc:
                raise MemoryError_("an identical memory already exists") from exc
            return self._row(db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone())

    def delete(self, entry_id: str) -> bool:
        with self._lock, self._db() as db:
            return db.execute("DELETE FROM entries WHERE id=?", (entry_id,)).rowcount > 0

    def delete_scope(self, scope: str, project: str | None = None) -> int:
        if scope not in SCOPES:
            raise MemoryError_("bad scope")
        key = "" if scope == "global" else project_key(project)
        with self._lock, self._db() as db:
            return db.execute("DELETE FROM entries WHERE scope=? AND project=?", (scope, key)).rowcount

    def forget_project(self, project: str) -> int:
        key = project_key(project)
        with self._lock, self._db() as db:
            count = db.execute("DELETE FROM entries WHERE project=?", (key,)).rowcount
            db.execute("DELETE FROM projects WHERE key=?", (key,))
        return count

    # -- reads -----------------------------------------------------------------
    def get(self, entry_id: str) -> Entry | None:
        with self._lock, self._db() as db:
            row = db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        return self._row(row) if row else None

    def list(self, *, scope: str | None = None, project: str | None = None, kind: str | None = None, limit: int = 500) -> list[Entry]:
        clauses, params = [], []
        if scope:
            clauses.append("scope=?")
            params.append(scope)
        if project is not None and scope != "global":
            clauses.append("project=?")
            params.append(project_key(project))
        if kind:
            clauses.append("kind=?")
            params.append(kind)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        with self._lock, self._db() as db:
            rows = db.execute(
                f"SELECT * FROM entries {where} ORDER BY pinned DESC, updated_at DESC LIMIT ?",  # noqa: S608 - fixed clauses
                (*params, max(1, min(int(limit), 5000))),
            ).fetchall()
        return [self._row(r) for r in rows]

    def search(self, query: str, *, project: str | None = None, include_global: bool = True, limit: int = 20) -> list[Entry]:
        """FTS search limited to global memory and the given project (never other projects)."""
        fts = _fts_query(query)
        key = project_key(project)
        scope_clause = "(e.project = ?" + (" OR e.scope = 'global')" if include_global else ")")
        with self._lock, self._db() as db:
            if not fts:
                rows = db.execute(
                    f"SELECT e.* FROM entries e WHERE {scope_clause} ORDER BY e.pinned DESC, e.updated_at DESC LIMIT ?",  # noqa: S608
                    (key, limit),
                ).fetchall()
            else:
                rows = db.execute(
                    f"SELECT e.* FROM entries_fts f JOIN entries e ON e.rowid = f.rowid "  # noqa: S608
                    f"WHERE entries_fts MATCH ? AND {scope_clause} "
                    "ORDER BY e.pinned DESC, bm25(entries_fts) ASC, e.updated_at DESC LIMIT ?",
                    (fts, key, limit),
                ).fetchall()
        return [self._row(r) for r in rows]

    def context_for(self, task: str, project: str | None, *, budget_chars: int = 6000) -> dict[str, Any]:
        """What an agent should know before starting ``task`` in ``project``."""
        sections: dict[str, list[dict[str, Any]]] = {"global": [], "project": [], "relevant": [], "recent_tasks": []}
        used = 0

        def take(bucket: str, entry: Entry) -> bool:
            nonlocal used
            size = len(entry.content) + len(entry.title) + 20
            if used + size > budget_chars:
                return False
            used += size
            sections[bucket].append({"id": entry.id, "kind": entry.kind, "title": entry.title, "content": entry.content})
            return True

        seen: set[str] = set()
        for entry in self.list(scope="global", limit=40):
            if entry.pinned or entry.kind in ("preference", "instruction", "terminal"):
                if take("global", entry):
                    seen.add(entry.id)
        if project:
            project_entries = self.list(scope="project", project=project, limit=200)
            order = {k: i for i, k in enumerate(_PROJECT_KINDS_ORDER)}
            for entry in sorted(project_entries, key=lambda e: (not e.pinned, order.get(e.kind, 99), -e.updated_at)):
                if entry.kind in ("instruction", "purpose", "stack", "architecture", "build_command", "test_command", "dev_command") or entry.pinned:
                    if take("project", entry):
                        seen.add(entry.id)
        for entry in self.search(task, project=project, limit=15):
            if entry.id not in seen and take("relevant", entry):
                seen.add(entry.id)
        if project:
            for entry in self.list(scope="task", project=project, limit=8):
                if entry.id not in seen and entry.kind in ("task_summary", "unfinished", "error", "solution"):
                    take("recent_tasks", entry)
        return {"project": project_key(project) or None, "sections": sections, "chars": used}

    def record_task(self, project: str, summary: str, *, changes: str = "", unfinished: str = "", errors: str = "") -> list[str]:
        ids = []
        for kind, text in (("task_summary", summary), ("change", changes), ("unfinished", unfinished), ("error", errors)):
            if text and text.strip():
                entry, _ = self.add(scope="task", kind=kind, content=text, project=project, source="agent")
                ids.append(entry.id)
        return ids

    # -- AGENTS.md -------------------------------------------------------------
    def import_agents_md(self, folder: str) -> list[str]:
        """Import a project's instruction files as pinned project instructions."""
        root = Path(folder)
        imported: list[str] = []
        for name in INSTRUCTION_FILES:
            path = root / name
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace").strip()
            except OSError:
                continue
            if not text:
                continue
            if len(text) > MAX_CONTENT:
                text = text[: MAX_CONTENT - 40].rstrip() + "\n…[truncated]"
            try:
                self.add(scope="project", kind="instruction", content=text, project=folder,
                         title=f"{name} (project instructions)", source="agents_md", pinned=True)
                imported.append(name)
            except MemoryError_:
                continue
        return imported

    # -- export / import -------------------------------------------------------
    def export(self, *, project: str | None = None, include_global: bool = True) -> dict[str, Any]:
        entries: list[Entry] = []
        if not project:
            entries = self.list(limit=5000)
        else:
            if include_global:
                entries += self.list(scope="global", limit=5000)
            entries += self.list(scope="project", project=project, limit=5000)
            entries += self.list(scope="task", project=project, limit=5000)
        return {"format": "kylo-memory/1", "exported_at": time.time(), "entries": [e.to_dict() for e in entries]}

    def import_(self, payload: dict[str, Any]) -> dict[str, int]:
        if not isinstance(payload, dict) or payload.get("format") != "kylo-memory/1":
            raise MemoryError_("not a Kylo memory export")
        created = skipped = 0
        for item in payload.get("entries") or []:
            if not isinstance(item, dict):
                skipped += 1
                continue
            try:
                _, new = self.add(
                    scope=str(item.get("scope", "")), kind=str(item.get("kind", "note")),
                    content=str(item.get("content", "")), project=str(item.get("project") or "") or None,
                    title=str(item.get("title") or ""), tags=item.get("tags") or [],
                    source=str(item.get("source") or "import"), pinned=bool(item.get("pinned")),
                )
                created += int(new)
                skipped += int(not new)
            except MemoryError_:
                skipped += 1
        return {"created": created, "skipped": skipped}


_store_lock = threading.Lock()
_store: MemoryStore | None = None


def get_memory_store(path: Path | None = None) -> MemoryStore:
    global _store
    with _store_lock:
        if _store is None:
            if path is None:
                from kylo.core.config import DATA_DIR

                path = Path(DATA_DIR) / "kylo_memory" / "memory.db"
            _store = MemoryStore(path)
        return _store


def reset_memory_store_for_tests() -> None:
    global _store
    with _store_lock:
        _store = None
