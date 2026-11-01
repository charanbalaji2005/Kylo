"""Kylo agent tools: persistent project memory and GitHub (via the gh CLI).

* ``project_memory_recall`` — global + this-workspace memory relevant to a task.
* ``project_memory_save`` — store a durable fact or a task summary (secrets refused).
* ``github_cli`` — GitHub CLI operations with the user's own ``gh`` login.
  Reads run directly; writes (create repo / issue / PR, merge, comment,
  checkout) follow the autonomy policy and may open a permission dialog.
"""
from __future__ import annotations

from typing import Any

from kylo.core.protocols import ExecutionContext, ToolResult

_HUMAN = frozenset({"user", "explicit-intent"})


def _workspace(args: dict[str, Any]) -> str | None:
    from kylo.terminal.services import get_services

    return (str(args.get("workspace")) if args.get("workspace") else None) or get_services().current_workspace


class ProjectMemoryRecallTool:
    name: str = "project_memory_recall"
    read_only: bool = True
    risk_tier: str = "safe"
    description: str = (
        "Recall Kylo's persistent memory for the current workspace before starting a task: project purpose, "
        "tech stack, architecture, build/test/dev commands, decisions, known issues, previous task summaries, "
        "unfinished work, plus the user's global coding preferences. Pass the task description as query."
    )
    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What you are about to work on"},
            "workspace": {"type": "string", "description": "Workspace folder (defaults to the selected one)"},
        },
    }

    async def execute(self, args: dict[str, Any], ctx: ExecutionContext) -> ToolResult:
        from kylo.memory.project_store import get_memory_store

        workspace = _workspace(args)
        result = get_memory_store().context_for(str(args.get("query") or ""), workspace, budget_chars=12000)
        return ToolResult(success=True, output=result)


class ProjectMemorySaveTool:
    name: str = "project_memory_save"
    read_only: bool = False
    risk_tier: str = "safe"
    description: str = (
        "Save a durable fact to Kylo's persistent memory so it survives restarts. scope='project' for facts "
        "about the current workspace (kind: purpose, stack, architecture, file, build_command, test_command, "
        "dev_command, decision, issue, convention, note), scope='task' for what happened in this task "
        "(task_summary, change, command_result, error, unfinished, solution), scope='global' for the user's "
        "general preferences (preference, instruction, tool, provider, terminal). Keep entries short and "
        "factual; duplicates are merged; secrets are refused."
    )
    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "scope": {"type": "string", "enum": ["global", "project", "task"]},
            "kind": {"type": "string"},
            "content": {"type": "string"},
            "title": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
            "workspace": {"type": "string"},
        },
        "required": ["scope", "kind", "content"],
    }

    async def execute(self, args: dict[str, Any], ctx: ExecutionContext) -> ToolResult:
        from kylo.memory.project_store import MemoryError_, get_memory_store

        try:
            entry, created = get_memory_store().add(
                scope=str(args.get("scope") or ""),
                kind=str(args.get("kind") or "note"),
                content=str(args.get("content") or ""),
                project=_workspace(args),
                title=str(args.get("title") or ""),
                tags=args.get("tags") if isinstance(args.get("tags"), list) else None,
                source="agent",
            )
        except MemoryError_ as exc:
            return ToolResult(success=False, output=None, error=str(exc))
        return ToolResult(success=True, output={"id": entry.id, "created": created, "scope": entry.scope})


_READ_ACTIONS = {
    "status", "repo_for_workspace", "list_repos", "view_repo", "list_issues", "view_issue",
    "list_prs", "view_pr", "list_runs", "view_run", "list_workflows",
}
_WRITE_ACTIONS = {"clone", "create_repo", "create_issue", "create_pr", "merge_pr", "comment_pr", "checkout_pr"}


class GitHubTool:
    name: str = "github_cli"
    read_only: bool = False
    risk_tier: str = "monitor"
    description: str = (
        "GitHub through the user's authenticated GitHub CLI (gh). Actions: status, repo_for_workspace, "
        "list_repos(owner?), view_repo(repo), clone(repo, dest?), create_repo(name, private, description, "
        "source?, push?), list_issues(repo, state), view_issue(repo, number), create_issue(repo, title, body), "
        "list_prs(repo, state), view_pr(repo, number), create_pr(title, body, base?, head?, draft?) from the "
        "workspace, merge_pr(repo, number, method), comment_pr(repo, number, body), checkout_pr(number), "
        "list_runs(repo, branch?), view_run(repo, run_id, failed_logs?), list_workflows(repo). repo is "
        "'owner/name'. For local git (branch, commit, push, pull, log) use terminal_run with git."
    )
    schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": sorted(_READ_ACTIONS | _WRITE_ACTIONS)},
            "repo": {"type": "string"},
            "owner": {"type": "string"},
            "number": {"type": "integer"},
            "run_id": {"type": "integer"},
            "state": {"type": "string"},
            "title": {"type": "string"},
            "body": {"type": "string"},
            "name": {"type": "string"},
            "description": {"type": "string"},
            "private": {"type": "boolean", "default": True},
            "push": {"type": "boolean"},
            "source": {"type": "string"},
            "dest": {"type": "string"},
            "base": {"type": "string"},
            "head": {"type": "string"},
            "draft": {"type": "boolean"},
            "method": {"type": "string", "enum": ["merge", "squash", "rebase"]},
            "branch": {"type": "string"},
            "failed_logs": {"type": "boolean"},
            "limit": {"type": "integer"},
        },
        "required": ["action"],
    }

    def risk_tier_for_args(self, args: dict[str, Any]) -> str | None:
        return "safe" if args.get("action") in _READ_ACTIONS else None

    async def execute(self, args: dict[str, Any], ctx: ExecutionContext) -> ToolResult:
        from kylo.github import gh_cli as gh
        from kylo.security.autonomy import evaluate_external
        from kylo.terminal.services import get_services

        action = str(args.get("action") or "")
        if action not in _READ_ACTIONS | _WRITE_ACTIONS:
            return ToolResult(success=False, output=None, error=f"unknown action {action!r}")
        svc = get_services()
        workspace = svc.current_workspace
        if action in _WRITE_ACTIONS:
            decision = evaluate_external(action.replace("_", " "), write=True, settings=svc.autonomy.load())
            if decision.verdict == "ask" and ctx.approved_by not in _HUMAN:
                summary = f"{action} {args.get('repo') or args.get('name') or ''} {args.get('title') or ''}".strip()
                approved, how = await svc.approvals.request(
                    kind="github",
                    title=f"GitHub: {action.replace('_', ' ')}",
                    subject=summary,
                    detail={k: v for k, v in args.items() if k != "body"} | ({"body_preview": str(args.get("body"))[:500]} if args.get("body") else {}),
                    reasons=list(decision.reasons),
                    workspace=workspace,
                    timeout_s=svc.autonomy.load().approval_timeout_s,
                )
                if not approved:
                    return ToolResult(success=False, output=None, error="the user did not approve this GitHub action" if how != "timeout" else "approval timed out")
        limit = int(args.get("limit") or 30)
        try:
            result = await gh.arun(self._dispatch, gh, action, args, workspace, limit)
        except gh.GhError as exc:
            return ToolResult(success=False, output={"code": exc.code}, error=str(exc))
        return ToolResult(success=True, output=result)

    @staticmethod
    def _dispatch(gh: Any, action: str, a: dict[str, Any], workspace: str | None, limit: int) -> Any:
        repo = str(a.get("repo") or "")
        if action == "status":
            return gh.status()
        if action == "repo_for_workspace":
            return gh.repo_for_folder(workspace or "") or {"repo": None, "workspace": workspace}
        if action == "list_repos":
            return gh.list_repos(a.get("owner") or None, limit)
        if action == "view_repo":
            return gh.view_repo(repo)
        if action == "clone":
            from pathlib import Path

            dest = a.get("dest") or (str(Path(workspace).parent) if workspace else str(Path.home()))
            return gh.clone_repo(repo, dest)
        if action == "create_repo":
            return gh.create_repo(str(a.get("name") or ""), private=bool(a.get("private", True)),
                                  description=str(a.get("description") or ""), source=a.get("source") or None,
                                  push=bool(a.get("push")))
        if action == "list_issues":
            return gh.list_issues(repo, a.get("state") or "open", limit)
        if action == "view_issue":
            return gh.view_issue(repo, a.get("number"))
        if action == "create_issue":
            return gh.create_issue(repo, str(a.get("title") or ""), str(a.get("body") or ""))
        if action == "list_prs":
            return gh.list_prs(repo, a.get("state") or "open", limit)
        if action == "view_pr":
            return gh.view_pr(repo, a.get("number"))
        if action == "create_pr":
            if not workspace:
                raise gh.GhError("select a workspace first", code="invalid")
            return gh.create_pr(workspace, title=str(a.get("title") or ""), body=str(a.get("body") or ""),
                                base=a.get("base") or None, head=a.get("head") or None, draft=bool(a.get("draft")))
        if action == "merge_pr":
            return gh.merge_pr(repo, a.get("number"), str(a.get("method") or "squash"))
        if action == "comment_pr":
            return gh.comment_pr(repo, a.get("number"), str(a.get("body") or ""))
        if action == "checkout_pr":
            if not workspace:
                raise gh.GhError("select a workspace first", code="invalid")
            return gh.checkout_pr(workspace, a.get("number"))
        if action == "list_runs":
            return gh.list_runs(repo, min(limit, 100), a.get("branch") or None)
        if action == "view_run":
            return gh.view_run(repo, a.get("run_id"), failed_logs=bool(a.get("failed_logs")))
        if action == "list_workflows":
            return gh.list_workflows(repo)
        raise gh.GhError(f"unknown action {action}", code="invalid")
