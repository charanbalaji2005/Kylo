"""GitHub operations through the installed, authenticated GitHub CLI.

Kylo never asks for a personal access token when ``gh`` is signed in: every
operation runs ``gh`` with the user's own login and therefore with exactly
the permissions that login has. Each call is a fixed argv (no shell), with
``GH_PROMPT_DISABLED=1`` so nothing can hang on an interactive prompt, and
inputs (repository names, numbers, branch names) are validated first.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

REPO_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$")
REPO_URL_RE = re.compile(r"^https://github\.com/([A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}?)(?:\.git)?/?$")
OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
BRANCH_RE = re.compile(r"^(?!-)(?!.*\.\.)[A-Za-z0-9._/+-]{1,200}$")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
_DEFAULT_TIMEOUT = 60.0


class GhError(RuntimeError):
    def __init__(self, message: str, *, code: str = "error") -> None:
        super().__init__(message)
        self.code = code


def gh_path() -> str | None:
    return shutil.which("gh")


def normalize_repo(repo: str) -> str:
    repo = (repo or "").strip()
    match = REPO_URL_RE.match(repo)
    if match:
        repo = match.group(1)
    if not REPO_RE.match(repo):
        raise GhError(f"not a GitHub repository name (owner/name): {repo!r}", code="invalid")
    return repo


def _check_number(value: Any, what: str) -> str:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise GhError(f"{what} must be a number", code="invalid") from exc
    if number <= 0:
        raise GhError(f"{what} must be positive", code="invalid")
    return str(number)


def _env() -> dict[str, str]:
    env = {**os.environ, "GH_PROMPT_DISABLED": "1", "NO_COLOR": "1", "GH_NO_UPDATE_NOTIFIER": "1", "GIT_TERMINAL_PROMPT": "0"}
    env.pop("JARVIS_CONTROL_KEY", None)
    return env


def run_gh(args: list[str], *, cwd: str | None = None, timeout: float = _DEFAULT_TIMEOUT, stdin: str | None = None) -> str:
    """Run ``gh`` synchronously; raise :class:`GhError` with gh's message on failure."""
    gh = gh_path()
    if gh is None:
        raise GhError("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/", code="missing")
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv, validated values
            [gh, *args],
            cwd=cwd,
            input=stdin.encode("utf-8") if stdin is not None else None,
            capture_output=True,
            timeout=timeout,
            check=False,
            env=_env(),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired as exc:
        raise GhError(f"gh {args[0]} timed out after {timeout:g}s", code="timeout") from exc
    except OSError as exc:
        raise GhError(f"could not run gh: {exc}") from exc
    out = completed.stdout.decode("utf-8", errors="replace")
    err = completed.stderr.decode("utf-8", errors="replace").strip()
    if completed.returncode != 0:
        lowered = err.lower()
        code = "auth" if ("gh auth login" in lowered or "not logged" in lowered or "authentication" in lowered) else "error"
        if "could not resolve to a repository" in lowered or "not found" in lowered:
            code = "not_found"
        raise GhError(err.splitlines()[-1] if err else f"gh exited with {completed.returncode}", code=code)
    return out


def run_json(args: list[str], **kwargs: Any) -> Any:
    out = run_gh(args, **kwargs)
    try:
        return json.loads(out) if out.strip() else None
    except ValueError as exc:
        raise GhError(f"unexpected gh output: {out[:200]}") from exc


async def arun(fn: Any, *args: Any, **kwargs: Any) -> Any:
    return await asyncio.get_running_loop().run_in_executor(None, lambda: fn(*args, **kwargs))


# --------------------------------------------------------------------------- #
# Status                                                                       #
# --------------------------------------------------------------------------- #
def status() -> dict[str, Any]:
    gh = gh_path()
    git = shutil.which("git")
    result: dict[str, Any] = {
        "git_installed": git is not None,
        "gh_installed": gh is not None,
        "authenticated": False,
        "login": None,
        "name": None,
        "scopes": [],
        "install_url": "https://cli.github.com/",
        "login_command": "gh auth login",
    }
    if gh is None:
        return result
    try:
        version = run_gh(["--version"], timeout=10)
        result["gh_version"] = (re.search(r"(\d+\.\d+\.\d+)", version) or [None, None])[1] if version else None
    except GhError:
        pass
    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv
            [gh, "auth", "status", "--hostname", "github.com"],
            capture_output=True,
            timeout=15,
            check=False,
            env=_env(),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        text = (completed.stdout + completed.stderr).decode("utf-8", errors="replace")
        result["authenticated"] = completed.returncode == 0
        scopes = re.search(r"Token scopes:\s*(.+)", text)
        if scopes:
            result["scopes"] = [s.strip(" '") for s in scopes.group(1).split(",") if s.strip()]
    except (OSError, subprocess.SubprocessError):
        return result
    if result["authenticated"]:
        try:
            user = run_json(["api", "user"], timeout=20)
            result["login"] = user.get("login")
            result["name"] = user.get("name")
            result["avatar_url"] = user.get("avatar_url")
            result["html_url"] = user.get("html_url")
        except GhError as exc:
            result["error"] = str(exc)
    return result


def repo_for_folder(folder: str) -> dict[str, Any] | None:
    """The GitHub repository of a local checkout, or None."""
    if not folder or not Path(folder).is_dir():
        return None
    try:
        return run_json(
            ["repo", "view", "--json", "nameWithOwner,url,description,visibility,defaultBranchRef,isPrivate,viewerPermission"],
            cwd=folder,
            timeout=20,
        )
    except GhError:
        return None


# --------------------------------------------------------------------------- #
# Repositories                                                                 #
# --------------------------------------------------------------------------- #
_REPO_FIELDS = "name,nameWithOwner,description,visibility,isPrivate,isFork,updatedAt,url,primaryLanguage,stargazerCount"


def list_repos(owner: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    args = ["repo", "list"]
    if owner:
        if not OWNER_RE.match(owner):
            raise GhError("invalid owner", code="invalid")
        args.append(owner)
    args += ["--limit", str(max(1, min(int(limit), 500))), "--json", _REPO_FIELDS]
    return run_json(args) or []


def view_repo(repo: str) -> dict[str, Any]:
    return run_json(["repo", "view", normalize_repo(repo), "--json", _REPO_FIELDS + ",defaultBranchRef,viewerPermission"])


def clone_repo(repo: str, parent_dir: str, *, directory: str | None = None) -> dict[str, Any]:
    repo = normalize_repo(repo)
    parent = Path(parent_dir).expanduser()
    if not parent.is_dir():
        raise GhError(f"destination folder does not exist: {parent}", code="invalid")
    name = directory or repo.split("/", 1)[1]
    if not NAME_RE.match(name):
        raise GhError("invalid directory name", code="invalid")
    target = parent / name
    if target.exists():
        raise GhError(f"{target} already exists", code="exists")
    run_gh(["repo", "clone", repo, str(target)], timeout=900)
    return {"repo": repo, "path": str(target.resolve())}


def create_repo(name: str, *, private: bool = True, description: str = "", source: str | None = None, push: bool = False) -> dict[str, Any]:
    if not (NAME_RE.match(name) or REPO_RE.match(name)):
        raise GhError("invalid repository name", code="invalid")
    args = ["repo", "create", name, "--private" if private else "--public"]
    if description:
        args += ["--description", description[:350]]
    if source:
        if not Path(source).is_dir():
            raise GhError(f"source folder does not exist: {source}", code="invalid")
        args += ["--source", source, "--remote", "origin"]
        if push:
            args.append("--push")
    out = run_gh(args, timeout=180)
    url = next((ln.strip() for ln in out.splitlines() if ln.strip().startswith("https://")), None)
    return {"name": name, "url": url, "output": out.strip()[-2000:]}


# --------------------------------------------------------------------------- #
# Issues / pull requests / Actions                                             #
# --------------------------------------------------------------------------- #
def _state(state: str | None, allowed: tuple[str, ...]) -> str:
    state = (state or allowed[0]).lower()
    if state not in allowed:
        raise GhError(f"state must be one of {', '.join(allowed)}", code="invalid")
    return state


def list_issues(repo: str, state: str = "open", limit: int = 30) -> list[dict[str, Any]]:
    return run_json(
        ["issue", "list", "-R", normalize_repo(repo), "--state", _state(state, ("open", "closed", "all")),
         "--limit", str(max(1, min(int(limit), 200))),
         "--json", "number,title,state,author,labels,updatedAt,url,comments"]
    ) or []


def view_issue(repo: str, number: Any) -> dict[str, Any]:
    return run_json(
        ["issue", "view", _check_number(number, "issue"), "-R", normalize_repo(repo),
         "--json", "number,title,state,author,body,labels,comments,url,createdAt"]
    )


def create_issue(repo: str, title: str, body: str = "") -> dict[str, Any]:
    if not title.strip():
        raise GhError("title is required", code="invalid")
    out = run_gh(["issue", "create", "-R", normalize_repo(repo), "--title", title[:256], "--body-file", "-"], stdin=body or "")
    return {"url": out.strip().splitlines()[-1] if out.strip() else None}


def list_prs(repo: str, state: str = "open", limit: int = 30) -> list[dict[str, Any]]:
    return run_json(
        ["pr", "list", "-R", normalize_repo(repo), "--state", _state(state, ("open", "closed", "merged", "all")),
         "--limit", str(max(1, min(int(limit), 200))),
         "--json", "number,title,state,author,headRefName,baseRefName,isDraft,updatedAt,url,reviewDecision"]
    ) or []


def view_pr(repo: str, number: Any) -> dict[str, Any]:
    return run_json(
        ["pr", "view", _check_number(number, "pull request"), "-R", normalize_repo(repo),
         "--json", "number,title,state,author,body,headRefName,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup,files,url,comments"]
    )


def create_pr(folder: str, *, title: str, body: str = "", base: str | None = None, head: str | None = None, draft: bool = False) -> dict[str, Any]:
    if not Path(folder).is_dir():
        raise GhError("folder does not exist", code="invalid")
    if not title.strip():
        raise GhError("title is required", code="invalid")
    args = ["pr", "create", "--title", title[:256], "--body-file", "-"]
    for flag, value in (("--base", base), ("--head", head)):
        if value:
            if not BRANCH_RE.match(value):
                raise GhError(f"invalid branch name {value!r}", code="invalid")
            args += [flag, value]
    if draft:
        args.append("--draft")
    out = run_gh(args, cwd=folder, stdin=body or "", timeout=120)
    return {"url": out.strip().splitlines()[-1] if out.strip() else None}


def merge_pr(repo: str, number: Any, method: str = "squash", delete_branch: bool = False) -> dict[str, Any]:
    if method not in ("merge", "squash", "rebase"):
        raise GhError("method must be merge, squash or rebase", code="invalid")
    args = ["pr", "merge", _check_number(number, "pull request"), "-R", normalize_repo(repo), f"--{method}"]
    if delete_branch:
        args.append("--delete-branch")
    out = run_gh(args, timeout=120)
    return {"merged": True, "output": out.strip()[-1000:]}


def comment_pr(repo: str, number: Any, body: str) -> dict[str, Any]:
    if not body.strip():
        raise GhError("comment is empty", code="invalid")
    out = run_gh(["pr", "comment", _check_number(number, "pull request"), "-R", normalize_repo(repo), "--body-file", "-"], stdin=body)
    return {"url": out.strip().splitlines()[-1] if out.strip() else None}


def checkout_pr(folder: str, number: Any) -> dict[str, Any]:
    if not Path(folder).is_dir():
        raise GhError("folder does not exist", code="invalid")
    out = run_gh(["pr", "checkout", _check_number(number, "pull request")], cwd=folder, timeout=180)
    return {"output": out.strip()[-1000:]}


def list_runs(repo: str, limit: int = 20, branch: str | None = None) -> list[dict[str, Any]]:
    args = ["run", "list", "-R", normalize_repo(repo), "--limit", str(max(1, min(int(limit), 100))),
            "--json", "databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,url"]
    if branch:
        if not BRANCH_RE.match(branch):
            raise GhError("invalid branch", code="invalid")
        args += ["--branch", branch]
    return run_json(args) or []


def view_run(repo: str, run_id: Any, *, failed_logs: bool = False) -> dict[str, Any]:
    rid = _check_number(run_id, "run id")
    repo = normalize_repo(repo)
    data = run_json(["run", "view", rid, "-R", repo, "--json", "databaseId,displayTitle,status,conclusion,workflowName,headBranch,jobs,url"])
    if failed_logs and data and data.get("conclusion") not in (None, "success"):
        try:
            data["failed_log"] = run_gh(["run", "view", rid, "-R", repo, "--log-failed"], timeout=120)[-30_000:]
        except GhError as exc:
            data["failed_log_error"] = str(exc)
    return data


def list_workflows(repo: str) -> list[dict[str, Any]]:
    return run_json(["workflow", "list", "-R", normalize_repo(repo), "--json", "id,name,state,path"]) or []
