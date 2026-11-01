"""The Kylo workspace + memory block added to the agent's system prompt.

Kept small and stable (it sits in the cached prompt prefix): the selected
workspace, the autonomy mode, pinned global memory and the project's core
facts (instructions, purpose, stack, commands). Task-specific memory is pulled
on demand with the ``project_memory_recall`` tool, and the agent is told to
store what it learned with ``project_memory_save`` after meaningful work.
"""
from __future__ import annotations

_MAX_BLOCK_CHARS = 5000


def render_workspace_block() -> str:
    try:
        from kylo.memory.project_store import get_memory_store
        from kylo.terminal.services import get_services

        svc = get_services()
        workspace = svc.current_workspace
        mode = svc.autonomy.load().mode
        store = get_memory_store()
    except Exception:  # noqa: BLE001 - a prompt build must never fail on this
        return ""
    mode_label = {"ask": "Ask Before Actions", "workspace": "Workspace Autonomy", "advanced": "Advanced Autonomy"}.get(mode, mode)
    lines = [
        "KYLO WORKSPACE & MEMORY",
        f"Selected workspace: {workspace or '(none selected)'}",
        f"Autonomy mode: {mode_label}. Commands that need approval wait for the user in a permission dialog.",
        "Terminal: use terminal_run (shell='wsl' for Linux builds/tests by default, 'powershell' or 'cmd' for "
        "Windows tasks); background=true for dev servers; terminal_output / terminal_stop to manage them.",
        "Memory: call project_memory_recall before non-trivial work in this workspace; after meaningful work call "
        "project_memory_save with durable facts (build/test commands, decisions, known issues, a short task summary). "
        "Never store secrets.",
    ]
    try:
        ctx = store.context_for("", workspace, budget_chars=_MAX_BLOCK_CHARS - 800)
    except Exception:  # noqa: BLE001
        ctx = {"sections": {}}
    for title, key in (("Global memory", "global"), ("Project memory", "project")):
        items = ctx.get("sections", {}).get(key) or []
        if items:
            lines.append(f"{title}:")
            for item in items:
                label = item.get("title") or item.get("kind")
                lines.append(f"- [{item.get('kind')}] {label}: {item.get('content')}" if item.get("title") else f"- [{item.get('kind')}] {item.get('content')}")
    block = "\n".join(lines)
    if len(block) > _MAX_BLOCK_CHARS:
        block = block[:_MAX_BLOCK_CHARS].rstrip() + "\n[... more in project_memory_recall]"
    return block + "\nEND KYLO WORKSPACE & MEMORY"
