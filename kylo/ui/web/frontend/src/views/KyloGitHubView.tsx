/**
 * GitHub, through the user's own GitHub CLI login.
 *
 * Kylo never asks for a token: when `gh` is signed in, every list and action
 * here runs as that account with exactly its permissions. Missing `gh` or a
 * missing sign-in is shown with the one step that fixes it (install, or
 * `gh auth login` in a visible terminal).
 *
 * Left: the account and its repositories (clone into a folder, open on
 * GitHub, create a repository). Right: the selected repository's issues,
 * pull requests and Actions runs (with the failed-step log), plus a
 * pull request from the current workspace.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FolderDown, GitPullRequest, Loader2, Lock, Plus, RefreshCw, Search } from "lucide-react";
import { fill, useLocaleChunk, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useEventStore } from "@/store/events";
import { useKyloEventsConnection, useKyloStore } from "@/store/kylo";
import { openExternal, runInNewTerminal } from "@/lib/kyloActions";
import {
  githubApi,
  pickFolder,
  terminalsApi,
  type GitHubIssue,
  type GitHubPull,
  type GitHubRepo,
  type GitHubRun,
  type GitHubStatus,
} from "@/lib/kyloApi";

type Tab = "pulls" | "issues" | "runs";

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function runTone(run: GitHubRun): string {
  if (run.status !== "completed") return "text-amber-500";
  return run.conclusion === "success" ? "text-emerald-500" : run.conclusion === "skipped" || run.conclusion === "cancelled" ? "text-muted-foreground" : "text-red-500";
}

export function KyloGitHubView() {
  useLocaleChunk("kylo");
  useKyloEventsConnection();
  const t = useT();
  const setActiveSection = useEventStore((s) => s.setActiveSection);
  const workspace = useKyloStore((s) => s.workspace);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pulls");
  const [items, setItems] = useState<{ pulls?: GitHubPull[]; issues?: GitHubIssue[]; runs?: GitHubRun[] }>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [runLog, setRunLog] = useState<{ id: number; text: string } | null>(null);
  const [workspaceRepo, setWorkspaceRepo] = useState<string | null>(null);
  const [create, setCreate] = useState<{ name: string; description: string; private: boolean; fromWorkspace: boolean } | null>(null);
  const [pr, setPr] = useState<{ title: string; body: string; base: string; draft: boolean } | null>(null);

  const say = (tone: "ok" | "error", text: string) => setMessage({ tone, text });
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await githubApi.status();
      setStatus(s);
      if (s.authenticated) setRepos((await githubApi.repos(undefined, 200)).repos);
    } catch (e) {
      say("error", errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workspace) return setWorkspaceRepo(null);
    void githubApi.repoForFolder(workspace).then((r) => setWorkspaceRepo(r.repo?.nameWithOwner ?? null)).catch(() => setWorkspaceRepo(null));
  }, [workspace]);

  useEffect(() => {
    if (!selected) return;
    setItems({});
    setRunLog(null);
    const load = tab === "pulls" ? githubApi.pulls(selected, "all") : tab === "issues" ? githubApi.issues(selected, "all") : githubApi.runs(selected);
    void load.then((data) => setItems(data as typeof items)).catch((e) => say("error", errText(e)));
  }, [selected, tab]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? repos.filter((r) => r.nameWithOwner.toLowerCase().includes(f) || (r.description ?? "").toLowerCase().includes(f)) : repos;
  }, [repos, filter]);

  const runSetupCommand = async (command: string) => {
    const profiles = (await terminalsApi.profiles()).profiles;
    await runInNewTerminal(command, profiles, "powershell");
    setActiveSection("terminal");
  };

  const clone = async (repo: string) => {
    const dest = await pickFolder(t("kylo.github.clone_into"));
    if (!dest) return;
    setBusy(repo);
    try {
      const res = await githubApi.clone(repo, dest);
      say("ok", fill(t("kylo.github.cloned"), { path: res.path }));
      if (window.confirm(fill(t("kylo.github.use_as_workspace"), { path: res.path }))) {
        const ws = await terminalsApi.setWorkspace(res.path);
        useKyloStore.setState({ workspace: ws.workspace });
      }
    } catch (e) {
      say("error", errText(e));
    } finally {
      setBusy(null);
    }
  };

  const showRunLog = async (run: GitHubRun) => {
    if (!selected) return;
    setRunLog({ id: run.databaseId, text: t("kylo.history.loading") });
    try {
      const data = await githubApi.run(selected, run.databaseId, true);
      setRunLog({ id: run.databaseId, text: data.failed_log ?? t("kylo.github.no_failed_log") });
    } catch (e) {
      setRunLog({ id: run.databaseId, text: errText(e) });
    }
  };

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!status.gh_installed || !status.authenticated) {
    return (
      <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center" data-testid="kylo-github-connect">
        <h1 className="text-2xl font-semibold">{t("kylo.github.title")}</h1>
        <p className="text-sm text-muted-foreground">{!status.gh_installed ? t("kylo.github.not_installed") : t("kylo.github.not_signed_in")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!status.gh_installed ? (
            <>
              <button type="button" onClick={() => void runSetupCommand("winget install --id GitHub.cli -e")} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                {t("kylo.github.install")}
              </button>
              <button type="button" onClick={() => openExternal(status.install_url)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">
                cli.github.com
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void runSetupCommand(status.login_command)} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              {t("kylo.github.sign_in")}
            </button>
          )}
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("kylo.setup.recheck")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("kylo.github.no_token")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0" data-testid="kylo-github-view">
      {/* Account + repositories */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-3 border-b border-border p-4">
          {status.avatar_url && <img src={status.avatar_url} alt="" className="h-9 w-9 rounded-full" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{status.name ?? status.login}</div>
            <div className="truncate text-xs text-muted-foreground">
              @{status.login} · gh {status.gh_version}
            </div>
          </div>
          <button type="button" aria-label={t("kylo.history.refresh")} onClick={() => void refresh()} className="rounded p-1.5 hover:bg-accent">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
        <div className="flex gap-2 p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("kylo.github.filter")} aria-label={t("kylo.github.filter")} className="h-8 w-full rounded-lg border border-border bg-background pl-7 pr-2 text-sm" />
          </div>
          <button type="button" title={t("kylo.github.create")} aria-label={t("kylo.github.create")} onClick={() => setCreate({ name: "", description: "", private: true, fromWorkspace: !!workspace && !workspaceRepo })} className="rounded-lg border border-border px-2 hover:bg-accent">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto px-2 pb-2">
          {visible.map((repo) => (
            <li key={repo.nameWithOwner}>
              <button
                type="button"
                onClick={() => setSelected(repo.nameWithOwner)}
                className={cn("w-full rounded-lg px-2.5 py-2 text-left hover:bg-accent/60", selected === repo.nameWithOwner && "bg-accent")}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {repo.isPrivate && <Lock className="h-3 w-3 text-muted-foreground" />}
                  <span className="truncate">{repo.nameWithOwner}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[repo.primaryLanguage?.name, `${ago(repo.updatedAt)}`, repo.description].filter(Boolean).join(" · ")}
                </div>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">{t("kylo.github.no_repos")}</li>}
        </ul>
      </aside>

      {/* Repository detail */}
      <main className="flex min-w-0 flex-1 flex-col">
        {message && (
          <div className={cn("flex items-center gap-2 px-4 py-2 text-sm", message.tone === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-400")}>
            <span className="min-w-0 flex-1">{message.text}</span>
            <button type="button" onClick={() => setMessage(null)} className="text-xs underline">
              {t("kylo.common.dismiss")}
            </button>
          </div>
        )}
        {workspace && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm">
            <span className="text-muted-foreground">{t("kylo.github.workspace_repo")}</span>
            <code className="truncate">{workspaceRepo ?? t("kylo.github.not_a_repo")}</code>
            {workspaceRepo && (
              <button type="button" onClick={() => setPr({ title: "", body: "", base: "", draft: false })} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
                <GitPullRequest className="h-4 w-4" />
                {t("kylo.github.open_pr")}
              </button>
            )}
          </div>
        )}
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t("kylo.github.pick_repo")}</div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{selected}</h1>
              <button type="button" disabled={busy === selected} onClick={() => void clone(selected)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
                {busy === selected ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderDown className="h-4 w-4" />}
                {t("kylo.github.clone")}
              </button>
              <button type="button" onClick={() => openExternal(`https://github.com/${selected}`)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
                <ExternalLink className="h-4 w-4" />
                GitHub
              </button>
            </div>
            <div role="tablist" className="flex gap-1 border-b border-border px-3">
              {(["pulls", "issues", "runs"] as Tab[]).map((x) => (
                <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={cn("border-b-2 px-3 py-2 text-sm", tab === x ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {t(`kylo.github.tab_${x}`)}
                </button>
              ))}
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-auto">
              {tab === "pulls" &&
                (items.pulls ?? []).map((p) => (
                  <li key={p.number} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={cn("w-16 shrink-0 text-xs font-medium", p.state === "OPEN" ? "text-emerald-500" : p.state === "MERGED" ? "text-violet-500" : "text-muted-foreground")}>{p.isDraft ? t("kylo.github.draft") : p.state.toLowerCase()}</span>
                    <button type="button" onClick={() => openExternal(p.url)} className="min-w-0 flex-1 truncate text-left hover:underline">
                      #{p.number} {p.title}
                    </button>
                    <code className="shrink-0 text-xs text-muted-foreground">
                      {p.headRefName} → {p.baseRefName}
                    </code>
                    {p.state === "OPEN" && !p.isDraft && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm(fill(t("kylo.github.confirm_merge"), { number: p.number }))) return;
                          void githubApi.merge(selected, p.number, "squash").then(() => say("ok", t("kylo.github.merged"))).catch((e) => say("error", errText(e)));
                        }}
                        className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent"
                      >
                        {t("kylo.github.merge")}
                      </button>
                    )}
                  </li>
                ))}
              {tab === "issues" &&
                (items.issues ?? []).map((i) => (
                  <li key={i.number} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={cn("w-16 shrink-0 text-xs font-medium", i.state === "OPEN" ? "text-emerald-500" : "text-muted-foreground")}>{i.state.toLowerCase()}</span>
                    <button type="button" onClick={() => openExternal(i.url)} className="min-w-0 flex-1 truncate text-left hover:underline">
                      #{i.number} {i.title}
                    </button>
                    <span className="shrink-0 text-xs text-muted-foreground">{i.author?.login} · {ago(i.updatedAt)}</span>
                  </li>
                ))}
              {tab === "runs" &&
                (items.runs ?? []).map((r) => (
                  <li key={r.databaseId} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      <span className={cn("w-20 shrink-0 text-xs font-medium", runTone(r))}>{r.status === "completed" ? r.conclusion : r.status}</span>
                      <button type="button" onClick={() => void showRunLog(r)} className="min-w-0 flex-1 truncate text-left hover:underline">
                        {r.workflowName}: {r.displayTitle}
                      </button>
                      <code className="shrink-0 text-xs text-muted-foreground">{r.headBranch}</code>
                      <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{ago(r.createdAt)}</span>
                    </div>
                    {runLog?.id === r.databaseId && (
                      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/30 p-2 font-mono text-xs">{runLog.text}</pre>
                    )}
                  </li>
                ))}
              {((tab === "pulls" && items.pulls?.length === 0) || (tab === "issues" && items.issues?.length === 0) || (tab === "runs" && items.runs?.length === 0)) && (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">{t("kylo.github.nothing")}</li>
              )}
              {!items.pulls && !items.issues && !items.runs && (
                <li className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </li>
              )}
            </ul>
          </>
        )}
      </main>

      {create && (
        <Modal title={t("kylo.github.create")} onClose={() => setCreate(null)}>
          <input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} placeholder={t("kylo.github.repo_name")} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" />
          <input value={create.description} onChange={(e) => setCreate({ ...create, description: e.target.value })} placeholder={t("kylo.github.description")} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={create.private} onChange={(e) => setCreate({ ...create, private: e.target.checked })} />
            {t("kylo.github.private")}
          </label>
          {workspace && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={create.fromWorkspace} onChange={(e) => setCreate({ ...create, fromWorkspace: e.target.checked })} />
              {fill(t("kylo.github.push_workspace"), { path: workspace })}
            </label>
          )}
          <ModalActions
            busy={busy === "create"}
            disabled={!create.name.trim()}
            label={t("kylo.github.create")}
            onCancel={() => setCreate(null)}
            onConfirm={async () => {
              setBusy("create");
              try {
                const res = await githubApi.create({ name: create.name.trim(), private: create.private, description: create.description, source: create.fromWorkspace ? workspace : null, push: create.fromWorkspace });
                say("ok", fill(t("kylo.github.created"), { url: res.url ?? create.name }));
                setCreate(null);
                void refresh();
              } catch (e) {
                say("error", errText(e));
              } finally {
                setBusy(null);
              }
            }}
          />
        </Modal>
      )}

      {pr && workspace && (
        <Modal title={t("kylo.github.open_pr")} onClose={() => setPr(null)}>
          <input value={pr.title} onChange={(e) => setPr({ ...pr, title: e.target.value })} placeholder={t("kylo.github.pr_title")} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" />
          <textarea value={pr.body} onChange={(e) => setPr({ ...pr, body: e.target.value })} placeholder={t("kylo.github.pr_body")} rows={6} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input value={pr.base} onChange={(e) => setPr({ ...pr, base: e.target.value })} placeholder={t("kylo.github.pr_base")} className="h-9 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pr.draft} onChange={(e) => setPr({ ...pr, draft: e.target.checked })} />
            {t("kylo.github.draft")}
          </label>
          <ModalActions
            busy={busy === "pr"}
            disabled={!pr.title.trim()}
            label={t("kylo.github.open_pr")}
            onCancel={() => setPr(null)}
            onConfirm={async () => {
              setBusy("pr");
              try {
                const res = await githubApi.createPull({ folder: workspace, title: pr.title.trim(), body: pr.body, base: pr.base.trim() || undefined, draft: pr.draft });
                say("ok", fill(t("kylo.github.pr_created"), { url: res.url ?? "" }));
                setPr(null);
              } catch (e) {
                say("error", errText(e));
              } finally {
                setBusy(null);
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={title} className="grid w-[min(520px,calc(100vw-2rem))] gap-3 rounded-2xl border border-border bg-popover p-6 shadow-2xl">
        <h2 className="text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ busy, disabled, label, onCancel, onConfirm }: { busy: boolean; disabled: boolean; label: string; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  return (
    <div className="mt-2 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:bg-muted">
        {t("kylo.common.cancel")}
      </button>
      <button type="button" disabled={busy || disabled} onClick={onConfirm} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {label}
      </button>
    </div>
  );
}
