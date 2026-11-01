/**
 * The dedicated AI terminal: every command an agent runs through
 * `terminal_run` (dedicated mode), streamed live — header with shell and
 * working directory, the command, stdout, stderr in red, and the exit status.
 * Read-only on purpose: the AI's terminal never takes the user's keyboard,
 * and the user's terminals never receive the AI's commands unless they turned
 * sharing on. Every running command has a Stop button; "Stop AI" stops all of
 * them and denies pending approvals.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Square, OctagonX } from "lucide-react";
import { MINIMUM_CONTRAST_RATIO, themeFor } from "../agentic/terminalThemes";
import { FONT_DEFAULT } from "../agentic/paneFont";
import { useThemeValue } from "@/hooks/useTheme";
import { fill, useT } from "@/i18n";
import { TERMINAL_FONT_STACK } from "@/lib/terminalFont";
import { terminalsApi, type RunRecord } from "@/lib/kyloApi";
import { onRunEvent, useKyloStore } from "@/store/kylo";
import { cn } from "@/lib/utils";

const HISTORY_REPLAY = 8;

function header(run: RunRecord, aiLabel: string): string {
  const time = new Date(run.started_at * 1000).toLocaleTimeString();
  return `\r\n\x1b[36m── ${aiLabel} · ${run.shell_label} · ${run.cwd} · ${time}\x1b[0m\r\n\x1b[1;37m$ ${run.command.replace(/\n/g, "\r\n  ")}\x1b[0m\r\n`;
}

function footer(run: RunRecord, t: (k: string) => string): string {
  const secs = run.duration_s !== undefined ? ` · ${run.duration_s.toFixed(1)}s` : "";
  if (run.status === "succeeded") return `\x1b[32m✓ ${fill(t("kylo.agent.exit_code"), { code: 0 })}${secs}\x1b[0m\r\n`;
  if (run.status === "cancelled") return `\x1b[33m■ ${t("kylo.agent.cancelled")}${secs}\x1b[0m\r\n`;
  if (run.status === "timeout") return `\x1b[33m⧗ ${t("kylo.agent.timed_out")}${secs}\x1b[0m\r\n`;
  const why = run.error ? ` — ${run.error}` : "";
  return `\x1b[31m✗ ${fill(t("kylo.agent.exit_code"), { code: run.exit_code ?? "?" })}${secs}${why}\x1b[0m\r\n`;
}

export function AgentTerminalPanel({ active }: { active: boolean }) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const appearance = useThemeValue();
  const runs = useKyloStore((s) => s.runs);
  const running = useMemo(() => runs.filter((r) => r.status === "running" && r.owner === "agent"), [runs]);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      fontFamily: TERMINAL_FONT_STACK,
      fontSize: FONT_DEFAULT,
      lineHeight: 1.15,
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      scrollback: 20000,
      theme: themeFor(appearance),
      minimumContrastRatio: MINIMUM_CONTRAST_RATIO,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* measured later */
    }
    const ai = tRef.current("kylo.agent.ai_label");
    term.write(`\x1b[2m${tRef.current("kylo.agent.intro")}\x1b[0m\r\n`);

    let disposed = false;
    const seen = new Set<string>();
    const pending: Parameters<Parameters<typeof onRunEvent>[0]>[0][] = [];
    let replaying = true;

    const handle = (event: Parameters<Parameters<typeof onRunEvent>[0]>[0]) => {
      if (event.type === "run.started") {
        if (event.run.owner !== "agent") return;
        seen.add(event.run.id);
        term.write(header(event.run, ai));
      } else if (event.type === "run.output") {
        if (!seen.has(event.run_id)) return;
        term.write(event.stream === "stderr" ? `\x1b[31m${event.data}\x1b[0m` : event.data);
      } else if (event.type === "run.exit") {
        if (!seen.has(event.run.id)) return;
        term.write(footer(event.run, tRef.current));
      }
    };
    const unsubscribe = onRunEvent((event) => {
      if (replaying) pending.push(event);
      else handle(event);
    });

    // Replay the last few runs so the panel is not blank after a reload.
    void terminalsApi
      .runs(HISTORY_REPLAY, "agent")
      .then(async ({ runs: recent }) => {
        const ordered = [...recent].reverse();
        for (const run of ordered) {
          if (disposed) return;
          const out = await terminalsApi.run(run.id).catch(() => null);
          if (!out || disposed) continue;
          seen.add(run.id);
          term.write(header(out.run, ai));
          for (const chunk of out.chunks) {
            term.write(chunk.stream === "stderr" ? `\x1b[31m${chunk.data}\x1b[0m` : chunk.data);
          }
          if (out.run.status !== "running") term.write(footer(out.run, tRef.current));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        replaying = false;
        for (const event of pending.splice(0)) {
          if (event.type === "run.started" && seen.has(event.run.id)) continue;
          handle(event);
        }
      });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* hidden */
      }
    });
    ro.observe(container);
    return () => {
      disposed = true;
      unsubscribe();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // The terminal is created once; theme changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themeFor(appearance);
  }, [appearance]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* hidden */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const stopAll = async () => {
    setStopping(true);
    try {
      await terminalsApi.stopAgent();
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="kylo-agent-terminal">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className={cn("inline-flex h-2 w-2 rounded-full", running.length ? "animate-pulse bg-violet-500" : "bg-muted-foreground/40")} />
        <span className="text-muted-foreground">
          {running.length ? fill(t("kylo.agent.running_count"), { count: running.length }) : t("kylo.agent.idle")}
        </span>
        {running.map((run) => (
          <button
            key={run.id}
            type="button"
            title={run.command}
            onClick={() => void terminalsApi.cancelRun(run.id)}
            className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-accent"
          >
            <Square className="h-3 w-3 shrink-0 text-red-500" />
            <span className="truncate font-mono">{run.command}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => void stopAll()}
          disabled={stopping || running.length === 0}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-40"
          data-testid="kylo-stop-agent"
        >
          <OctagonX className="h-3.5 w-3.5" />
          {t("kylo.agent.stop_all")}
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden px-2 pt-1" />
    </div>
  );
}
