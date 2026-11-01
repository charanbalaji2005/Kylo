# Kylo desktop: terminal, agents, GitHub, memory

Kylo is an AI agent development environment for Windows 10/11. It's built on the Dodaios codebase (Apache-2.0; see `NOTICE`). This page covers the Kylo-specific parts: the Electron shell, the integrated terminal, the agent execution API, permissions, environment detection, GitHub and persistent memory.

*Your AI. Your Terminal. Your Workflow.*

## Architecture

```
Electron shell (desktop/)            Python backend (kylo/)                     React UI (kylo/ui/web/frontend)
 main.ts  ── spawns + supervises ──▶  python -m kylo serve --port <free port>   served by the backend
 preload.ts  window.kylo (5 calls)    ├─ /api/terminals  terminal hub + agent runs (kylo/terminal)
                                      ├─ /api/environment  tool detection (kylo/setup/environment.py)
                                      ├─ /api/github       gh CLI (kylo/github/gh_cli.py)
                                      ├─ /api/kylo-memory  SQLite memory (kylo/memory/project_store.py)
                                      └─ brain providers, chat agent loop, Agentic IDE, wiki, …
```

The renderer never gets Node.js or shell access. Terminals and commands go through the backend's authenticated, policy-checked API. The preload exposes exactly five validated calls: `selectFolder`, `notify`, `openExternal` (http/https only), `revealPath` and `appInfo`. Each IPC call is answered only for frames on the backend origin. The window settings are `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`. Navigation is pinned to the backend origin, and permissions are limited to clipboard, notifications, media and fullscreen.

Credentials (provider API keys) live in the Windows Credential Manager through `keyring` (`kylo.core.config.get_secret`). GitHub uses the user's own `gh` login, so Kylo never asks for a token.

## Integrated terminal (Terminal section)

* **Shell profiles**
  * One profile per installed WSL distribution (`wsl.exe -l -v`), plus PowerShell 7, Windows PowerShell, CMD and Git Bash.
  * Custom profiles: path, arguments, environment variables and working directory.
  * Default shell, WSL distribution, start folder and extra environment variables are configured in Setup → Terminal.
* **Sessions** are real ConPTY sessions (`pywinpty`) owned by the backend hub (`kylo/terminal/hub.py`).
  * Tabs, split right or down, rename (double-click), close, clear, find (Ctrl+F).
  * Copy and paste: Ctrl+Shift+C, Ctrl+V, or Ctrl+C with a selection.
  * Run selection, send command.
  * Leaving the view or reloading only detaches a session: the replay buffer repaints it on reattach.
  * The previous session's terminals are reopened on the next start.
* **Ownership.** Every session is labelled **You** or **AI**. The working directory is tracked from OSC 7, which Kylo enables in bash (WSL, Git Bash), PowerShell and CMD prompts.
* **AI terminal tab.** Every command an agent runs appears there live: the command, stdout, stderr in red, and the exit code and duration. Each command has its own Stop button, and **Stop AI** stops them all and denies pending approvals.
* **History tab.** Every command run, from SQLite (`<data>/terminal/runs.db`), with its output.

Keys: Ctrl+Shift+\` opens a new terminal, Ctrl+Shift+5 splits, Ctrl+F finds.

## Agent execution API

Agents use the router tools `terminal_run`, `terminal_output` and `terminal_stop` (`kylo/plugins/tool/kylo_terminal.py`). Every call goes through `kylo.terminal.agent_exec.agent_run`:

1. The **policy** (`kylo/security/autonomy.py`) decides `allow`, `ask` or `block`.
2. `ask` without a human approval opens the **permission dialog**, which shows the command, shell, folder and reasons. Closing the dialog or letting it time out denies the command.
3. The command runs where the user chose:
   * `dedicated` (default): the AI terminal, through `CommandRunner`. stdout and stderr are separate, there is an exit code, the final cwd carries over to the next command, and cancel kills the whole process tree.
   * `new`: an AI-owned interactive session.
   * `shared`: the user's active terminal. This mode works only if *Let the AI use my active terminal* is on, and every viewer sees `▶ Kylo AI ran: …`.

How commands reach each shell, never spliced into a command line:

| Shell | argv |
|---|---|
| WSL | `wsl.exe -d <distro> --exec bash -lc <fixed script> kylo <cwd> <command>` |
| Git Bash | `bash.exe -lc <fixed script> kylo <cwd> <command>` |
| PowerShell | `powershell.exe -NoProfile -NonInteractive -EncodedCommand <fixed wrapper with base64 command + cwd>` |
| CMD | `cmd.exe /d /s /c "<command>"` (single line) |

`background=true` starts a dev server and returns after a few seconds. `terminal_output` reads it later, and `terminal_stop` ends it. REST: `POST /api/terminals/runs`, `GET /api/terminals/runs[/{id}]`, `POST /api/terminals/runs/{id}/cancel`, `POST /api/terminals/agent/stop`, and `WS /api/terminals/events`.

## Permissions (Setup → Permissions)

| Mode | Runs on its own | Asks |
|---|---|---|
| Ask Before Actions | nothing | every command, file change and GitHub write |
| Workspace Autonomy (default) | development commands inside the workspace | anything outside it, or with no workspace selected |
| Advanced Autonomy | commands anywhere; GitHub writes | (see below) |

In **every** mode, these always ask:

* destructive commands (`rm`, `del`, `Remove-Item`, `git reset --hard`, …),
* administrator or root elevation (`sudo`, `runas`, `-Verb RunAs`),
* system configuration changes,
* `curl … | sh`,
* sensitive locations (`.ssh`, `.aws`, credential stores, `System32`, plus any you add).

Commands that could wipe a disk or the OS (`rm -rf /`, `format c:`, `mkfs`, `diskpart`, `bcdedit`, …) are **blocked** in every mode.

These rules are enforced by the Kylo tools themselves, so a chat in *bypass* stance cannot skip them. Only a human approval counts.

## Environment detection (Setup)

`GET /api/environment` detects the tools below. It installs nothing.

* WSL 2 and its distributions, and the Linux toolchain inside the preferred distribution (git, node, npm, pnpm, yarn, python3, pip, gcc, make, cmake, go, rust, java, docker, gh).
* Git, including `user.name`.
* The GitHub CLI: installed, signed in (`gh auth status`), account (`gh api user`) and scopes.
* Node, npm, pnpm, yarn, Python, and Docker (CLI and engine).
* Ollama: installed, API running, models.
* Claude Code, Gemini CLI, Antigravity, Codex, OpenCode and the Cursor CLI.

**Install** opens a visible terminal with the install command (for example `winget install --id GitHub.cli -e`) and runs it there.

AI providers are configured in the existing provider pages: OpenAI, Anthropic, Gemini, Groq, OpenRouter, NVIDIA, xAI, any OpenAI-compatible endpoint (`local-openai`), and Ollama (detect, start, list, pull). The existing pages also handle key storage, connection tests and model selection.

## GitHub (GitHub section, `github_cli` tool)

GitHub access uses the installed `gh` and its login: status, repositories, clone (optionally as the workspace), create (optionally pushing the workspace), issues, pull requests (open, merge), and Actions runs with failed-step logs.

* If `gh` is missing, Kylo offers to install it.
* If you're not signed in, it runs `gh auth login` in a visible terminal.
* The agent tool reads freely. Writes follow the autonomy policy.

## Persistent memory (Project Memory section)

SQLite (`<data>/kylo_memory/memory.db`) with FTS5 search.

* **global**: preferences, instructions, tools, providers, terminal.
* **project**: isolated per workspace. Purpose, stack, architecture, files, build/test/dev commands, decisions, issues, conventions.
* **task**: summaries, changes, command results, errors, unfinished work, solutions.

How it behaves:

* Duplicates are merged.
* Anything that looks like a credential is refused.
* Selecting a workspace imports its `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` as pinned project instructions.
* The agent's system prompt carries the workspace, the autonomy mode and the pinned memory. Agents call `project_memory_recall` before a task and `project_memory_save` after it.
* Every entry can be inspected, edited, pinned, deleted, exported and imported.

## Run, test, package

```powershell
# Backend + UI in a browser (development)
py -3.11 -m pip install -e ".[desktop]"
cd kylo\ui\web\frontend; npm ci; npm run build; cd ..\..\..\..
py -3.11 -m kylo serve --port 47900          # open http://127.0.0.1:47900

# Desktop shell (development: runs the backend from this checkout)
cd desktop; npm ci; npm start               # KYLO_PYTHON=<python.exe> to pick an interpreter

# Tests
py -3.11 -m pytest tests/unit/terminal tests/unit/memory/test_project_store.py tests/integration/test_kylo_api.py
cd kylo\ui\web\frontend; npx vitest run src/components/kylo src/i18n/kylo-i18n-parity.test.ts
cd desktop; npm test

# Windows installer
py -3.11 -m pip install pyinstaller
py -3.11 -m PyInstaller kylo.spec --noconfirm   # → dist\Jarvis (frozen backend + web UI)
cd desktop; npm run dist                        # → desktop\release\Kylo-Setup-<version>-x64.exe
```

The installer is a per-user NSIS setup with a choice of install folder and Start menu and desktop shortcuts. It bundles the frozen backend under `resources\backend`, and `LICENSE`, `NOTICE` and third-party notices under `resources\legal`. User data lives in `%APPDATA%\Kylo\data` and is kept on uninstall.

## Limits

* Terminal sessions survive view switches and window reloads. After an app restart, the terminals are reopened, but the shells inside them are new processes.
* CMD sessions report their cwd through the prompt only, so a `cd` inside a batch file is not tracked.
* Agent commands in `shared` / `new` mode wait for a completion marker the shell prints. A full-screen program that never returns to the prompt ends with a timeout, and Kylo sends Ctrl+C.
