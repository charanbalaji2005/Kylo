# Kylo CLI — Command Reference

_Generated from the curated command tree by `scripts/ci/gen_cli_reference.py` — do not edit by hand. Every mounted REST endpoint is additionally reachable via `kylo api <tag> <op>`._

## auth

- `kylo auth login --url --key` — Verify the key against the server and persist it for future calls.
- `kylo auth logout` — Forget the saved credentials.
- `kylo auth status --url --key` — Report whether the configured (or given) target is reachable.

## board

- `kylo board achievements` — Show unlocked + locked achievements.
- `kylo board bio` — Show the AI-generated bio.
- `kylo board bio-regenerate --yes --dry-run` — Regenerate the AI bio.
- `kylo board heatmap --days` — Show the activity heatmap cells.
- `kylo board profile` — Show the profile (meta + people + review count).
- `kylo board records` — Show personal records.
- `kylo board summary --window-days` — Show personal totals + streaks over a window.

## brain

- `kylo brain deep-model <model> --persist --yes --dry-run` — Set the mission worker's deep model.
- `kylo brain list` — List configured brain providers (alias of status).
- `kylo brain status` — Show configured providers and which one is active.
- `kylo brain subagent-switch <provider> --persist --yes --dry-run` — Switch the mission-worker provider (e.g. Codex -> OpenAI).
- `kylo brain switch <provider> --persist --yes --dry-run` — Switch the ACTIVE main brain provider (e.g. `kylo brain switch openai`).
- `kylo brain test <provider> --dry-run` — Test connectivity + auth for a provider.

## clis

- `kylo clis check <name> --yes --dry-run` — Probe a CLI's binary + auth (refreshes its status).
- `kylo clis connect <name> --json-body --yes --dry-run` — Connect a CLI's auth (oauth_cli flow or api_key).
- `kylo clis disconnect <name> --yes --dry-run` — Remove a CLI's stored auth credentials.
- `kylo clis install <name> --method --yes --dry-run` — Start an install job for a CLI (output streams in the desktop view).
- `kylo clis list` — List all CLIs with status (connected, installed, version, 7-day usage).
- `kylo clis show <name>` — Show one CLI (homepage, install methods, auth mode, secrets set).
- `kylo clis usage <name>` — Show a CLI's recent usage history.
- `kylo clis usage-stats <name>` — Show a CLI's aggregated usage stats (success rate, avg duration, top commands).

## commands

- `kylo commands list` — List every registry command (id, endpoint, params, danger, UI section).
- `kylo commands show <command_id>` — Show one command's full definition (params schema, voice aliases).

## computer-use

- `kylo computer-use cancel <mission_id> --yes --dry-run` — Cancel one active run.
- `kylo computer-use cancel-all --yes --dry-run` — Cancel every active run (queued and running).
- `kylo computer-use list --limit` — List active and recent Computer-Use runs.
- `kylo computer-use show <mission_id>` — Show one run: status, goal, exit code, final output.
- `kylo computer-use start <goal> --timeout-s --yes --dry-run` — Start a desktop goal in the background; prints the mission id.

## conductor

- `kylo conductor add --def --yes --dry-run` — Add a job from a Job JSON document.
- `kylo conductor delete <job_id> --yes --dry-run` — Delete a job.
- `kylo conductor list` — List Conductor jobs + a run summary.
- `kylo conductor run <job_id> --yes --dry-run` — Manually trigger a job run.
- `kylo conductor show <job_id>` — Show one job + recent runs.
- `kylo conductor toggle <job_id> --enabled --yes --dry-run` — Enable or disable a job.

## config

- `kylo config confirm <pending_id> --yes --dry-run` — Confirm and apply a pending ASK-tier config mutation (destructive: --yes).
- `kylo config get <path>` — Get a config value by dotted path (control-key gated).
- `kylo config language get` — Show the current reply language + the available options.
- `kylo config language set <lang> --persist --yes --dry-run` — Set the reply language (hot-reloads, no restart).
- `kylo config list` — List the mutable-settings allowlist (path, risk tier, restart needed).
- `kylo config reject <pending_id> --yes --dry-run` — Reject and discard a pending ASK-tier config mutation.
- `kylo config set <path> <value> --reason --yes --dry-run` — Set a mutable config value via the atomic write pipeline (destructive: --yes).

## contacts

- `kylo contacts add --name --alias --relationship --email --phone --url --tag --organization --role --birthday --note --favorite --json-body --yes --dry-run` — Add a contact (field flags, or --json-body for the full record).
- `kylo contacts delete <slug> --yes --dry-run` — Delete a contact.
- `kylo contacts edit <slug> --name --alias --relationship --email --phone --url --tag --organization --role --birthday --note --favorite --json-body --yes --dry-run` — Edit a contact — only the given flags change (partial PATCH).
- `kylo contacts export --out` — Export all contacts as vCard 3.0 (.vcf).
- `kylo contacts import <file> --yes --dry-run` — Import contacts from a vCard file (merges, never clobbers).
- `kylo contacts list` — List contacts.
- `kylo contacts show <slug>` — Show one contact.

## costs

- `kylo costs entries --days --provider --model --role --surface --search --sort --limit --offset` — The individual model calls behind the totals.
- `kylo costs rates --days` — The rate card per model — and which models have no published rate.
- `kylo costs summary --days --provider --model --role --surface --search` — Totals plus the breakdown by provider, model, role, surface and day.

## docs

- `kylo docs list` — List documentation pages.
- `kylo docs search <query>` — Search the docs.
- `kylo docs show <slug>` — Show one doc page's body.
- `kylo docs tree` — Show the Diataxis-grouped doc tree.

## friends

- `kylo friends add --json-body --yes --dry-run` — Add a friend.
- `kylo friends delete <friend_id> --yes --dry-run` — Delete a friend and their channels.
- `kylo friends edit <friend_id> --json-body --yes --dry-run` — Edit a friend (partial).
- `kylo friends list` — List friends with their channels.
- `kylo friends message <friend_id> --text --yes --dry-run` — Send an outbound message to a friend (consequential — needs --yes).
- `kylo friends messages <friend_id>` — Show the message thread with a friend.
- `kylo friends show <friend_id>` — Show one friend (detail + channels + permission profile).

## frontier

- `kylo frontier ack --yes --dry-run` — Acknowledge (dismiss) the pending frontier proposals.
- `kylo frontier pending` — List proposed model upgrades awaiting acknowledgement.

## ide

- `kylo ide archive-terminal <name> --restore --workspace --dry-run` — Hide a coding session from the chat list, or restore it.
- `kylo ide close-terminals <names> --yes --dry-run` — Stop several coding agents and close their terminal panes.
- `kylo ide move-terminal <name> <target_workspace> --workspace --beside --side --dry-run` — Move a terminal pane into another open workspace.
- `kylo ide rename-terminal <name> <new_name> --dry-run` — Rename a running terminal pane without restarting its agent.

## local-models

- `kylo local-models assistant benchmarks --refresh --provider` — Read the benchmark data used by the assistant.
- `kylo local-models assistant diagnose --provider` — Start a guided diagnostic conversation.
- `kylo local-models assistant health --provider` — Read the selected provider's local-model health.
- `kylo local-models assistant session --provider` — Read the existing assistant session and its readiness.
- `kylo local-models assistant setup --provider` — Start the existing guided setup conversation.
- `kylo local-models assistant test --role --provider` — Run the setup test for all roles or the selected roles.
- `kylo local-models catalog recommended --provider` — The curated shortlist ranked for this machine, with its review date.
- `kylo local-models catalog search <query> --sort --capability --limit --provider` — Browse the library; offline is reported as a sentence, not a failure.
- `kylo local-models catalog tags <name> --provider` — Every tag of one library model with size, quantization, context and fit.
- `kylo local-models hf enable <state> --provider --dry-run` — Show or flip the Hugging Face browsing switch.
- `kylo local-models hf files <user> <repo> --provider` — The .gguf files of one repository with quantization, size and fit.
- `kylo local-models hf pull <user> <repo> --quant --provider --dry-run` — Start pulling hf.co/<user>/<repo>[:<quant>] through the normal pull path.
- `kylo local-models hf search <query> --sort --limit --provider` — GGUF repositories on Hugging Face.
- `kylo local-models models delete <name> --reassign --provider --yes --dry-run` — Remove a download from the server (refused while a role still uses it).
- `kylo local-models models list --provider` — Every download with its facts, what is loaded, and the disk total.
- `kylo local-models models show <name> --provider` — One download with the long facts (license, parameters, template).
- `kylo local-models models unload <name> --provider --yes --dry-run` — Free the memory a loaded model holds; the next turn pays the load again.
- `kylo local-models options clear <name> --provider --dry-run` — Drop the profile so the server's defaults apply again.
- `kylo local-models options get <name> --provider` — The profile of one model as configured (empty when none).
- `kylo local-models options set <name> <values> --provider --dry-run` — Replace the profile of a model with the given knobs (whole set).
- `kylo local-models options suggest <name> --provider` — An advisory profile for this machine, with one reason per knob.
- `kylo local-models roles list --provider` — Every role with its pick, what qualifies, and the recommendation.
- `kylo local-models roles set <role> <model> --provider --dry-run` — Assign a model to a role (written through the config writers).
- `kylo local-models server autostart <state> --provider --dry-run` — Show or flip "start the server with Kylo" (fires only while local models are in use).
- `kylo local-models server env-guide --os --provider` — Copyable per-OS commands for the server's environment variables.
- `kylo local-models server log --lines --provider` — The last lines of the server log Kylo writes when it starts the server.
- `kylo local-models server status --provider` — Runtime picture plus what is loaded and how much disk the downloads take.
- `kylo local-models server stop --provider --yes --dry-run` — Stop the server Kylo itself started (never one started elsewhere).
- `kylo local-models server test <base_url> --provider` — Probe a host before saving it: version and latency, or why it failed.
- `kylo local-models server verify --provider` — Prove the setup works: the server, one real chat answer, one real embedding.

## marketplace

- `kylo marketplace browse` — Show everything the community marketplace offers, and what you already have.
- `kylo marketplace connect-pat <plugin_id> --token --yes --dry-run` — Connect a plugin with a personal access token.
- `kylo marketplace connect-poll <plugin_id> <flow_id>` — Poll an in-progress OAuth connect flow.
- `kylo marketplace connect-start <plugin_id> --yes --dry-run` — Begin an OAuth connect flow (prints the redirect URI + flow id).
- `kylo marketplace disconnect <plugin_id> --yes --dry-run` — Disconnect a plugin.
- `kylo marketplace install <item_id> --yes --dry-run` — Install a marketplace entry by name — skill, plugin or agent — and report it.
- `kylo marketplace list` — List marketplace plugins + their connection status.

## mcps

- `kylo mcps check <name> --yes --dry-run` — Health-check an MCP server (lists its tools).
- `kylo mcps delete <name> --yes --dry-run` — Remove an MCP server.
- `kylo mcps disable <name> --yes --dry-run` — Disable an MCP server.
- `kylo mcps enable <name> --yes --dry-run` — Enable an MCP server.
- `kylo mcps import-claude-desktop --yes --dry-run` — Import MCP servers from the Claude Desktop config.
- `kylo mcps list` — List MCP servers + a summary.

## missions

- `kylo missions approve-tool <mission_id> <trace_id> --yes --dry-run` — Approve one paused mission tool call and resume it.
- `kylo missions cancel <mission_id> --yes --dry-run` — Cancel a running mission (kills its worker).
- `kylo missions deny-tool <mission_id> <trace_id> --reason --dry-run` — Deny one paused mission tool call without executing it.
- `kylo missions dispatch <prompt> --language --confirmed --yes --dry-run` — Dispatch a new self-healing mission — spawns a worker (destructive: --yes).
- `kylo missions kill <worker_id> --yes --dry-run` — Hard-kill a worker process by id.
- `kylo missions list --state --limit` — List missions (optionally filtered by state).
- `kylo missions rerun <mission_id> --confirmed --yes --dry-run` — Re-dispatch a terminal mission's prompt as a new linked mission.
- `kylo missions result <mission_id>` — Read a mission's signed outcome and actual deliverable contents.
- `kylo missions show <mission_id>` — Show one mission with its events + verdicts.
- `kylo missions tool-approvals <mission_id>` — List supervisor tool calls waiting for approval in a mission.

## outputs

- `kylo outputs files <slug>` — List the artifacts a mission produced.
- `kylo outputs graph <slug>` — Print a session's mission-map page (self-contained HTML node graph).
- `kylo outputs list` — List output sessions (a mission's deliverable folders).
- `kylo outputs open-with <slug> <path> --opener --yes --dry-run` — Open an artifact with a chosen editor (desktop only).
- `kylo outputs openers` — List installed editors/apps that can open an artifact.
- `kylo outputs plan <slug>` — Show a session's plan + steps.
- `kylo outputs preferred-opener <opener> --yes --dry-run` — Get or set the default artifact opener.

## permissions

- `kylo permissions open-settings <permission_id> --yes --dry-run` — Open the matching macOS privacy pane through LaunchServices.
- `kylo permissions request <permission_id> --yes --dry-run` — Ask macOS for one permission through the same service the app uses.
- `kylo permissions reset <permission_id> --bundle-id --yes --dry-run` — Forget what macOS recorded for Kylo, so it asks again on next use (macOS only).
- `kylo permissions status --include-automation` — Show each macOS privacy permission and what is waiting on one. Never prompts.

## refresh

- `kylo refresh` — Clear the cached API schema (next call re-fetches it).

## sessions

- `kylo sessions command <session_id> <command> --arguments --request-id --yes --dry-run` — Run an explicit command in a Kylo or agent chat.
- `kylo sessions control <session_id>` — Read a chat's current work mode and persistent goal.
- `kylo sessions delete <session_id> --yes --dry-run` — Delete a text conversation thread.
- `kylo sessions latest-turn --session-id` — Show the latest persisted user transcript and its complete turn.
- `kylo sessions list --days --limit` — List text + voice sessions, newest first.
- `kylo sessions resume <kind> <session_id> --yes --dry-run` — Seed the brain from a past conversation to continue it in text.
- `kylo sessions show <kind> <session_id>` — Show one conversation with its messages.
- `kylo sessions speak <kind> <session_id> --yes --dry-run` — Start a voice session seeded from a past conversation (503 on headless).

## skills

- `kylo skills catalog-install <name> --source-url --title --raw-url --yes --dry-run` — Install a skill from the catalog (lands as a draft).
- `kylo skills catalog-search <query>` — Search the installable skill catalog.
- `kylo skills commit --draft --yes --dry-run` — Commit a generated draft to disk (still state=draft until enabled).
- `kylo skills create <intent> --name --trigger --schedule --language --yes --dry-run` — Author AND write a new skill in one step (the voice path's `create-skill`).
- `kylo skills disable <name> --yes --dry-run` — Deactivate a skill.
- `kylo skills draft <intent> --name-hint --category --trigger --schedule --language --yes --dry-run` — Generate a skill draft from an intent WITHOUT writing it (review, then `commit`).
- `kylo skills enable <name> --yes --dry-run` — Activate a skill.
- `kylo skills import <source> --yes --dry-run` — Install a skill from a local folder or a SKILL.md link.
- `kylo skills list` — List all discovered skills.
- `kylo skills reload --yes --dry-run` — Re-scan the skills directory.
- `kylo skills show <name>` — Show one skill's detail.

## socials

- `kylo socials add --json-body --yes --dry-run` — Add a social link.
- `kylo socials delete <social_id> --yes --dry-run` — Delete a social link.
- `kylo socials edit <social_id> --json-body --yes --dry-run` — Edit a social link (partial).
- `kylo socials list` — List social links.

## system

- `kylo system audio-devices --output --input` — List audio devices, or pick where the voice plays / which mic listens.
- `kylo system restart --force --yes --dry-run` — Refuse a CLI restart; use the desktop UI's explicit Restart action.
- `kylo system status` — Report server reachability + version (GET /api/control/auth/probe).

## tasks

- `kylo tasks cancel <task_id> --yes --dry-run` — Soft-cancel a scheduled/running task.
- `kylo tasks create --json-body --yes --dry-run` — Create + schedule a task from a TaskSpec JSON document.
- `kylo tasks delete <task_id> --yes --dry-run` — Hard-delete a task (terminal states only, server-enforced).
- `kylo tasks get <task_id>` — Show one task with its step timeline.
- `kylo tasks list --state --limit` — List tasks (optionally filtered by state).

## telephony

- `kylo telephony config` — Show the telephony config.
- `kylo telephony outbound <to> --message --yes --dry-run` — Place a real outbound call (destructive: costs money; needs --yes).
- `kylo telephony status` — Report telephony availability/status.

## version

- `kylo version` — Print the CLI version.

## wiki

- `kylo wiki backfill --days --max-sessions --preview --yes --dry-run` — Backfill recent Realtime sessions through evidence-safe Wiki capture.
- `kylo wiki health` — Show wiki subsystem health: bootstrap, last write, chain failures, backlog (spec A5).
- `kylo wiki ingest <text> --source --dry-run` — Store a fact through the guarded Wiki curator.
- `kylo wiki page <slug>` — Read a wiki page by vault path / slug.
- `kylo wiki recall <query>` — Full-text search the wiki.
- `kylo wiki reindex --preview` — Rebuild the wiki search index from the active vault.
- `kylo wiki tree` — Show the vault folder tree + stats.
- `kylo wiki vaults` — List the user's registered Obsidian vaults (connect picker, spec A6).

## workflows

- `kylo workflows create --def --yes --dry-run` — Create a workflow from a WorkflowDef JSON document.
- `kylo workflows delete <workflow_id> --yes --dry-run` — Delete a workflow.
- `kylo workflows list` — List workflows + a run summary.
- `kylo workflows run <workflow_id> --yes --dry-run` — Trigger a workflow run.
- `kylo workflows run-history --workflow-id` — List workflow runs (optionally for one workflow).
- `kylo workflows show <workflow_id>` — Show one workflow + recent runs.

