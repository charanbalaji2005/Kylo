"""Kylo setup dashboard, GitHub and memory APIs.

Environment (``/api/environment``)
    GET  /                         full detection report (cached 60 s; ?refresh=1)

GitHub through the user's ``gh`` login (``/api/github``)
    GET  /status                   installed / signed in / account / scopes
    GET  /repos?owner=&limit=      repositories
    GET  /repo?folder=             repository of a local checkout
    GET  /repos/{owner}/{name}/issues|pulls|runs|workflows
    GET  /repos/{owner}/{name}/runs/{id}?failed_logs=1
    POST /clone {repo, dest, directory?}
    POST /create {name, private, description, source?, push?}
    POST /repos/{owner}/{name}/issues {title, body}
    POST /pulls {folder, title, body, base?, head?, draft?}
    POST /repos/{owner}/{name}/pulls/{n}/merge {method, delete_branch}

Persistent memory (``/api/kylo-memory``)
    GET    /entries?scope=&project=&kind=&q=
    POST   /entries · PATCH /entries/{id} · DELETE /entries/{id}
    GET    /projects · DELETE /projects?path=
    GET    /context?project=&task=
    POST   /import-agents-md {folder}
    GET    /export?project= · POST /import
These calls are user actions from the UI, so they run without the agent
approval queue; the agent tools in ``kylo.plugins.tool.kylo_workspace`` go
through the autonomy policy instead.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from kylo.github import gh_cli as gh
from kylo.memory.project_store import KINDS, SCOPES, MemoryError_, get_memory_store

env_router = APIRouter(prefix="/api/environment", tags=["environment"])
github_router = APIRouter(prefix="/api/github", tags=["github"])
memory_router = APIRouter(prefix="/api/kylo-memory", tags=["kylo-memory"])


def _gh_http(exc: gh.GhError) -> HTTPException:
    status = {"missing": 424, "auth": 401, "invalid": 422, "not_found": 404, "exists": 409, "timeout": 504}.get(exc.code, 502)
    return HTTPException(status_code=status, detail={"code": exc.code, "message": str(exc)})


# --------------------------------------------------------------------------- #
# Environment                                                                  #
# --------------------------------------------------------------------------- #
@env_router.get("")
async def environment(refresh: bool = False) -> dict[str, Any]:
    from kylo.setup.environment import detect_environment

    return await gh.arun(detect_environment, refresh=refresh)


# --------------------------------------------------------------------------- #
# GitHub                                                                       #
# --------------------------------------------------------------------------- #
class CloneBody(BaseModel):
    repo: str = Field(min_length=3, max_length=300)
    dest: str = Field(min_length=1, max_length=1024)
    directory: str | None = Field(default=None, max_length=100)


class CreateRepoBody(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    private: bool = True
    description: str = Field(default="", max_length=350)
    source: str | None = Field(default=None, max_length=1024)
    push: bool = False


class IssueBody(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    body: str = Field(default="", max_length=60_000)


class PullBody(BaseModel):
    folder: str = Field(min_length=1, max_length=1024)
    title: str = Field(min_length=1, max_length=256)
    body: str = Field(default="", max_length=60_000)
    base: str | None = Field(default=None, max_length=200)
    head: str | None = Field(default=None, max_length=200)
    draft: bool = False


class MergeBody(BaseModel):
    method: str = Field(default="squash", pattern="^(merge|squash|rebase)$")
    delete_branch: bool = False


async def _call(fn: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return await gh.arun(fn, *args, **kwargs)
    except gh.GhError as exc:
        raise _gh_http(exc) from exc


@github_router.get("/status")
async def github_status() -> dict[str, Any]:
    return await gh.arun(gh.status)


@github_router.get("/repos")
async def github_repos(owner: str | None = None, limit: int = Query(default=50, ge=1, le=500)) -> dict[str, Any]:
    return {"repos": await _call(gh.list_repos, owner, limit)}


@github_router.get("/repo")
async def github_repo_for_folder(folder: str) -> dict[str, Any]:
    return {"repo": await gh.arun(gh.repo_for_folder, folder)}


@github_router.get("/repos/{owner}/{name}")
async def github_repo(owner: str, name: str) -> dict[str, Any]:
    return await _call(gh.view_repo, f"{owner}/{name}")


@github_router.get("/repos/{owner}/{name}/issues")
async def github_issues(owner: str, name: str, state: str = "open", limit: int = Query(default=30, ge=1, le=200)) -> dict[str, Any]:
    return {"issues": await _call(gh.list_issues, f"{owner}/{name}", state, limit)}


@github_router.get("/repos/{owner}/{name}/issues/{number}")
async def github_issue(owner: str, name: str, number: int) -> dict[str, Any]:
    return await _call(gh.view_issue, f"{owner}/{name}", number)


@github_router.post("/repos/{owner}/{name}/issues")
async def github_create_issue(owner: str, name: str, body: IssueBody) -> dict[str, Any]:
    return await _call(gh.create_issue, f"{owner}/{name}", body.title, body.body)


@github_router.get("/repos/{owner}/{name}/pulls")
async def github_pulls(owner: str, name: str, state: str = "open", limit: int = Query(default=30, ge=1, le=200)) -> dict[str, Any]:
    return {"pulls": await _call(gh.list_prs, f"{owner}/{name}", state, limit)}


@github_router.get("/repos/{owner}/{name}/pulls/{number}")
async def github_pull(owner: str, name: str, number: int) -> dict[str, Any]:
    return await _call(gh.view_pr, f"{owner}/{name}", number)


@github_router.post("/repos/{owner}/{name}/pulls/{number}/merge")
async def github_merge(owner: str, name: str, number: int, body: MergeBody) -> dict[str, Any]:
    return await _call(gh.merge_pr, f"{owner}/{name}", number, body.method, body.delete_branch)


@github_router.get("/repos/{owner}/{name}/runs")
async def github_runs(owner: str, name: str, limit: int = Query(default=20, ge=1, le=100), branch: str | None = None) -> dict[str, Any]:
    return {"runs": await _call(gh.list_runs, f"{owner}/{name}", limit, branch)}


@github_router.get("/repos/{owner}/{name}/runs/{run_id}")
async def github_run(owner: str, name: str, run_id: int, failed_logs: bool = False) -> dict[str, Any]:
    return await _call(gh.view_run, f"{owner}/{name}", run_id, failed_logs=failed_logs)


@github_router.get("/repos/{owner}/{name}/workflows")
async def github_workflows(owner: str, name: str) -> dict[str, Any]:
    return {"workflows": await _call(gh.list_workflows, f"{owner}/{name}")}


@github_router.post("/clone")
async def github_clone(body: CloneBody) -> dict[str, Any]:
    result = await _call(gh.clone_repo, body.repo, body.dest, directory=body.directory)
    try:
        store = get_memory_store()
        store.touch_project(result["path"])
        store.import_agents_md(result["path"])
    except Exception:  # noqa: BLE001 - memory is best effort after a clone
        pass
    return result


@github_router.post("/create")
async def github_create(body: CreateRepoBody) -> dict[str, Any]:
    return await _call(gh.create_repo, body.name, private=body.private, description=body.description, source=body.source, push=body.push)


@github_router.post("/pulls")
async def github_create_pull(body: PullBody) -> dict[str, Any]:
    return await _call(gh.create_pr, body.folder, title=body.title, body=body.body, base=body.base, head=body.head, draft=body.draft)


# --------------------------------------------------------------------------- #
# Memory                                                                       #
# --------------------------------------------------------------------------- #
class EntryBody(BaseModel):
    scope: str = Field(pattern="^(global|project|task)$")
    kind: str = Field(min_length=1, max_length=40)
    content: str = Field(min_length=1, max_length=8000)
    project: str | None = Field(default=None, max_length=1024)
    title: str = Field(default="", max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=12)
    pinned: bool = False


class EntryPatch(BaseModel):
    content: str | None = Field(default=None, max_length=8000)
    title: str | None = Field(default=None, max_length=200)
    kind: str | None = Field(default=None, max_length=40)
    tags: list[str] | None = Field(default=None, max_length=12)
    pinned: bool | None = None


class FolderBody(BaseModel):
    folder: str = Field(min_length=1, max_length=1024)


def _mem_error(exc: MemoryError_) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))


@memory_router.get("/meta")
def memory_meta() -> dict[str, Any]:
    return {"scopes": list(SCOPES), "kinds": list(KINDS)}


@memory_router.get("/entries")
def memory_entries(
    scope: str | None = None,
    project: str | None = None,
    kind: str | None = None,
    q: str | None = None,
    limit: int = Query(default=500, ge=1, le=5000),
) -> dict[str, Any]:
    store = get_memory_store()
    if q:
        entries = store.search(q, project=project, include_global=scope in (None, "global"), limit=min(limit, 200))
        if scope:
            entries = [e for e in entries if e.scope == scope]
    else:
        entries = store.list(scope=scope, project=project, kind=kind, limit=limit)
    return {"entries": [e.to_dict() for e in entries]}


@memory_router.post("/entries")
def memory_add(body: EntryBody) -> dict[str, Any]:
    try:
        entry, created = get_memory_store().add(
            scope=body.scope, kind=body.kind, content=body.content, project=body.project,
            title=body.title, tags=body.tags, source="user", pinned=body.pinned,
        )
    except MemoryError_ as exc:
        raise _mem_error(exc) from exc
    return {"entry": entry.to_dict(), "created": created}


@memory_router.patch("/entries/{entry_id}")
def memory_update(entry_id: str, body: EntryPatch) -> dict[str, Any]:
    try:
        entry = get_memory_store().update(
            entry_id, content=body.content, title=body.title, kind=body.kind, tags=body.tags, pinned=body.pinned
        )
    except MemoryError_ as exc:
        raise _mem_error(exc) from exc
    return {"entry": entry.to_dict()}


@memory_router.delete("/entries/{entry_id}")
def memory_delete(entry_id: str) -> dict[str, Any]:
    if not get_memory_store().delete(entry_id):
        raise HTTPException(status_code=404, detail="no such memory")
    return {"deleted": entry_id}


@memory_router.delete("/scope")
def memory_delete_scope(scope: str, project: str | None = None) -> dict[str, Any]:
    try:
        return {"deleted": get_memory_store().delete_scope(scope, project)}
    except MemoryError_ as exc:
        raise _mem_error(exc) from exc


@memory_router.get("/projects")
def memory_projects() -> dict[str, Any]:
    from kylo.terminal.services import get_services

    return {"projects": get_memory_store().projects(), "current": get_services().current_workspace}


@memory_router.delete("/projects")
def memory_forget_project(path: str) -> dict[str, Any]:
    return {"deleted": get_memory_store().forget_project(path)}


@memory_router.get("/context")
def memory_context(project: str | None = None, task: str = "") -> dict[str, Any]:
    return get_memory_store().context_for(task, project, budget_chars=12000)


@memory_router.post("/import-agents-md")
def memory_import_agents(body: FolderBody) -> dict[str, Any]:
    if not Path(body.folder).is_dir():
        raise HTTPException(status_code=404, detail="folder does not exist")
    return {"imported": get_memory_store().import_agents_md(body.folder)}


@memory_router.get("/export")
def memory_export(project: str | None = None) -> dict[str, Any]:
    return get_memory_store().export(project=project)


@memory_router.post("/import")
def memory_import(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return get_memory_store().import_(payload)
    except MemoryError_ as exc:
        raise _mem_error(exc) from exc
