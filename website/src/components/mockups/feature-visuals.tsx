"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  Brain,
  Check,
  GitBranch,
  GitPullRequest,
  KeyRound,
  Mic,
  Search,
  ShieldAlert,
  SquareTerminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KyloMark } from "../kylo-logo";
import { AppWindow, Chip } from "./window";
import { TerminalLines } from "./terminal";

/* 01 — natural language to a gated command */
export function CommandVisual() {
  return (
    <AppWindow title="Kylo" bodyClassName="space-y-4 p-5 sm:p-6">
      <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md border border-hairline bg-elevated px-3.5 py-2.5 text-[12.5px] text-ink">
        Free up space — delete build folders older than 30 days in C:\dev
      </div>
      <div className="flex gap-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-hairline bg-raised">
          <KyloMark className="size-3.5 text-ink" />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-[12.5px] text-body">Found 6 folders (2.4 GB). This command removes them:</p>
          <pre className="overflow-x-auto rounded-lg border border-hairline bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
{`Get-ChildItem C:\\dev -Directory -Recurse -Filter dist |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) |
  Remove-Item -Recurse`}
          </pre>
          <div className="rounded-lg border border-hairline-strong bg-raised p-3">
            <p className="flex items-center gap-2 text-[12px] text-ink">
              <ShieldAlert className="size-4" strokeWidth={1.5} /> Deletes files · needs your approval
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-ink px-3 py-1 font-medium text-canvas">Allow once</span>
              <span className="rounded-full border border-hairline px-3 py-1 text-body">Show files first</span>
              <span className="rounded-full border border-hairline px-3 py-1 text-body">Deny</span>
            </div>
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

/* 02 — several sessions side by side */
export function MultiTerminalVisual() {
  const sessions = [
    { name: "PowerShell", task: "npm run dev", state: "running" },
    { name: "WSL: Ubuntu", task: "pytest -q", state: "running" },
    { name: "Command Prompt", task: "msbuild /t:Rebuild", state: "done" },
    { name: "Git Bash", task: "git rebase main", state: "waiting" },
  ];
  return (
    <AppWindow title="Kylo — Terminals" bodyClassName="grid sm:grid-cols-[180px_1fr]">
      <ul className="border-hairline p-2 max-sm:border-b sm:border-r">
        {sessions.map((s, i) => (
          <li
            key={s.name}
            className={cn("flex items-center gap-2 rounded-md px-2.5 py-2 text-[12px]", i === 1 ? "bg-elevated text-ink" : "text-muted")}
          >
            <SquareTerminal className="size-3.5 shrink-0" strokeWidth={1.5} />
            <span className="flex-1 truncate">{s.name}</span>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                s.state === "running" && "animate-pulse-soft bg-ink",
                s.state === "done" && "bg-body",
                s.state === "waiting" && "border border-body",
              )}
            />
          </li>
        ))}
      </ul>
      <div className="bg-canvas p-4">
        <div className="mb-3 flex items-center gap-2">
          <Chip active>WSL: Ubuntu</Chip>
          <Chip>pytest -q</Chip>
        </div>
        <TerminalLines
          shell="wsl"
          cursor
          lines={[
            { kind: "cmd", text: "pytest -q", cwd: "~/api" },
            { kind: "out", text: "........................................ [ 61%]" },
            { kind: "out", text: ".........................               [100%]" },
            { kind: "out", text: "65 passed in 4.12s", tone: "strong" },
          ]}
        />
      </div>
    </AppWindow>
  );
}

/* 03 — memory that outlives the session */
export function MemoryVisual() {
  const notes = [
    { k: "Project", v: "acme-web uses npm, Node 22, port 3000", when: "2 days ago" },
    { k: "Preference", v: "Run Windows tasks in PowerShell 7, Linux tasks in WSL", when: "1 week ago" },
    { k: "Workflow", v: "Before a release: typecheck, test, bump version, tag", when: "3 weeks ago" },
    { k: "Context", v: "Staging deploys go through the release/* branches", when: "1 month ago" },
  ];
  return (
    <AppWindow title="Kylo — Memory" bodyClassName="p-5 sm:p-6">
      <div className="flex items-center gap-2 rounded-lg border border-hairline bg-panel px-3 py-2 text-[12px] text-muted">
        <Search className="size-3.5" /> Search memory
        <span className="ml-auto font-mono text-[10px] text-faint">214 notes</span>
      </div>
      <ul className="mt-4 space-y-2">
        {notes.map((n, i) => (
          <motion.li
            key={n.v}
            initial={{ opacity: 0, x: 10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08, duration: 0.5 }}
            className="flex items-start gap-3 rounded-lg border border-hairline px-3 py-2.5"
          >
            <Brain className="mt-0.5 size-3.5 shrink-0 text-muted" strokeWidth={1.5} />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{n.k}</span>
              <span className="block text-[12.5px] text-ink">{n.v}</span>
            </span>
            <span className="shrink-0 text-[10.5px] text-faint max-sm:hidden">{n.when}</span>
          </motion.li>
        ))}
      </ul>
    </AppWindow>
  );
}

/* 04 — GitHub CLI */
export function GitHubVisual() {
  return (
    <AppWindow title="Kylo — acme-web" bodyClassName="grid">
      <div className="bg-canvas p-4">
        <TerminalLines
          lines={[
            { kind: "cmd", text: "git switch -c fix/login-redirect" },
            { kind: "out", text: "Switched to a new branch 'fix/login-redirect'", tone: "dim" },
            { kind: "cmd", text: 'git commit -am "Fix redirect loop after login"' },
            { kind: "out", text: "[fix/login-redirect 4c1e9a2] 2 files changed", tone: "dim" },
            { kind: "cmd", text: "gh pr create --fill --base main" },
            { kind: "out", text: "https://github.com/acme/acme-web/pull/128", tone: "strong" },
          ]}
        />
      </div>
      <div className="border-t border-hairline p-4">
        <div className="flex items-start gap-3 rounded-lg border border-hairline bg-panel p-3.5">
          <GitPullRequest className="mt-0.5 size-4 text-ink" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink">
              Fix redirect loop after login <span className="text-muted">#128</span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              <span className="flex items-center gap-1">
                <GitBranch className="size-3" /> fix/login-redirect → main
              </span>
              <span>Closes #121</span>
              <span className="flex items-center gap-1">
                <Check className="size-3" /> 3 checks passed
              </span>
            </p>
          </div>
          <Chip active>Open</Chip>
        </div>
      </div>
    </AppWindow>
  );
}

/* 05 — voice */
export function VoiceVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduce = useReducedMotion();
  const bars = 36;
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!inView || reduce) return;
    const id = window.setInterval(() => setPhase((p) => p + 1), 110);
    return () => window.clearInterval(id);
  }, [inView, reduce]);

  return (
    <div ref={ref}>
      <AppWindow title="Kylo — Voice" bodyClassName="flex flex-col items-center px-6 py-10 text-center">
        <span className="relative grid size-16 place-items-center rounded-full border border-hairline-strong bg-raised">
          <span className="absolute inset-0 animate-ping rounded-full border border-hairline-strong opacity-40" />
          <Mic className="size-6 text-ink" strokeWidth={1.5} />
        </span>
        <div className="mt-8 flex h-12 items-center gap-[3px]" aria-hidden>
          {Array.from({ length: bars }).map((_, i) => {
            const h = 0.2 + Math.abs(Math.sin(i * 0.55 + phase * 0.35) * Math.cos(i * 0.21 - phase * 0.18)) * 0.8;
            return (
              <span
                key={i}
                className="w-[3px] rounded-full bg-ink transition-[height] duration-100"
                style={{ height: `${h * 100}%`, opacity: 0.35 + h * 0.65 }}
              />
            );
          })}
        </div>
        <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Listening</p>
        <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-ink">
          “Open the API project in WSL and run the tests.”
        </p>
        <p className="mt-4 text-[12px] text-muted">Say your wake phrase or press the shortcut. Or just type.</p>
      </AppWindow>
    </div>
  );
}

/* 06 — bring your own provider */
export function ProvidersVisual() {
  const providers = [
    { name: "Anthropic", model: "Claude", set: true, active: true },
    { name: "OpenAI", model: "GPT", set: true },
    { name: "Google", model: "Gemini", set: false },
    { name: "OpenRouter", model: "Any routed model", set: false },
    { name: "Groq", model: "Hosted open models", set: false },
    { name: "Ollama", model: "Local · no key needed", set: true },
  ];
  return (
    <AppWindow title="Kylo — Settings · Providers" bodyClassName="p-2 sm:p-3">
      <ul>
        {providers.map((p, i) => (
          <li
            key={p.name}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5",
              p.active && "bg-elevated",
              i > 0 && !p.active && "border-t border-hairline-soft",
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md border border-hairline bg-panel font-mono text-[11px] text-ink">
              {p.name[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] text-ink">{p.name}</span>
              <span className="block truncate text-[11px] text-muted">{p.model}</span>
            </span>
            {p.set ? (
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-body">
                <KeyRound className="size-3" /> {p.name === "Ollama" ? "local" : "••••3f9a"}
              </span>
            ) : (
              <span className="rounded-full border border-hairline px-2.5 py-1 text-[10.5px] text-muted">Add key</span>
            )}
            {p.active ? <Chip active className="max-sm:hidden">Default</Chip> : null}
          </li>
        ))}
      </ul>
      <p className="px-3 pb-2 pt-3 text-[11px] text-faint">Keys are stored on this device and sent only to the provider you pick.</p>
    </AppWindow>
  );
}
