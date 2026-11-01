/**
 * Kylo's persistent memory, inspectable and editable.
 *
 * Left: Global memory and every project (workspace) Kylo has memory for.
 * Right: the selected scope — for a project, its facts and its task log —
 * with search, add, inline edit, pin, delete; AGENTS.md import, export to a
 * JSON file, import from one, and "forget this project".
 *
 * The store refuses anything that looks like a secret, and project memory is
 * isolated: an agent in one workspace never sees another workspace's memory.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Download, FileText, Globe, Loader2, Pin, PinOff, Plus, Search, Trash2, Upload } from "lucide-react";
import { fill, useLocaleChunk, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { BrandedSelect } from "@/components/ui/select";
import { useKyloEventsConnection, useKyloStore } from "@/store/kylo";
import { memoryApi, type MemoryEntry, type MemoryProject, type MemoryScope } from "@/lib/kyloApi";

const GLOBAL = "__global__";
const PROJECT_KINDS = ["purpose", "stack", "architecture", "file", "build_command", "test_command", "dev_command", "decision", "issue", "convention", "instruction", "note"];
const TASK_KINDS = ["task_summary", "change", "command_result", "error", "unfinished", "solution"];
const GLOBAL_KINDS = ["preference", "instruction", "tool", "provider", "terminal", "note"];

function EntryRow({ entry, onChange, onDelete }: { entry: MemoryEntry; onChange: (e: MemoryEntry) => void; onDelete: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      onChange((await memoryApi.update(entry.id, { content: draft })).entry);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <li className="group px-4 py-3" data-testid="kylo-memory-entry">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{entry.kind}</span>
        {entry.title && <span className="truncate text-sm font-medium">{entry.title}</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          {entry.source} · {new Date(entry.updated_at * 1000).toLocaleDateString()}
        </span>
        <button
          type="button"
          aria-label={entry.pinned ? t("kylo.memory.unpin") : t("kylo.memory.pin")}
          onClick={() => void memoryApi.update(entry.id, { pinned: !entry.pinned }).then((r) => onChange(r.entry))}
          className={cn("rounded p-1 hover:bg-accent", entry.pinned ? "text-primary" : "text-muted-foreground opacity-0 group-hover:opacity-100")}
        >
          {entry.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          aria-label={t("kylo.common.remove")}
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-red-500 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {editing ? (
        <div className="mt-2 grid gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(12, Math.max(3, draft.split("\n").length))} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm" />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} className="rounded-lg bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
              {t("kylo.common.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-border px-3 py-1 text-sm">
              {t("kylo.common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <p onDoubleClick={() => setEditing(true)} className="mt-1.5 cursor-text whitespace-pre-wrap break-words text-sm" title={t("kylo.memory.edit_hint")}>
          {entry.content.length > 1200 ? `${entry.content.slice(0, 1200)}…` : entry.content}
        </p>
      )}
    </li>
  );
}

export function KyloMemoryView() {
  useLocaleChunk("kylo");
  useKyloEventsConnection();
  const t = useT();
  const workspace = useKyloStore((s) => s.workspace);
  const [projects, setProjects] = useState<MemoryProject[]>([]);
  const [selected, setSelected] = useState<string>(GLOBAL);
  const [scope, setScope] = useState<MemoryScope>("global");
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({ kind: "note", title: "", content: "" });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const project = selected === GLOBAL ? null : selected;

  const loadProjects = useCallback(() => {
    void memoryApi.projects().then((p) => setProjects(p.projects)).catch(() => undefined);
  }, []);

  const loadEntries = useCallback(() => {
    setEntries(null);
    void memoryApi
      .entries({ scope, project, q: query.trim() || undefined })
      .then((r) => setEntries(r.entries))
      .catch((e) => setMessage({ tone: "error", text: String(e) }));
  }, [scope, project, query]);

  useEffect(loadProjects, [loadProjects]);
  useEffect(() => {
    const timer = setTimeout(loadEntries, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [loadEntries, query]);

  const kinds = scope === "global" ? GLOBAL_KINDS : scope === "task" ? TASK_KINDS : PROJECT_KINDS;
  useEffect(() => setDraft((d) => ({ ...d, kind: kinds.includes(d.kind) ? d.kind : kinds[0] })), [kinds]);

  const projectList = useMemo(() => {
    const list = [...projects];
    if (workspace && !list.some((p) => p.path.toLowerCase() === workspace.toLowerCase())) {
      list.unshift({ key: workspace, path: workspace, name: workspace.split(/[\\/]/).pop() ?? workspace, created_at: 0, last_used: 0, entries: 0 });
    }
    return list;
  }, [projects, workspace]);

  const add = async () => {
    try {
      const res = await memoryApi.add({ scope, kind: draft.kind, content: draft.content.trim(), title: draft.title.trim(), project });
      setMessage({ tone: "ok", text: res.created ? t("kylo.memory.added") : t("kylo.memory.duplicate") });
      setDraft({ ...draft, title: "", content: "" });
      loadEntries();
      loadProjects();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const exportJson = async () => {
    const data = await memoryApi.exportAll(project);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kylo-memory-${project ? (project.split(/[\\/]/).pop() ?? "project") : "all"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const res = await memoryApi.importAll(JSON.parse(await file.text()));
      setMessage({ tone: "ok", text: fill(t("kylo.memory.imported"), { created: res.created, skipped: res.skipped }) });
      loadEntries();
      loadProjects();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="flex h-full min-h-0" data-testid="kylo-memory-view">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="border-b border-border p-4">
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <Brain className="h-5 w-5" />
            {t("kylo.memory.title")}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{t("kylo.memory.sub")}</p>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto p-2">
          <li>
            <button
              type="button"
              onClick={() => {
                setSelected(GLOBAL);
                setScope("global");
              }}
              className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent/60", selected === GLOBAL && "bg-accent")}
            >
              <Globe className="h-4 w-4 text-muted-foreground" />
              {t("kylo.memory.global")}
            </button>
          </li>
          <li className="px-2.5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("kylo.memory.projects")}</li>
          {projectList.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => {
                  setSelected(p.path);
                  setScope("project");
                }}
                className={cn("w-full rounded-lg px-2.5 py-2 text-left hover:bg-accent/60", selected === p.path && "bg-accent")}
                title={p.path}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate font-medium">{p.name}</span>
                  {workspace && p.path.toLowerCase() === workspace.toLowerCase() && (
                    <span className="rounded bg-primary/15 px-1 text-[10px] font-semibold uppercase text-primary">{t("kylo.memory.current")}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">{p.entries}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{p.path}</div>
              </button>
            </li>
          ))}
          {projectList.length === 0 && <li className="px-2.5 py-2 text-xs text-muted-foreground">{t("kylo.memory.no_projects")}</li>}
        </ul>
        <div className="flex gap-1 border-t border-border p-2">
          <button type="button" onClick={() => void exportJson()} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs hover:bg-accent">
            <Download className="h-3.5 w-3.5" />
            {t("kylo.memory.export")}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs hover:bg-accent">
            <Upload className="h-3.5 w-3.5" />
            {t("kylo.memory.import")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = "";
            }}
          />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {project ? (
            <div role="tablist" className="flex gap-1">
              {(["project", "task"] as MemoryScope[]).map((s) => (
                <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={cn("rounded-lg px-3 py-1 text-sm", scope === s ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}>
                  {t(`kylo.memory.scope_${s}`)}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-sm font-medium">{t("kylo.memory.global")}</span>
          )}
          <div className="relative ml-auto w-64">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("kylo.memory.search")} aria-label={t("kylo.memory.search")} className="h-8 w-full rounded-lg border border-border bg-background pl-7 pr-2 text-sm" />
          </div>
          {project && (
            <>
              <button
                type="button"
                onClick={() =>
                  void memoryApi
                    .importAgentsMd(project)
                    .then((r) => {
                      setMessage({ tone: "ok", text: r.imported.length ? fill(t("kylo.workspace.imported"), { files: r.imported.join(", ") }) : t("kylo.memory.no_agents_md") });
                      loadEntries();
                    })
                    .catch((e) => setMessage({ tone: "error", text: String(e) }))
                }
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm hover:bg-accent"
              >
                <FileText className="h-4 w-4" />
                AGENTS.md
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(fill(t("kylo.memory.confirm_forget"), { path: project }))) return;
                  void memoryApi.forgetProject(project).then(() => {
                    setSelected(GLOBAL);
                    setScope("global");
                    loadProjects();
                  });
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm text-red-500 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" />
                {t("kylo.memory.forget")}
              </button>
            </>
          )}
        </div>
        {message && (
          <div className={cn("px-4 py-2 text-sm", message.tone === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-400")} onClick={() => setMessage(null)}>
            {message.text}
          </div>
        )}
        <div className="grid gap-2 border-b border-border px-4 py-3">
          <div className="flex gap-2">
            <div className="w-48">
              <BrandedSelect value={draft.kind} options={kinds.map((k) => ({ value: k, label: k }))} onValueChange={(v) => setDraft({ ...draft, kind: v })} ariaLabel={t("kylo.memory.kind")} />
            </div>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t("kylo.memory.title_placeholder")} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
          </div>
          <div className="flex gap-2">
            <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder={t("kylo.memory.content_placeholder")} rows={2} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            <button type="button" disabled={!draft.content.trim()} onClick={() => void add()} className="inline-flex items-center gap-1 self-start rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40" data-testid="kylo-memory-add">
              <Plus className="h-4 w-4" />
              {t("kylo.common.add")}
            </button>
          </div>
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-auto">
          {entries === null && (
            <li className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </li>
          )}
          {entries?.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onChange={(next) => setEntries((list) => list?.map((e) => (e.id === next.id ? next : e)) ?? null)}
              onDelete={() =>
                void memoryApi.remove(entry.id).then(() => {
                  setEntries((list) => list?.filter((e) => e.id !== entry.id) ?? null);
                  loadProjects();
                })
              }
            />
          ))}
          {entries?.length === 0 && <li className="px-4 py-12 text-center text-sm text-muted-foreground">{t("kylo.memory.empty")}</li>}
        </ul>
      </main>
    </div>
  );
}
