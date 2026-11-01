/**
 * Kylo Setup: the environment dashboard and every agent setting in one page.
 *
 * 1. Workspace — the folder agents work in (its AGENTS.md becomes project memory).
 * 2. Permissions — Ask Before Actions / Workspace Autonomy / Advanced Autonomy.
 * 3. Terminal — default shell, WSL distribution, where the AI runs commands,
 *    environment variables, custom shell profiles.
 * 4. Environment — WSL, Git, GitHub CLI, Node, Python, Docker, Ollama and the
 *    coding agents: installed, version, signed in, what is missing and how to
 *    get it. "Install" opens a visible terminal with the command typed in and
 *    run there, so nothing is ever installed behind the user's back.
 * 5. AI providers — the existing provider pages (keys, models, Ollama).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleX, ExternalLink, FolderOpen, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { fill, useLocaleChunk, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { BrandedSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useEventStore } from "@/store/events";
import { useKyloEventsConnection, useKyloStore } from "@/store/kylo";
import { openExternal, runInNewTerminal } from "@/lib/kyloActions";
import {
  environmentApi,
  pickFolder,
  terminalsApi,
  type AutonomyMode,
  type AutonomySettings,
  type EnvironmentReport,
  type TerminalProfile,
  type TerminalSettings,
  type ToolStatus,
  type WslDistro,
} from "@/lib/kyloApi";

function Card({ title, sub, children, aside }: { title: string; sub?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-center">
      <span className="text-sm font-medium">
        {label}
        {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      <div className="min-w-0">{children}</div>
    </label>
  );
}

const inputCls = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm";

function StatusIcon({ status }: { status: ToolStatus["status"] }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === "warning") return <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" />;
  return <CircleX className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function ToolRow({ tool, onInstall }: { tool: ToolStatus; onInstall: (tool: ToolStatus) => void }) {
  const t = useT();
  const extra = tool.extra as { login?: string; models?: string[]; distros?: WslDistro[]; daemon_running?: boolean };
  return (
    <li className="flex items-start gap-3 px-4 py-3" data-testid={`kylo-tool-${tool.id}`}>
      <StatusIcon status={tool.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{tool.name}</span>
          {tool.version && <span className="font-mono text-xs text-muted-foreground">{tool.version}</span>}
        </div>
        {tool.detail && <p className="mt-0.5 text-xs text-muted-foreground">{tool.detail}</p>}
        {extra.models && extra.models.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{extra.models.join(", ")}</p>
        )}
        {extra.distros && extra.distros.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {extra.distros.map((d) => `${d.name}${d.default ? " ★" : ""} (WSL ${d.version}, ${d.state})`).join(" · ")}
          </p>
        )}
        {tool.install?.note && tool.status !== "ok" && <p className="mt-0.5 text-xs text-muted-foreground">{tool.install.note}</p>}
      </div>
      {tool.status !== "ok" && tool.install && (
        <div className="flex shrink-0 gap-1.5">
          {tool.install.command && (
            <button
              type="button"
              onClick={() => onInstall(tool)}
              title={tool.install.command}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              {tool.installed ? t("kylo.setup.fix") : t("kylo.setup.install")}
            </button>
          )}
          {tool.install.url && (
            <button
              type="button"
              onClick={() => openExternal(tool.install!.url!)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <ExternalLink className="h-3 w-3" />
              {t("kylo.setup.docs")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

const MODES: AutonomyMode[] = ["ask", "workspace", "advanced"];

export function KyloSetupView() {
  useLocaleChunk("kylo");
  useKyloEventsConnection();
  const t = useT();
  const setActiveSection = useEventStore((s) => s.setActiveSection);
  const workspace = useKyloStore((s) => s.workspace);
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [settings, setSettings] = useState<TerminalSettings | null>(null);
  const [autonomy, setAutonomy] = useState<AutonomySettings | null>(null);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [distros, setDistros] = useState<WslDistro[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [envText, setEnvText] = useState("");
  const [newProfile, setNewProfile] = useState({ label: "", path: "", args: "" });

  const loadEnv = useCallback(async (refresh: boolean) => {
    setLoadingEnv(true);
    try {
      setReport(await environmentApi.report(refresh));
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingEnv(false);
    }
  }, []);

  useEffect(() => {
    void loadEnv(false);
    void terminalsApi.settings().then((s) => {
      setSettings(s);
      setEnvText(Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join("\n"));
    });
    void terminalsApi.autonomy().then(setAutonomy);
    void terminalsApi.profiles().then((p) => {
      setProfiles(p.profiles);
      setDistros(p.wsl_distros.filter((d) => !d.name.startsWith("docker-desktop")));
    });
    void terminalsApi.workspace().then((w) => useKyloStore.setState({ workspace: w.workspace }));
  }, [loadEnv]);

  const flash = (tone: "ok" | "error", text: string) => {
    setMessage({ tone, text });
    if (tone === "ok") setTimeout(() => setMessage(null), 2500);
  };

  const saveSettings = async (next: TerminalSettings) => {
    try {
      const saved = await terminalsApi.saveSettings(next);
      setSettings(saved);
      flash("ok", t("kylo.setup.saved"));
    } catch (e) {
      flash("error", e instanceof Error ? e.message : String(e));
    }
  };

  const saveAutonomy = async (next: AutonomySettings) => {
    try {
      const saved = await terminalsApi.saveAutonomy({
        mode: next.mode,
        extra_sensitive: next.extra_sensitive,
        allowed_roots: next.allowed_roots,
        approval_timeout_s: next.approval_timeout_s,
      });
      setAutonomy(saved);
      flash("ok", t("kylo.setup.saved"));
    } catch (e) {
      flash("error", e instanceof Error ? e.message : String(e));
    }
  };

  const chooseWorkspace = async () => {
    const folder = await pickFolder(t("kylo.workspace.pick_title"));
    if (!folder) return;
    try {
      const res = await terminalsApi.setWorkspace(folder);
      useKyloStore.setState({ workspace: res.workspace });
      flash("ok", res.imported_instructions.length ? fill(t("kylo.workspace.imported"), { files: res.imported_instructions.join(", ") }) : t("kylo.setup.saved"));
    } catch (e) {
      flash("error", e instanceof Error ? e.message : String(e));
    }
  };

  const install = async (tool: ToolStatus) => {
    if (!tool.install?.command) return;
    try {
      await runInNewTerminal(tool.install.command, profiles, tool.install.shell);
      setActiveSection("terminal");
    } catch (e) {
      flash("error", e instanceof Error ? e.message : String(e));
    }
  };

  const profileOptions = useMemo(() => profiles.map((p) => ({ value: p.id, label: p.label })), [profiles]);
  const groups = useMemo(() => {
    const tools = report?.tools ?? [];
    return [
      { id: "core", label: t("kylo.setup.group_core"), tools: tools.filter((x) => x.category === "core") },
      { id: "runtime", label: t("kylo.setup.group_runtime"), tools: tools.filter((x) => x.category === "runtime") },
      { id: "ai", label: t("kylo.setup.group_ai"), tools: tools.filter((x) => x.category === "ai" || x.category === "agent") },
    ];
  }, [report, t]);

  return (
    <div className="h-full overflow-auto" data-testid="kylo-setup-view">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{t("kylo.setup.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("kylo.setup.subtitle")}</p>
        </header>
        {message && (
          <div className={cn("rounded-lg px-3 py-2 text-sm", message.tone === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-400")}>
            {message.text}
          </div>
        )}

        <Card title={t("kylo.workspace.title")} sub={t("kylo.workspace.sub")}>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{workspace ?? t("kylo.workspace.none")}</code>
            <button type="button" onClick={() => void chooseWorkspace()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              <FolderOpen className="h-4 w-4" />
              {t("kylo.workspace.choose")}
            </button>
            {workspace && (
              <button type="button" onClick={() => void terminalsApi.setWorkspace(null).then(() => useKyloStore.setState({ workspace: null }))} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
                {t("kylo.workspace.clear")}
              </button>
            )}
          </div>
        </Card>

        <Card title={t("kylo.autonomy.title")} sub={t("kylo.autonomy.sub")}>
          {autonomy ? (
            <div className="grid gap-3">
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                {MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={autonomy.mode === mode}
                    data-testid={`kylo-mode-${mode}`}
                    onClick={() => void saveAutonomy({ ...autonomy, mode })}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      autonomy.mode === mode ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50",
                    )}
                  >
                    <div className="text-sm font-semibold">{t(`kylo.autonomy.${mode}`)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{t(`kylo.autonomy.${mode}_desc`)}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("kylo.autonomy.always")}</p>
              <Field label={t("kylo.autonomy.allowed_roots")} hint={t("kylo.autonomy.allowed_roots_hint")}>
                <textarea
                  defaultValue={autonomy.allowed_roots.join("\n")}
                  onBlur={(e) => void saveAutonomy({ ...autonomy, allowed_roots: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                />
              </Field>
              <Field label={t("kylo.autonomy.sensitive")} hint={t("kylo.autonomy.sensitive_hint")}>
                <textarea
                  defaultValue={autonomy.extra_sensitive.join("\n")}
                  onBlur={(e) => void saveAutonomy({ ...autonomy, extra_sensitive: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                />
              </Field>
              <Field label={t("kylo.autonomy.timeout")}>
                <input
                  type="number"
                  min={15}
                  max={3600}
                  defaultValue={autonomy.approval_timeout_s}
                  onBlur={(e) => void saveAutonomy({ ...autonomy, approval_timeout_s: Math.max(15, Math.min(3600, Number(e.target.value) || 300)) })}
                  className={cn(inputCls, "w-32")}
                />
              </Field>
            </div>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </Card>

        <Card title={t("kylo.terminal_settings.title")} sub={t("kylo.terminal_settings.sub")}>
          {settings ? (
            <div className="grid gap-4">
              <Field label={t("kylo.terminal_settings.default_shell")}>
                <BrandedSelect
                  value={settings.default_profile ?? ""}
                  options={[{ value: "", label: t("kylo.terminal_settings.automatic") }, ...profileOptions]}
                  onValueChange={(v) => void saveSettings({ ...settings, default_profile: v || null })}
                  ariaLabel={t("kylo.terminal_settings.default_shell")}
                />
              </Field>
              <Field label={t("kylo.terminal_settings.wsl_distro")} hint={distros.length ? undefined : t("kylo.terminal_settings.no_wsl")}>
                <BrandedSelect
                  value={settings.wsl_distro ?? ""}
                  options={[{ value: "", label: t("kylo.terminal_settings.wsl_default") }, ...distros.map((d) => ({ value: d.name, label: `${d.name} (WSL ${d.version})` }))]}
                  onValueChange={(v) => void saveSettings({ ...settings, wsl_distro: v || null })}
                  ariaLabel={t("kylo.terminal_settings.wsl_distro")}
                  disabled={!distros.length}
                />
              </Field>
              <Field label={t("kylo.terminal_settings.agent_shell")} hint={t("kylo.terminal_settings.agent_shell_hint")}>
                <BrandedSelect
                  value={settings.agent_default_shell}
                  options={(["auto", "wsl", "powershell", "cmd", "bash"] as const).map((v) => ({ value: v, label: t(`kylo.shell.${v}`) }))}
                  onValueChange={(v) => void saveSettings({ ...settings, agent_default_shell: v as TerminalSettings["agent_default_shell"] })}
                  ariaLabel={t("kylo.terminal_settings.agent_shell")}
                />
              </Field>
              <Field label={t("kylo.terminal_settings.agent_mode")}>
                <BrandedSelect
                  value={settings.agent_mode}
                  options={(["dedicated", "new", "shared"] as const).map((v) => ({ value: v, label: t(`kylo.agent_mode.${v}`) }))}
                  onValueChange={(v) => void saveSettings({ ...settings, agent_mode: v as TerminalSettings["agent_mode"] })}
                  ariaLabel={t("kylo.terminal_settings.agent_mode")}
                />
              </Field>
              <Field label={t("kylo.terminal_settings.allow_shared")} hint={t("kylo.terminal_settings.allow_shared_hint")}>
                <Switch
                  checked={settings.allow_agent_shared_terminal}
                  onCheckedChange={(v) => void saveSettings({ ...settings, allow_agent_shared_terminal: v })}
                  aria-label={t("kylo.terminal_settings.allow_shared")}
                />
              </Field>
              <Field label={t("kylo.terminal_settings.startup_cwd")}>
                <input
                  defaultValue={settings.startup_cwd ?? ""}
                  placeholder={t("kylo.terminal_settings.startup_cwd_placeholder")}
                  onBlur={(e) => void saveSettings({ ...settings, startup_cwd: e.target.value.trim() || null })}
                  className={cn(inputCls, "font-mono")}
                />
              </Field>
              <Field label={t("kylo.terminal_settings.env")} hint={t("kylo.terminal_settings.env_hint")}>
                <textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  onBlur={() => {
                    const env: Record<string, string> = {};
                    for (const line of envText.split("\n")) {
                      const idx = line.indexOf("=");
                      if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1);
                    }
                    void saveSettings({ ...settings, env });
                  }}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                />
              </Field>
              <div>
                <div className="mb-2 text-sm font-medium">{t("kylo.terminal_settings.custom_profiles")}</div>
                <ul className="mb-2 divide-y divide-border rounded-lg border border-border">
                  {settings.custom_profiles.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="font-medium">{p.label}</span>
                      <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{[p.path, ...p.args].join(" ")}</code>
                      <button
                        type="button"
                        aria-label={t("kylo.common.remove")}
                        onClick={() => void saveSettings({ ...settings, custom_profiles: settings.custom_profiles.filter((x) => x.id !== p.id) })}
                        className="rounded p-1 hover:bg-accent"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {settings.custom_profiles.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{t("kylo.terminal_settings.no_custom")}</li>}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <input value={newProfile.label} onChange={(e) => setNewProfile({ ...newProfile, label: e.target.value })} placeholder={t("kylo.terminal_settings.profile_label")} className={cn(inputCls, "w-40")} />
                  <input value={newProfile.path} onChange={(e) => setNewProfile({ ...newProfile, path: e.target.value })} placeholder={t("kylo.terminal_settings.profile_path")} className={cn(inputCls, "min-w-[12rem] flex-1 font-mono")} />
                  <input value={newProfile.args} onChange={(e) => setNewProfile({ ...newProfile, args: e.target.value })} placeholder={t("kylo.terminal_settings.profile_args")} className={cn(inputCls, "w-40 font-mono")} />
                  <button
                    type="button"
                    disabled={!newProfile.label.trim() || !newProfile.path.trim()}
                    onClick={() => {
                      const id = newProfile.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `p${Date.now()}`;
                      void saveSettings({
                        ...settings,
                        custom_profiles: [
                          ...settings.custom_profiles,
                          { id, label: newProfile.label.trim(), path: newProfile.path.trim(), args: newProfile.args.split(" ").filter(Boolean), env: {}, cwd: null },
                        ],
                      }).then(() => {
                        setNewProfile({ label: "", path: "", args: "" });
                        void terminalsApi.profiles().then((p) => setProfiles(p.profiles));
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                    {t("kylo.common.add")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </Card>

        <Card
          title={t("kylo.setup.env_title")}
          sub={report ? fill(t("kylo.setup.env_checked"), { seconds: report.duration_s }) : t("kylo.setup.env_sub")}
          aside={
            <button type="button" onClick={() => void loadEnv(true)} disabled={loadingEnv} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50" data-testid="kylo-env-refresh">
              <RefreshCw className={cn("h-4 w-4", loadingEnv && "animate-spin")} />
              {t("kylo.setup.recheck")}
            </button>
          }
        >
          {!report && loadingEnv && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("kylo.setup.detecting")}
            </div>
          )}
          {report && (
            <div className="grid gap-5">
              {report.recommendations.length > 0 && (
                <ul className="grid gap-1.5">
                  {report.recommendations.map((r) => (
                    <li key={r.text} className={cn("rounded-lg px-3 py-2 text-sm", r.level === "important" ? "bg-amber-500/10 text-amber-800 dark:text-amber-200" : "bg-muted/50 text-muted-foreground")}>
                      {r.text}
                    </li>
                  ))}
                </ul>
              )}
              {groups.map((g) => (
                <div key={g.id}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</div>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {g.tools.map((tool) => (
                      <ToolRow key={tool.id} tool={tool} onInstall={(x) => void install(x)} />
                    ))}
                  </ul>
                </div>
              ))}
              {report.wsl_toolchain.distro && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {fill(t("kylo.setup.wsl_tools"), { distro: report.wsl_toolchain.distro })}
                  </div>
                  {report.wsl_toolchain.error ? (
                    <p className="text-sm text-red-500">{report.wsl_toolchain.error}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {report.wsl_toolchain.tools.map((x) => (
                        <span key={x.id} className={cn("rounded-md border px-2 py-0.5 font-mono text-xs", x.installed ? "border-emerald-500/30 text-foreground" : "border-border text-muted-foreground line-through")}>
                          {x.id}
                          {x.version ? ` ${x.version}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title={t("kylo.setup.providers_title")} sub={t("kylo.setup.providers_sub")}>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setActiveSection("apikeys")} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              {t("kylo.setup.open_providers")}
            </button>
            <button type="button" onClick={() => setActiveSection("github")} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
              {t("kylo.setup.open_github")}
            </button>
            <button type="button" onClick={() => setActiveSection("project-memory")} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">
              {t("kylo.setup.open_memory")}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
