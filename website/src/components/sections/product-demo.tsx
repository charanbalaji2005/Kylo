"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Check, CornerDownLeft, FileCode2, FolderGit2, Globe, Package, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppWindow, Chip } from "../mockups/window";
import { TerminalLines, type TermLine } from "../mockups/terminal";
import { Section, SectionHeader } from "../ui/section";
import { EASE_OUT, Reveal } from "../ui/reveal";

const REQUEST = "Set up my project, install dependencies, and start the development server.";

const STEPS = [
  {
    title: "Understand the request",
    body: "Kylo reads what you asked, looks at the folder you're in, and works out what “set up” means for this project.",
  },
  {
    title: "Generate an execution plan",
    body: "It writes the plan out as plain steps with the exact commands, before anything runs.",
  },
  {
    title: "Select the appropriate terminal",
    body: "It picks the shell that fits the job, or uses the one you chose. You can always switch.",
  },
  {
    title: "Execute commands",
    body: "Commands run in a real terminal you can watch. Anything sensitive waits for your approval.",
  },
  {
    title: "Show results to the user",
    body: "You get a short summary of what changed and what's running, with the full output one click away.",
  },
];

export function ProductDemo() {
  const [active, setActive] = useState(0);

  return (
    <Section id="product">
      <SectionHeader
        eyebrow="How it works"
        title="From intention to execution."
        aside="One sentence in. A running project out."
        lede="Tell Kylo what you want in your own words. It turns that into a plan, runs it in the right terminal, and shows you exactly what happened."
      />

      <Reveal className="mt-14 md:mt-20">
        <PromptBar />
      </Reveal>

      <div className="mt-10 grid gap-10 lg:mt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <ol className="relative">
          <span aria-hidden className="absolute bottom-6 left-[15px] top-6 w-px bg-hairline" />
          {STEPS.map((step, i) => (
            <StepItem key={step.title} index={i} active={active === i} onActivate={() => setActive(i)} {...step} />
          ))}
        </ol>

        <div className="lg:sticky lg:top-28 lg:h-fit">
          <AppWindow title="Kylo — new-project" bodyClassName="relative h-[380px] overflow-hidden sm:h-[420px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                transition={{ duration: 0.45, ease: EASE_OUT }}
                className="absolute inset-0 p-5 sm:p-6"
              >
                {STAGES[active]}
              </motion.div>
            </AnimatePresence>
          </AppWindow>
          <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-muted">
            <span>
              Step {active + 1} of {STEPS.length}
            </span>
            <span className="flex gap-1.5" aria-hidden>
              {STEPS.map((_, i) => (
                <span key={i} className={cn("h-1 w-6 transition-colors duration-300", i <= active ? "bg-ink" : "bg-hairline")} />
              ))}
            </span>
          </div>
        </div>
      </div>
    </Section>
  );
}

function PromptBar() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const reduce = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setCount(REQUEST.length);
      return;
    }
    if (count >= REQUEST.length) return;
    const id = window.setTimeout(() => setCount((c) => c + 1), 28);
    return () => window.clearTimeout(id);
  }, [inView, count, reduce]);

  return (
    <div ref={ref} className="flex items-center gap-4 rounded-2xl border border-hairline bg-surface p-3 pl-5 sm:p-4 sm:pl-6">
      <span className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-faint sm:block">You</span>
      <p className="min-h-[1.5em] flex-1 text-[0.9375rem] text-ink md:text-lg" aria-label={REQUEST}>
        <span aria-hidden>
          {REQUEST.slice(0, count)}
          {count < REQUEST.length ? <span className="ml-0.5 inline-block h-[1.1em] w-px translate-y-[3px] animate-blink bg-ink" /> : null}
        </span>
      </p>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-canvas">
        <CornerDownLeft className="size-4" />
      </span>
    </div>
  );
}

function StepItem({
  index,
  title,
  body,
  active,
  onActivate,
}: {
  index: number;
  title: string;
  body: string;
  active: boolean;
  onActivate: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });

  useEffect(() => {
    if (inView) onActivate();
    // onActivate is a fresh closure each render; only the view change matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  return (
    <li ref={ref} className="relative pb-10 last:pb-0 lg:pb-24">
      <button
        type="button"
        onClick={onActivate}
        aria-current={active ? "step" : undefined}
        className={cn("group flex w-full gap-5 text-left transition-opacity duration-300", active ? "opacity-100" : "opacity-40 hover:opacity-70")}
      >
        <span
          className={cn(
            "relative z-10 grid size-8 shrink-0 place-items-center rounded-full border font-mono text-[11px] transition-colors duration-300",
            active ? "border-ink bg-ink text-canvas" : "border-hairline-strong bg-canvas text-body",
          )}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="pt-1">
          <span className="block text-lg font-medium tracking-[-0.01em] text-ink md:text-xl">{title}</span>
          <span className="mt-2 block max-w-md text-[0.9375rem] leading-relaxed text-body">{body}</span>
        </span>
      </button>
    </li>
  );
}

/* ---------- Stage visuals, one per step ---------- */

function StageLabel({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{children}</p>;
}

const UnderstandStage = (
  <div className="flex h-full flex-col gap-5">
    <StageLabel>Reading the request</StageLabel>
    <p className="text-[13px] leading-relaxed text-body">
      “<span className="text-ink">Set up</span> my project, <span className="text-ink">install dependencies</span>, and{" "}
      <span className="text-ink">start the development server</span>.”
    </p>
    <div className="grid gap-2 sm:grid-cols-2">
      {[
        { icon: FolderGit2, k: "Project", v: "C:\\dev\\new-project" },
        { icon: FileCode2, k: "Detected", v: "package.json · Next.js" },
        { icon: Package, k: "Package manager", v: "npm (package-lock.json)" },
        { icon: Globe, k: "Goal", v: "Dev server on a local port" },
      ].map(({ icon: Icon, k, v }, i) => (
        <motion.div
          key={k}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
          className="flex items-center gap-3 rounded-lg border border-hairline bg-panel px-3 py-2.5"
        >
          <Icon className="size-4 text-muted" strokeWidth={1.5} />
          <span className="min-w-0">
            <span className="block text-[10.5px] text-muted">{k}</span>
            <span className="block truncate font-mono text-[11.5px] text-ink">{v}</span>
          </span>
        </motion.div>
      ))}
    </div>
    <p className="mt-auto text-[12px] text-muted">No commands have run yet.</p>
  </div>
);

const PlanStage = (
  <div className="flex h-full flex-col gap-4">
    <StageLabel>Execution plan · 4 steps</StageLabel>
    <ol className="overflow-hidden rounded-lg border border-hairline">
      {[
        ["Check Node.js and npm", "node -v; npm -v"],
        ["Install dependencies", "npm install"],
        ["Copy environment template", "Copy-Item .env.example .env"],
        ["Start the development server", "npm run dev"],
      ].map(([title, cmd], i) => (
        <motion.li
          key={title}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 + i * 0.09, duration: 0.4 }}
          className={cn("flex flex-col gap-1 border-hairline px-4 py-3 sm:flex-row sm:items-center sm:gap-4", i > 0 && "border-t")}
        >
          <span className="font-mono text-[11px] text-faint">{i + 1}</span>
          <span className="flex-1 text-[13px] text-ink">{title}</span>
          <code className="font-mono text-[11px] text-muted">{cmd}</code>
        </motion.li>
      ))}
    </ol>
    <div className="mt-auto flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-canvas">Run plan</span>
      <span className="rounded-full border border-hairline px-3 py-1.5 text-[12px] text-body">Edit steps</span>
    </div>
  </div>
);

const ShellStage = (
  <div className="flex h-full flex-col gap-4">
    <StageLabel>Choosing a terminal</StageLabel>
    <div className="space-y-2">
      {[
        { name: "PowerShell 7", note: "Windows path, npm on PATH", chosen: true },
        { name: "WSL: Ubuntu", note: "Available, project is on the Windows drive" },
        { name: "Command Prompt", note: "Available" },
      ].map((s, i) => (
        <motion.div
          key={s.name}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.08, duration: 0.4 }}
          className={cn(
            "flex items-center gap-3 rounded-lg border px-4 py-3",
            s.chosen ? "border-hairline-strong bg-elevated" : "border-hairline bg-panel",
          )}
        >
          <SquareTerminal className={cn("size-4", s.chosen ? "text-ink" : "text-muted")} strokeWidth={1.5} />
          <span className="flex-1">
            <span className={cn("block text-[13px]", s.chosen ? "text-ink" : "text-body")}>{s.name}</span>
            <span className="block text-[11px] text-muted">{s.note}</span>
          </span>
          {s.chosen ? (
            <span className="grid size-5 place-items-center rounded-full bg-ink text-canvas">
              <Check className="size-3" strokeWidth={3} />
            </span>
          ) : (
            <span className="size-5 rounded-full border border-hairline-strong" />
          )}
        </motion.div>
      ))}
    </div>
    <p className="mt-auto text-[12px] text-muted">Prefer another shell? Pick it in the composer and Kylo adapts the commands.</p>
  </div>
);

const EXEC_LINES: TermLine[] = [
  { kind: "cmd", text: "node -v; npm -v" },
  { kind: "out", text: "v22.17.0" },
  { kind: "out", text: "10.9.2" },
  { kind: "cmd", text: "npm install" },
  { kind: "out", text: "added 389 packages in 14s" },
  { kind: "cmd", text: "Copy-Item .env.example .env" },
  { kind: "cmd", text: "npm run dev" },
  { kind: "out", text: "  ▲ Next.js 15.5.4", tone: "strong" },
  { kind: "out", text: "  - Local: http://localhost:3000" },
  { kind: "out", text: "  ✓ Ready in 2.1s", tone: "strong" },
];

function ExecuteStage() {
  const [n, setN] = useState(1);
  useEffect(() => {
    if (n >= EXEC_LINES.length) return;
    const id = window.setTimeout(() => setN((v) => v + 1), 260);
    return () => window.clearTimeout(id);
  }, [n]);
  return (
    <div className="-m-5 flex h-[calc(100%+2.5rem)] flex-col bg-canvas sm:-m-6 sm:h-[calc(100%+3rem)]">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <Chip active>
          <SquareTerminal className="size-3" /> PowerShell
        </Chip>
        <span className="ml-auto font-mono text-[10px] text-muted">{n >= EXEC_LINES.length ? "running" : "executing…"}</span>
      </div>
      <div className="flex-1 overflow-hidden p-4">
        <TerminalLines lines={EXEC_LINES.slice(0, n)} shell="powershell" cursor className="text-[11.5px]" />
      </div>
    </div>
  );
}

const ResultStage = (
  <div className="flex h-full flex-col gap-4">
    <StageLabel>Summary</StageLabel>
    <div className="rounded-lg border border-hairline bg-panel p-4">
      <p className="flex items-center gap-2 text-[13px] text-ink">
        <span className="grid size-5 place-items-center rounded-full bg-ink text-canvas">
          <Check className="size-3" strokeWidth={3} />
        </span>
        Project is set up and running
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-body">
        Installed 389 packages, created <code className="font-mono text-ink">.env</code> from the template, and started the
        dev server at <span className="text-ink underline decoration-hairline-strong underline-offset-4">localhost:3000</span>.
      </p>
    </div>
    <div className="grid grid-cols-3 gap-2">
      {[
        ["4", "commands"],
        ["0", "errors"],
        ["21s", "total"],
      ].map(([v, k]) => (
        <div key={k} className="rounded-lg border border-hairline px-3 py-3">
          <p className="text-xl font-medium tracking-tight text-ink">{v}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{k}</p>
        </div>
      ))}
    </div>
    <div className="mt-auto flex flex-wrap gap-2 text-[12px]">
      <span className="rounded-full border border-hairline px-3 py-1.5 text-body">View full output</span>
      <span className="rounded-full border border-hairline px-3 py-1.5 text-body">Stop server</span>
    </div>
  </div>
);

const STAGES: ReactNode[] = [UnderstandStage, PlanStage, ShellStage, <ExecuteStage key="exec" />, ResultStage];
