/**
 * Kylo's integrated Terminal — the user's shells and the AI's terminal in one
 * place, like the panel of a code editor.
 *
 * * Tabs: every interactive session (PowerShell, CMD, WSL distributions, Git
 *   Bash, custom profiles) with a You / AI badge, rename on double-click,
 *   close; plus the dedicated **AI terminal** and the **History** of commands.
 * * New Terminal (profile menu), Split right / down, Clear, Find, Run
 *   Selection, Send Command, Stop AI.
 * * The workspace agents operate in is chosen here (and in Setup).
 * * Shells live in the backend, so leaving this view or reloading the window
 *   never kills them; after a restart the previous terminals are reopened.
 *
 * Keys: Ctrl+Shift+` new terminal · Ctrl+Shift+5 split · Ctrl+F find ·
 * Ctrl+Shift+C / Ctrl+V copy / paste.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  Columns2,
  Eraser,
  FolderOpen,
  History,
  Play,
  Plus,
  Rows2,
  Search,
  Send,
  Settings2,
  SquareTerminal,
  X,
} from "lucide-react";
import { fill, useLocaleChunk, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useEventStore } from "@/store/events";
import { useKyloEventsConnection, useKyloStore } from "@/store/kylo";
import {
  pickFolder,
  terminalsApi,
  type RunOutput,
  type RunRecord,
  type TerminalProfile,
  type TerminalSession,
} from "@/lib/kyloApi";
import { KyloTerminalPane, type KyloTerminalHandle } from "@/components/kylo/KyloTerminalPane";
import { AgentTerminalPanel } from "@/components/kylo/AgentTerminalPanel";

const AGENT_TAB = "__agent__";
const HISTORY_TAB = "__history__";
type Split = { direction: "row" | "column"; second: string } | null;

function ProfileMenu({
  profiles,
  defaultId,
  onPick,
  onClose,
}: {
  profiles: TerminalProfile[];
  defaultId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const away = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) onClose();
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-xl">
      {profiles.map((p) => (
        <button
          key={p.id}
          role="menuitem"
          type="button"
          onClick={() => onPick(p.id)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
        >
          <SquareTerminal className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{p.label}</span>
          {p.id === defaultId && <span className="ml-auto text-xs text-muted-foreground">{t("kylo.terminal.default")}</span>}
        </button>
      ))}
      {profiles.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">{t("kylo.terminal.no_shells")}</div>}
    </div>
  );
}

function OwnerBadge({ owner }: { owner: "user" | "agent" }) {
  const t = useT();
  return (
    <span
      className={cn(
        "rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide",
        owner === "agent" ? "bg-violet-500/15 text-violet-600 dark:text-violet-300" : "bg-sky-500/15 text-sky-600 dark:text-sky-300",
      )}
    >
      {owner === "agent" ? t("kylo.terminal.owner_ai") : t("kylo.terminal.owner_you")}
    </span>
  );
}

function SessionTab({
  session,
  active,
  onSelect,
  onClose,
  onRename,
}: {
  session: TerminalSession;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);
  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid="kylo-terminal-tab"
      onClick={onSelect}
      onDoubleClick={() => {
        setDraft(session.name);
        setEditing(true);
      }}
      className={cn(
        "group flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2.5 text-sm",
        active ? "border-primary bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      title={`${session.profile_label}${session.cwd ? ` · ${session.cwd}` : ""}`}
    >
      <SquareTerminal className={cn("h-3.5 w-3.5", session.status === "exited" && "opacity-40")} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={60}
          aria-label={t("kylo.terminal.rename")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() && draft !== session.name) onRename(draft.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-28 rounded border border-border bg-background px-1 text-sm"
        />
      ) : (
        <span className={cn("max-w-[10rem] truncate", session.status === "exited" && "line-through opacity-60")}>{session.name}</span>
      )}
      <OwnerBadge owner={session.owner} />
      {session.agent_busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" title={t("kylo.terminal.ai_busy")} />}
      <button
        type="button"
        aria-label={t("kylo.terminal.close")}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="rounded p-0.5 opacity-50 hover:bg-muted hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function RunHistory() {
  const t = useT();
  const live = useKyloStore((s) => s.runs);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [output, setOutput] = useState<RunOutput | null>(null);
  const load = useCallback(() => {
    void terminalsApi.runs(200).then((r) => setRuns(r.runs)).catch(() => undefined);
  }, []);
  useEffect(load, [load, live]);
  useEffect(() => {
    if (!open) return setOutput(null);
    void terminalsApi.run(open).then(setOutput).catch(() => setOutput(null));
  }, [open]);
  const tone = (s: RunRecord["status"]) =>
    s === "succeeded" ? "text-emerald-600 dark:text-emerald-400" : s === "running" ? "text-violet-500" : s === "cancelled" || s === "timeout" ? "text-amber-500" : "text-red-500";
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="kylo-run-history">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>{fill(t("kylo.history.count"), { count: runs.length })}</span>
        <button type="button" onClick={load} className="ml-auto rounded px-2 py-0.5 hover:bg-accent">
          {t("kylo.history.refresh")}
        </button>
        <button
          type="button"
          onClick={() => void terminalsApi.clearRuns().then(load)}
          className="rounded px-2 py-0.5 hover:bg-accent"
        >
          {t("kylo.history.clear")}
        </button>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-auto text-sm">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => setOpen(open === run.id ? null : run.id)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50"
            >
              <span className={cn("w-20 shrink-0 text-xs font-medium", tone(run.status))}>
                {t(`kylo.status.${run.status}`)}
                {run.exit_code !== null && run.status !== "running" ? ` (${run.exit_code})` : ""}
              </span>
              <OwnerBadge owner={run.owner} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{run.command}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{run.shell_label}</span>
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
                {new Date(run.started_at * 1000).toLocaleTimeString()}
              </span>
            </button>
            {open === run.id && (
              <div className="bg-muted/30 px-3 pb-3">
                <div className="py-1 text-xs text-muted-foreground">
                  {run.cwd}
                  {run.final_cwd && run.final_cwd !== run.cwd ? ` → ${run.final_cwd}` : ""}
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-background p-2 font-mono text-xs">
                  {output ? output.stdout || "" : t("kylo.history.loading")}
                  {output?.stderr ? <span className="text-red-500">{`\n${output.stderr}`}</span> : null}
                </pre>
              </div>
            )}
          </li>
        ))}
        {runs.length === 0 && <li className="px-3 py-8 text-center text-muted-foreground">{t("kylo.history.empty")}</li>}
      </ul>
    </div>
  );
}

export function KyloTerminalView() {
  useLocaleChunk("kylo");
  useKyloEventsConnection();
  const t = useT();
  const sessions = useKyloStore((s) => s.sessions);
  const workspace = useKyloStore((s) => s.workspace);
  const connected = useKyloStore((s) => s.connected);
  const setActiveSection = useEventStore((s) => s.setActiveSection);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [defaultProfile, setDefaultProfile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [split, setSplit] = useState<Split>(null);
  const [focusedPane, setFocusedPane] = useState<"primary" | "secondary">("primary");
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const primaryRef = useRef<KyloTerminalHandle | null>(null);
  const secondaryRef = useRef<KyloTerminalHandle | null>(null);
  const bootstrapped = useRef(false);

  const userSessions = useMemo(() => sessions, [sessions]);
  const sessionIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions]);
  const isSessionTab = (id: string | null): id is string => !!id && sessionIds.has(id);

  const focusedSessionId = focusedPane === "secondary" && split ? split.second : isSessionTab(activeTab) ? activeTab : null;
  const focusedHandle = () => (focusedPane === "secondary" && split ? secondaryRef.current : primaryRef.current);

  const openTerminal = useCallback(
    async (profileId?: string | null, asSplit?: "row" | "column") => {
      setMenu(false);
      setError(null);
      try {
        const session = await terminalsApi.create({ profile_id: profileId ?? null, cwd: null });
        useKyloStore.setState((s) => ({ sessions: s.sessions.some((x) => x.id === session.id) ? s.sessions : [...s.sessions, session] }));
        if (asSplit && isSessionTab(activeTab)) {
          setSplit({ direction: asSplit, second: session.id });
          setFocusedPane("secondary");
        } else {
          setActiveTab(session.id);
          setFocusedPane("primary");
        }
        void terminalsApi.setActive(session.id).catch(() => undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab, sessionIds],
  );

  // Profiles, then the sessions: reattach to running ones, else restore the last layout, else open one.
  useEffect(() => {
    void terminalsApi
      .profiles()
      .then((p) => {
        setProfiles(p.profiles);
        setDefaultProfile(p.default_profile);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void terminalsApi
      .sessions()
      .then(async (s) => {
        useKyloStore.setState({ sessions: s.sessions });
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        if (s.sessions.length) {
          setActiveTab(s.active ?? s.sessions[0].id);
        } else if (s.restorable > 0) {
          const restored = await terminalsApi.restore();
          useKyloStore.setState({ sessions: restored.sessions });
          if (restored.sessions[0]) setActiveTab(restored.sessions[0].id);
          else void openTerminal();
        } else {
          void openTerminal();
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void terminalsApi.workspace().then((w) => useKyloStore.setState({ workspace: w.workspace })).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the active tab valid when sessions close elsewhere.
  useEffect(() => {
    if (activeTab === AGENT_TAB || activeTab === HISTORY_TAB) return;
    if (activeTab && !sessionIds.has(activeTab)) setActiveTab(sessions[0]?.id ?? AGENT_TAB);
    if (split && !sessionIds.has(split.second)) setSplit(null);
  }, [activeTab, sessionIds, sessions, split]);

  useEffect(() => {
    if (isSessionTab(activeTab)) {
      const s = sessions.find((x) => x.id === activeTab);
      if (s?.owner === "user") void terminalsApi.setActive(activeTab).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const closeSession = async (id: string) => {
    await terminalsApi.close(id).catch(() => undefined);
    useKyloStore.setState((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
    if (split?.second === id) setSplit(null);
    if (activeTab === id) {
      const rest = sessions.filter((x) => x.id !== id);
      if (split && split.second !== id) {
        setActiveTab(split.second);
        setSplit(null);
      } else setActiveTab(rest[0]?.id ?? AGENT_TAB);
    }
  };

  const chooseWorkspace = async () => {
    const folder = await pickFolder(t("kylo.workspace.pick_title"));
    if (!folder) return;
    try {
      const res = await terminalsApi.setWorkspace(folder);
      useKyloStore.setState({ workspace: res.workspace });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendCommand = async (text: string, execute: boolean) => {
    if (!text.trim() || !focusedSessionId) return;
    try {
      await terminalsApi.input(focusedSessionId, text, execute);
      focusedHandle()?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runSelection = () => {
    const fromTerminal = focusedHandle()?.selection() ?? "";
    const fromPage = window.getSelection()?.toString() ?? "";
    void sendCommand(fromTerminal || fromPage, true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && (e.code === "Backquote" || e.key === "~")) {
      e.preventDefault();
      void openTerminal(defaultProfile);
    } else if (e.ctrlKey && e.shiftKey && e.code === "Digit5") {
      e.preventDefault();
      void openTerminal(defaultProfile, "row");
    } else if (e.key === "Escape" && searchOpen) {
      setSearchOpen(false);
      focusedHandle()?.clearSearch();
    }
  };

  const primarySession = isSessionTab(activeTab) ? activeTab : null;
  const showSplit = !!(split && primarySession && split.second !== primarySession);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" onKeyDown={onKeyDown} data-testid="kylo-terminal-view">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => void chooseWorkspace()}
          className="mr-2 flex min-w-0 max-w-[22rem] items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-sm hover:bg-accent"
          title={workspace ?? t("kylo.workspace.none")}
          data-testid="kylo-workspace-button"
        >
          <img src="/kylo-mark-256.png" alt="Kylo" className="h-4 w-4 shrink-0 object-contain" />
          <span className="truncate">{workspace ?? t("kylo.workspace.choose")}</span>
        </button>
        <div className="relative flex">
          <button
            type="button"
            onClick={() => void openTerminal(defaultProfile)}
            className="flex items-center gap-1 rounded-l-lg bg-primary px-2.5 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            title={t("kylo.terminal.new_hint")}
            data-testid="kylo-new-terminal"
          >
            <Plus className="h-4 w-4" />
            {t("kylo.terminal.new")}
          </button>
          <button
            type="button"
            aria-label={t("kylo.terminal.choose_shell")}
            onClick={() => setMenu((m) => !m)}
            className="rounded-r-lg border-l border-primary-foreground/20 bg-primary px-1.5 text-primary-foreground hover:bg-primary/90"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          {menu && <ProfileMenu profiles={profiles} defaultId={defaultProfile} onPick={(id) => void openTerminal(id)} onClose={() => setMenu(false)} />}
        </div>
        <ToolButton icon={Columns2} label={t("kylo.terminal.split_right")} disabled={!primarySession} onClick={() => void openTerminal(defaultProfile, "row")} />
        <ToolButton icon={Rows2} label={t("kylo.terminal.split_down")} disabled={!primarySession} onClick={() => void openTerminal(defaultProfile, "column")} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolButton
          icon={Search}
          label={t("kylo.terminal.find")}
          disabled={!focusedSessionId}
          onClick={() => setSearchOpen((v) => !v)}
        />
        <ToolButton
          icon={Eraser}
          label={t("kylo.terminal.clear")}
          disabled={!focusedSessionId}
          onClick={() => {
            focusedHandle()?.clear();
            if (focusedSessionId) void terminalsApi.clear(focusedSessionId);
          }}
        />
        <ToolButton icon={Play} label={t("kylo.terminal.run_selection")} disabled={!focusedSessionId} onClick={runSelection} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolButton icon={Settings2} label={t("kylo.terminal.settings")} onClick={() => setActiveSection("kylo-setup")} />
        <span
          className={cn("ml-auto inline-flex items-center gap-1.5 text-xs", connected ? "text-muted-foreground" : "text-amber-500")}
          title={connected ? t("kylo.terminal.connected") : t("kylo.terminal.reconnecting")}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-500" : "bg-amber-500")} />
          {connected ? t("kylo.terminal.connected") : t("kylo.terminal.reconnecting")}
        </span>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex items-end gap-0.5 overflow-x-auto border-b border-border px-2 pt-1">
        {userSessions.map((s) => (
          <SessionTab
            key={s.id}
            session={s}
            active={activeTab === s.id || split?.second === s.id}
            onSelect={() => {
              if (split?.second === s.id) setFocusedPane("secondary");
              else {
                setActiveTab(s.id);
                setFocusedPane("primary");
              }
            }}
            onClose={() => void closeSession(s.id)}
            onRename={(name) => void terminalsApi.rename(s.id, name).catch((e) => setError(String(e)))}
          />
        ))}
        <span className="mx-1 mb-1.5 h-5 w-px bg-border" />
        <SpecialTab icon={Bot} label={t("kylo.agent.tab")} active={activeTab === AGENT_TAB} onClick={() => setActiveTab(AGENT_TAB)} testId="kylo-agent-tab" />
        <SpecialTab icon={History} label={t("kylo.history.tab")} active={activeTab === HISTORY_TAB} onClick={() => setActiveTab(HISTORY_TAB)} testId="kylo-history-tab" />
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-600 dark:text-red-400">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" aria-label={t("kylo.common.dismiss")} onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {searchOpen && focusedSessionId && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            placeholder={t("kylo.terminal.find_placeholder")}
            aria-label={t("kylo.terminal.find")}
            onChange={(e) => {
              setQuery(e.target.value);
              focusedHandle()?.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.shiftKey) focusedHandle()?.findPrevious(query);
                else focusedHandle()?.findNext(query);
              }
              if (e.key === "Escape") {
                setSearchOpen(false);
                focusedHandle()?.clearSearch();
                focusedHandle()?.focus();
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
          />
          <button type="button" className="rounded px-2 py-0.5 text-xs hover:bg-accent" onClick={() => focusedHandle()?.findPrevious(query)}>
            {t("kylo.terminal.find_prev")}
          </button>
          <button type="button" className="rounded px-2 py-0.5 text-xs hover:bg-accent" onClick={() => focusedHandle()?.findNext(query)}>
            {t("kylo.terminal.find_next")}
          </button>
        </div>
      )}

      {/* Panes */}
      <div className="relative min-h-0 flex-1">
        <div className={cn("absolute inset-0", activeTab === AGENT_TAB ? "block" : "hidden")}>
          <AgentTerminalPanel active={activeTab === AGENT_TAB} />
        </div>
        {activeTab === HISTORY_TAB && (
          <div className="absolute inset-0">
            <RunHistory />
          </div>
        )}
        {primarySession && (
          <div className={cn("absolute inset-0 flex", split?.direction === "column" ? "flex-col" : "flex-row")}>
            <div className={cn("min-h-0 min-w-0 flex-1", showSplit && focusedPane === "primary" && "ring-1 ring-inset ring-primary/40")}>
              <KyloTerminalPane
                key={primarySession}
                ref={primaryRef}
                sessionId={primarySession}
                active={focusedPane === "primary"}
                onFocus={() => setFocusedPane("primary")}
                onSearchRequest={() => setSearchOpen(true)}
              />
            </div>
            {showSplit && split && (
              <>
                <div className={cn("shrink-0 bg-border", split.direction === "column" ? "h-px w-full" : "h-full w-px")} />
                <div className={cn("min-h-0 min-w-0 flex-1", focusedPane === "secondary" && "ring-1 ring-inset ring-primary/40")}>
                  <KyloTerminalPane
                    key={split.second}
                    ref={secondaryRef}
                    sessionId={split.second}
                    active={focusedPane === "secondary"}
                    onFocus={() => setFocusedPane("secondary")}
                    onSearchRequest={() => setSearchOpen(true)}
                  />
                </div>
              </>
            )}
          </div>
        )}
        {!primarySession && activeTab !== AGENT_TAB && activeTab !== HISTORY_TAB && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <SquareTerminal className="h-8 w-8" />
            <span>{t("kylo.terminal.empty")}</span>
            <button type="button" onClick={() => void openTerminal(defaultProfile)} className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground">
              {t("kylo.terminal.new")}
            </button>
          </div>
        )}
      </div>

      {/* Send command */}
      {focusedSessionId && activeTab !== AGENT_TAB && activeTab !== HISTORY_TAB && (
        <form
          className="flex items-center gap-2 border-t border-border px-3 py-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void sendCommand(command, true);
            setCommand("");
          }}
        >
          <Send className="h-4 w-4 text-muted-foreground" />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={fill(t("kylo.terminal.send_placeholder"), {
              name: sessions.find((s) => s.id === focusedSessionId)?.name ?? "",
            })}
            aria-label={t("kylo.terminal.send")}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm"
          />
          <button type="submit" disabled={!command.trim()} className="rounded-md px-2 py-1 text-sm hover:bg-accent disabled:opacity-40">
            {t("kylo.terminal.send")}
          </button>
        </form>
      )}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function SpecialTab({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: typeof Plus;
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 text-sm",
        active ? "border-violet-500 bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
