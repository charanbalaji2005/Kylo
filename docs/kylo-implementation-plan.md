# Kylo implementation plan (2026-11-01)

Kylo is built on the existing codebase rather than beside it. The audit below
records what was already there, and the plan covers only the gaps.

## Audit summary

| Area | Already present | Gap |
|---|---|---|
| Desktop shell | FastAPI backend + React/Vite UI shown in pywebview (`kylo/ui/web/launcher.py`), PyInstaller spec (`kylo.spec`), Inno Setup installer | No Electron shell; spec wants Electron + secure preload + NSIS installer |
| AI providers | `claude-api`, `openai`, `gemini`, `groq`, `openrouter`, `nvidia`, `grok`, `vertex`, generic OpenAI-compatible (`local-openai`), `ollama` (detect, run, list, pull, install), keyring secrets, live connection test (`POST /api/providers/{id}/test`) | Nothing structural; reuse as is |
| Coding CLI agents | Claude Code, Codex, Gemini CLI / Antigravity (`agy`), Grok Build, OpenCode, Kimi, Cursor: version + login probes, PTY panes, mission workers | Not shown on one setup dashboard |
| Terminal | ConPTY/ptyprocess backend, PTY host, xterm.js panes inside the Agentic IDE | No terminal section, no shell profiles, **no WSL**, no user/AI ownership, plain shells die with their socket, no search, no agent command API with streaming + exit code + cancellation |
| Agent loop | `BrainManager` → `ToolUseLoop` → `ToolExecutor` (risk tiers, approvals); chat folder tools (Read/Write/Edit/Grep/RunCommand) | Agent cannot pick WSL/PowerShell/CMD, cannot stream, cannot stop a dev server |
| Git / GitHub | Git SCM routes, PR creation via `gh pr create` / GraphQL, `gh auth token` fallback | No `gh auth status` / `gh api user` detection, no clone, no issues/Actions views, no agent tool for `gh` |
| Memory | Global core memory, wiki vault, FTS recall, global agent instructions | No per-project memory, no task memory, project `AGENTS.md` not loaded |
| Safety | Risk tiers, approval cards, destructive-command classifier | No workspace-scoped autonomy modes; default is bypass |
| Environment setup | Hardware probe, doctor, onboarding wizard | No WSL / git / gh / node / docker / python detection dashboard |

## Plan

1. **Terminal system** (`kylo/terminal/`)
   - `profiles.py`: shell profiles (WSL distros, PowerShell 7, Windows PowerShell, CMD, Git Bash, custom profiles) and terminal settings.
   - `hub.py`: user and agent PTY sessions with an owner, a name, a replay buffer (survives view switches), multi-viewer fan-out, and command history.
   - `command_runner.py`: agent command execution. Pipes are separated into stdout and stderr, output streams, the exit code and final working directory are captured, and runs can be cancelled (the whole process tree is killed). WSL runs `wsl.exe -d <distro> --exec bash -lc <fixed script> <cwd> <command>`, and PowerShell uses base64-embedded values, so no command text is spliced into a shell line. Runs are logged to SQLite.
   - Agent modes: dedicated agent terminal (default), shared active user terminal (only when explicitly enabled), or a new agent session.
   - Routes `/api/terminals/*` and agent tools `terminal-run`, `terminal-output`, `terminal-stop`.
   - UI: a **Terminal** section with tabs, split panes, a profile picker, rename/clear/close, search, copy/paste, AI/You badges, an agent activity panel with Stop, run history, and terminal settings.
2. **Environment detection** (`kylo/setup/environment.py`, `GET /api/environment`) plus a **Setup** dashboard. Nothing is installed without the user clicking.
3. **GitHub CLI** (`kylo/github/`): status (`gh auth status`, `gh api user`), repos, clone, create repo, issues, PRs, Actions runs; `/api/github/*`; a GitHub view; agent tool `github-cli` (reads safe, writes ask).
4. **Persistent memory** (`kylo/memory/project_store.py`): SQLite with global, project (isolated by workspace) and task scopes, FTS search, dedup, secret refusal, export/import, and project `AGENTS.md` ingestion. Routes `/api/kylo-memory/*`, a Project Memory view, and agent tools `project-memory-recall` / `project-memory-save`.
5. **Autonomy modes** (`kylo/security/autonomy.py`): Ask Before Actions / Workspace Autonomy / Advanced Autonomy. These are applied by the terminal and GitHub tools: workspace boundary, sensitive paths, destructive commands, and elevation always need approval. Every run is logged.
6. **Electron shell** (`desktop/`): TypeScript main + preload with `contextIsolation`, `sandbox`, no `nodeIntegration`, and allow-listed, validated IPC. Main spawns and supervises the Python backend and loads the UI over loopback. electron-builder produces an NSIS installer that bundles the frozen backend.
7. Docs, tests (pytest + vitest), type check, production build, installer build.
