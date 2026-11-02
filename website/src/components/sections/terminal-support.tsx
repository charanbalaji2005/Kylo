"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import { TerminalLines, type Shell, type TermLine } from "../mockups/terminal";
import { Section, SectionHeader } from "../ui/section";
import { EASE_OUT, Reveal } from "../ui/reveal";

type Panel = {
  shell: Shell;
  name: string;
  meta: string;
  lines: TermLine[];
  /** Each shell gets its own chrome so the four read as different tools. */
  variant: "pwsh" | "cmd" | "linux" | "custom";
};

const PANELS: Panel[] = [
  {
    shell: "powershell",
    name: "PowerShell",
    meta: "pwsh 7.5",
    variant: "pwsh",
    lines: [
      { kind: "cmd", text: "Get-ChildItem -Filter *.log | Measure-Object" },
      { kind: "out", text: "Count    : 14", tone: "strong" },
      { kind: "out", text: "Property :", tone: "dim" },
      { kind: "cmd", text: "Get-Process node | Select Id, CPU" },
      { kind: "out", text: "   Id      CPU" },
      { kind: "out", text: "   --      ---", tone: "dim" },
      { kind: "out", text: "21844    3.42" },
    ],
  },
  {
    shell: "cmd",
    name: "Command Prompt",
    meta: "cmd.exe",
    variant: "cmd",
    lines: [
      { kind: "cmd", text: "dir /b build" },
      { kind: "out", text: "app.exe" },
      { kind: "out", text: "config.ini" },
      { kind: "out", text: "resources" },
      { kind: "cmd", text: "ipconfig | findstr IPv4" },
      { kind: "out", text: "   IPv4 Address. . . : 192.168.1.24" },
    ],
  },
  {
    shell: "wsl",
    name: "WSL / Linux",
    meta: "Ubuntu 24.04 · bash",
    variant: "linux",
    lines: [
      { kind: "cmd", text: "df -h / | tail -1", cwd: "~/api" },
      { kind: "out", text: "/dev/sdc  1007G   48G  908G   5% /" },
      { kind: "cmd", text: "docker compose up -d", cwd: "~/api" },
      { kind: "out", text: "✓ Container api-db-1   Started", tone: "strong" },
      { kind: "out", text: "✓ Container api-web-1  Started", tone: "strong" },
    ],
  },
  {
    shell: "custom",
    name: "Your terminal",
    meta: "Git Bash · Nushell · any shell path",
    variant: "custom",
    lines: [
      { kind: "out", text: "# terminal profile", tone: "dim" },
      { kind: "out", text: "name  Git Bash" },
      { kind: "out", text: "path  C:\\Program Files\\Git\\bin\\bash.exe" },
      { kind: "blank" },
      { kind: "cmd", text: "git log --oneline -3" },
      { kind: "out", text: "8d04e7b Add search to settings" },
    ],
  },
];

const MODES = [
  {
    id: "ai",
    icon: Bot,
    label: "AI-assisted",
    title: "Kylo drives, you approve.",
    body: "Describe the outcome. Kylo writes the commands, runs them in the shell you picked, and pauses on anything that changes your system.",
  },
  {
    id: "manual",
    icon: Hand,
    label: "Manual control",
    title: "You type, Kylo watches your back.",
    body: "Use the same terminals by hand whenever you want. Kylo keeps the session and its output in context, ready when you ask for help.",
  },
] as const;

export function TerminalSupport() {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("ai");
  const current = MODES.find((m) => m.id === mode)!;

  return (
    <Section id="terminals">
      <SectionHeader
        eyebrow="Terminals"
        title="Every terminal."
        aside="One intelligent agent."
        lede="Kylo works in the shells already on your machine. Each task runs in a real terminal session you can open, read, and take over."
      />

      <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:mt-20 md:grid-cols-2">
        {PANELS.map((p, i) => (
          <Reveal key={p.name} delay={i * 0.08} y={16} className="bg-canvas">
            <TerminalPanel panel={p} />
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-16 grid gap-8 md:mt-20 md:grid-cols-[auto_1fr] md:items-center md:gap-14">
        <div role="tablist" aria-label="Execution mode" className="inline-flex w-full rounded-full border border-hairline bg-surface p-1 md:w-auto">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              type="button"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors md:flex-none",
                mode === m.id ? "text-canvas" : "text-body hover:text-ink",
              )}
            >
              {mode === m.id ? (
                <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-full bg-ink" transition={{ duration: 0.4, ease: EASE_OUT }} />
              ) : null}
              <m.icon className="relative size-4" strokeWidth={1.75} />
              <span className="relative">{m.label}</span>
            </button>
          ))}
        </div>
        <div className="min-h-[6.5rem]">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-xl font-medium tracking-[-0.015em] text-ink">{current.title}</p>
              <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-body">{current.body}</p>
            </motion.div>
          </AnimatePresence>
        </div>
      </Reveal>
    </Section>
  );
}

function TerminalPanel({ panel }: { panel: Panel }) {
  const header = {
    pwsh: (
      <div className="flex items-center gap-2 border-b border-hairline bg-panel px-4 py-2.5">
        <span className="grid size-5 place-items-center rounded-[4px] bg-ink font-mono text-[9px] font-bold text-canvas">&gt;_</span>
        <span className="text-[12px] text-ink">{panel.name}</span>
        <span className="ml-auto font-mono text-[10px] text-muted">{panel.meta}</span>
      </div>
    ),
    cmd: (
      <div className="flex items-center gap-2 border-b border-hairline bg-canvas px-4 py-2.5">
        <span className="grid size-5 place-items-center border border-hairline-strong font-mono text-[9px] text-ink">C:\</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink">{panel.name}</span>
        <span className="ml-auto font-mono text-[10px] text-muted">{panel.meta}</span>
      </div>
    ),
    linux: (
      <div className="flex items-center gap-2 border-b border-hairline bg-raised px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full border border-hairline-strong" />
          <span className="size-2.5 rounded-full border border-hairline-strong" />
          <span className="size-2.5 rounded-full border border-hairline-strong" />
        </span>
        <span className="mx-auto font-mono text-[11px] text-body">dev@ubuntu: ~/api</span>
        <span className="font-mono text-[10px] text-muted max-sm:hidden">{panel.meta}</span>
      </div>
    ),
    custom: (
      <div className="flex items-center gap-2 border-b border-dashed border-hairline-strong bg-canvas px-4 py-2.5">
        <span className="grid size-5 place-items-center rounded-full border border-dashed border-body font-mono text-[10px] text-ink">+</span>
        <span className="text-[12px] text-ink">{panel.name}</span>
        <span className="ml-auto truncate font-mono text-[10px] text-muted">{panel.meta}</span>
      </div>
    ),
  }[panel.variant];

  return (
    <div className="group flex h-full flex-col transition-colors duration-300 hover:bg-surface">
      {header}
      <div className="min-h-[190px] flex-1 px-4 py-4">
        <TerminalLines lines={panel.lines} shell={panel.shell} cursor={panel.variant === "linux"} />
      </div>
    </div>
  );
}
