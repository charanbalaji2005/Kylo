"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  Brain,
  Check,
  ChevronDown,
  Clock3,
  FolderGit2,
  History,
  Loader2,
  MessageSquare,
  Mic,
  Plus,
  Settings,
  ShieldCheck,
  SquareTerminal,
  ArrowUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KyloMark } from "../kylo-logo";
import { AppWindow, Chip } from "./window";
import { TerminalLines, type TermLine } from "./terminal";

const PROMPT = "Pull the latest changes, install dependencies, and start the dev server.";

const STEPS = [
  { title: "Pull the latest changes", command: "git pull --rebase" },
  { title: "Install dependencies", command: "npm install", approval: true },
  { title: "Check types", command: "npm run typecheck" },
  { title: "Start the dev server", command: "npm run dev" },
] as const;

type Beat = { step: number; line?: TermLine; approval?: "waiting" | "allowed" };

/** The scripted run, one beat per tick. */
const BEATS: Beat[] = [
  { step: 0, line: { kind: "cmd", text: "git pull --rebase" } },
  { step: 0, line: { kind: "out", text: "Updating 3f2a91c..8d04e7b" } },
  { step: 0, line: { kind: "out", text: "Fast-forward" } },
  { step: 0, line: { kind: "out", text: " src/app/page.tsx   | 24 ++++++-----", tone: "dim" } },
  { step: 0, line: { kind: "out", text: " 3 files changed, 41 insertions(+), 12 deletions(-)", tone: "dim" } },
  { step: 1, approval: "waiting" },
  { step: 1, approval: "waiting" },
  { step: 1, approval: "allowed" },
  { step: 1, line: { kind: "blank" } },
  { step: 1, line: { kind: "cmd", text: "npm install" } },
  { step: 1, line: { kind: "out", text: "added 412 packages, audited 413 packages in 18s" } },
  { step: 1, line: { kind: "out", text: "found 0 vulnerabilities", tone: "dim" } },
  { step: 2, line: { kind: "blank" } },
  { step: 2, line: { kind: "cmd", text: "npm run typecheck" } },
  { step: 2, line: { kind: "out", text: "> tsc --noEmit", tone: "dim" } },
  { step: 2, line: { kind: "out", text: "✓ No type errors in 128 files", tone: "strong" } },
  { step: 3, line: { kind: "blank" } },
  { step: 3, line: { kind: "cmd", text: "npm run dev" } },
  { step: 3, line: { kind: "out", text: "▲ Next.js 15.5.4", tone: "strong" } },
  { step: 3, line: { kind: "out", text: "  - Local:    http://localhost:3000" } },
  { step: 3, line: { kind: "out", text: "  - Network:  http://192.168.1.24:3000", tone: "dim" } },
  { step: 3, line: { kind: "out", text: "✓ Ready in 1.8s", tone: "strong" } },
];

const TICK_MS = 620;
const HOLD_MS = 5200;

type StepState = "pending" | "running" | "done";

function useRunScript(active: boolean, reduce: boolean | null) {
  const [beat, setBeat] = useState(reduce ? BEATS.length : 0);

  useEffect(() => {
    if (reduce) {
      setBeat(BEATS.length);
      return;
    }
    if (!active) return;
    const delay = beat === 0 ? 1400 : beat >= BEATS.length ? HOLD_MS : TICK_MS;
    const id = window.setTimeout(() => setBeat((b) => (b >= BEATS.length ? 0 : b + 1)), delay);
    return () => window.clearTimeout(id);
  }, [beat, active, reduce]);

  return beat;
}

export function HeroApp() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const beat = useRunScript(inView, reduce);
  const shown = BEATS.slice(0, beat);
  const finished = beat >= BEATS.length;

  const lines = shown.flatMap((b) => (b.line ? [b.line] : []));
  const currentStep = shown.length ? shown[shown.length - 1].step : -1;
  const approvalBeats = shown.filter((b) => b.approval);
  const approval = approvalBeats.length ? approvalBeats[approvalBeats.length - 1].approval : undefined;

  const stepState = (i: number): StepState => {
    if (finished) return i === STEPS.length - 1 ? "running" : "done";
    if (i < currentStep) return "done";
    if (i === currentStep) return "running";
    return "pending";
  };

  const termRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [beat]);

  return (
    <div ref={ref}>
      <AppWindow title="Kylo — acme-web" bodyClassName="flex h-[560px] max-md:h-auto max-md:flex-col">
        <Sidebar />

        {/* Conversation */}
        <div className="flex min-w-0 flex-1 flex-col border-hairline md:border-r">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-hairline px-4">
            <div className="flex min-w-0 items-center gap-2 text-[12px]">
              <span className="truncate font-medium text-ink">Get acme-web running</span>
              <Chip className="max-sm:hidden">
                <FolderGit2 className="size-3" /> C:\dev\acme-web
              </Chip>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className={cn("size-1.5 rounded-full bg-ink", !finished && "animate-pulse-soft")} />
              {finished ? "Server running" : "Working"}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-5 text-[12.5px] leading-relaxed">
            {/* User message */}
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-hairline bg-elevated px-3.5 py-2.5 text-ink">
              {PROMPT}
            </div>

            {/* Kylo reply */}
            <div className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-hairline bg-raised">
                <KyloMark className="size-3.5 text-ink" />
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-body">
                  Here&apos;s the plan. I&apos;ll run it in <span className="text-ink">PowerShell</span> inside the
                  project folder.
                </p>
                <ol className="overflow-hidden rounded-lg border border-hairline">
                  {STEPS.map((s, i) => {
                    const state = stepState(i);
                    return (
                      <li
                        key={s.title}
                        className={cn(
                          "flex items-center gap-3 border-hairline px-3 py-2 transition-colors duration-300",
                          i > 0 && "border-t",
                          state === "running" && "bg-white/[0.03]",
                        )}
                      >
                        <StepIcon state={state} />
                        <span className={cn("flex-1 truncate", state === "pending" ? "text-muted" : "text-ink")}>
                          {s.title}
                        </span>
                        <code className="hidden font-mono text-[10.5px] text-muted sm:block">{s.command}</code>
                      </li>
                    );
                  })}
                </ol>

                <AnimatePresence>
                  {approval ? (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-3 rounded-lg border border-hairline bg-raised px-3 py-2.5"
                    >
                      <ShieldCheck className="size-4 shrink-0 text-ink" strokeWidth={1.5} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-ink">
                          Run <code className="font-mono text-[11px]">npm install</code>?
                        </p>
                        <p className="text-[11px] text-muted">Writes to node_modules and package-lock.json</p>
                      </div>
                      {approval === "waiting" ? (
                        <div className="flex gap-1.5">
                          <span className="rounded-full border border-hairline px-2.5 py-1 text-[11px] text-body">Deny</span>
                          <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-canvas">
                            Allow once
                          </span>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-body">
                          <Check className="size-3" /> Allowed
                        </span>
                      )}
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                <AnimatePresence>
                  {finished ? (
                    <motion.p
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-body"
                    >
                      Done. Your dev server is live at{" "}
                      <span className="text-ink underline decoration-hairline-strong underline-offset-4">
                        localhost:3000
                      </span>
                      . 412 packages installed, no type errors.
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <Composer />
        </div>

        {/* Terminal */}
        <div className="flex min-w-0 flex-col bg-canvas max-md:h-[300px] max-md:border-t max-md:border-hairline md:w-[44%]">
          <div className="flex h-11 shrink-0 items-end gap-0.5 border-b border-hairline px-2 text-[11px]">
            {["PowerShell", "WSL: Ubuntu", "Command Prompt"].map((tab, i) => (
              <span
                key={tab}
                className={cn(
                  "flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-2 whitespace-nowrap",
                  i === 0 ? "border-hairline bg-surface text-ink" : "border-transparent text-muted",
                  i === 2 && "max-lg:hidden",
                )}
              >
                <SquareTerminal className="size-3" strokeWidth={1.5} />
                {tab}
              </span>
            ))}
            <span className="grid size-7 place-items-center self-center text-muted">
              <Plus className="size-3.5" />
            </span>
          </div>
          <div ref={termRef} className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-2 font-mono text-[10.5px] text-faint">PowerShell 7.5.2 · C:\dev\acme-web</p>
            <TerminalLines lines={lines} cursor />
          </div>
          <div className="flex h-8 shrink-0 items-center justify-between border-t border-hairline px-3 font-mono text-[10px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full bg-ink", !finished && "animate-pulse-soft")} />
              {currentStep >= 0 ? STEPS[Math.min(currentStep, STEPS.length - 1)].command : "idle"}
            </span>
            <span>{finished ? "listening :3000" : `step ${Math.max(currentStep + 1, 1)}/${STEPS.length}`}</span>
          </div>
        </div>
      </AppWindow>
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done")
    return (
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-ink text-canvas">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  if (state === "running") return <Loader2 className="size-4 shrink-0 animate-spin text-ink" strokeWidth={1.75} />;
  return <span className="size-4 shrink-0 rounded-full border border-hairline-strong" />;
}

function Sidebar() {
  const nav = [
    { icon: MessageSquare, label: "Chat", active: true },
    { icon: SquareTerminal, label: "Terminals" },
    { icon: Brain, label: "Memory" },
    { icon: History, label: "History" },
    { icon: Settings, label: "Settings" },
  ];
  const recent = ["Get acme-web running", "Fix failing auth tests", "Draft v0.4 release notes", "Clean up Downloads"];
  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-hairline bg-panel lg:flex">
      <div className="p-3">
        <div className="flex h-8 items-center gap-2 rounded-md border border-hairline bg-raised px-2.5 text-[12px] text-ink">
          <Plus className="size-3.5" /> New task
          <kbd className="ml-auto font-mono text-[10px] text-faint">Ctrl N</kbd>
        </div>
      </div>
      <nav className="space-y-0.5 px-2 text-[12px]">
        {nav.map(({ icon: Icon, label, active }) => (
          <div
            key={label}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5",
              active ? "bg-elevated text-ink" : "text-muted",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.5} />
            {label}
          </div>
        ))}
      </nav>
      <p className="mt-6 px-5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">Recent</p>
      <div className="mt-2 space-y-0.5 px-2 text-[12px]">
        {recent.map((r, i) => (
          <div key={r} className={cn("truncate rounded-md px-2.5 py-1.5", i === 0 ? "text-ink" : "text-muted")}>
            {r}
          </div>
        ))}
      </div>
      <div className="mt-auto border-t border-hairline p-3">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <Clock3 className="size-3.5" strokeWidth={1.5} />
          Memory synced · 214 notes
        </div>
      </div>
    </aside>
  );
}

function Composer() {
  return (
    <div className="shrink-0 border-t border-hairline p-3">
      <div className="rounded-xl border border-hairline bg-panel">
        <p className="px-3 pt-2.5 text-[12px] text-faint">Ask Kylo to do something…</p>
        <div className="flex items-center gap-1.5 px-2 pb-2 pt-3">
          <Chip active>
            <SquareTerminal className="size-3" /> PowerShell <ChevronDown className="size-2.5" />
          </Chip>
          <Chip className="max-sm:hidden">Ask before running</Chip>
          <span className="ml-auto grid size-7 place-items-center rounded-full text-muted">
            <Mic className="size-3.5" />
          </span>
          <span className="grid size-7 place-items-center rounded-full bg-ink text-canvas">
            <ArrowUp className="size-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
}
