---
name: drive-kylo-cli
description: >-
  Use when a terminal agent needs to control a running Kylo instance: switch
  the brain provider, dispatch or inspect missions, read or write config, search
  the wiki, manage skills, browse outputs. Trigger phrases: "control Kylo",
  "drive Kylo from the CLI", "switch Kylo's brain provider", "dispatch a
  Kylo mission".
---

# Drive Kylo from the CLI

`kylo` (older names: `jarvis`, `jarvisctl`, `jctl`) is an HTTP client for a
**running** Kylo. Full guide: `docs/kylo-cli.md`.

- **Auth is automatic** on the same machine. `kylo system status` says whether
  Kylo is reachable; if not, start it (`kylo serve` for headless) instead
  of retrying. For a remote box, tunnel the port to loopback
  (`ssh -L 47821:127.0.0.1:47821 <host>`).
- **Discover:** `kylo --help`, `kylo <group> --help`. Every REST route is
  also reachable as `kylo api <tag> <op>`.
- **Read with `--json`** placed before the group (`kylo --json missions list`)
  and parse that, not the table.
- **`--dry-run`** prints the exact request and sends nothing.
- **Destructive commands** (any `DELETE`, `config set`, `missions dispatch`,
  `telephony outbound`) refuse without `--yes`. Add it only when you mean it.
- **Never pass a secret as an argument**; `auth login` reads it from a hidden
  prompt or stdin (`--key -`).

```bash
kylo brain switch openai
kylo --json config get brain.primary
kylo missions dispatch "summarize today's PRs" --yes
kylo --json wiki recall "insurance policy"
```
