/**
 * The permission dialog for AI actions that the autonomy policy will not run
 * on its own (kylo/security/autonomy.py): destructive, elevated, outside the
 * workspace, touching sensitive files, GitHub writes, or everything in
 * "Ask Before Actions" mode.
 *
 * It shows exactly what would run, where, and why it needs a person. One
 * request at a time, oldest first. Closing the dialog or letting it expire
 * DENIES — nothing is ever approved by default. "Always allow" remembers only
 * this exact command in this workspace until Kylo restarts.
 */
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldAlert, Loader2 } from "lucide-react";
import { fill, useLocaleChunk, useT } from "@/i18n";
import { terminalsApi } from "@/lib/kyloApi";
import { useKyloEventsConnection, useKyloStore } from "@/store/kylo";

export function KyloApprovalDialog() {
  useKyloEventsConnection();
  useLocaleChunk("kylo");
  const t = useT();
  const approvals = useKyloStore((s) => s.approvals);
  const current = approvals.length ? [...approvals].sort((a, b) => a.created_at - b.created_at)[0] : null;
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!current) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [current]);

  if (!current) return null;
  const decide = async (approved: boolean, always = false) => {
    setBusy(true);
    try {
      await terminalsApi.decide(current.id, approved, always);
    } catch {
      /* already resolved or expired — the event stream removes it */
    } finally {
      setBusy(false);
    }
    useKyloStore.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== current.id) }));
  };
  const remaining = Math.max(0, Math.round(current.expires_at - now));
  const command = (current.detail.command as string | undefined) ?? (current.detail.subject as string | undefined) ?? "";
  const rows: [string, string | undefined][] = [
    [t("kylo.approval.shell"), current.detail.shell as string | undefined],
    [t("kylo.approval.cwd"), current.detail.cwd as string | undefined],
    [t("kylo.approval.workspace"), current.workspace ?? undefined],
  ];

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && void decide(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-background/70 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="kylo-approval-dialog"
          className="fixed left-1/2 top-1/2 z-[130] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-2xl"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
              <ShieldAlert className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">{t("kylo.approval.title")}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">{current.title}</Dialog.Description>
            </div>
            {approvals.length > 1 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {fill(t("kylo.approval.queue"), { count: approvals.length })}
              </span>
            )}
          </div>
          <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-muted/40 px-3 py-2.5 font-mono text-sm">
            {command}
          </pre>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {rows
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate font-mono" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
          </dl>
          {current.reasons.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {current.reasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-amber-600 dark:text-amber-400">
                  <span aria-hidden>•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">
              {fill(t("kylo.approval.expires"), { seconds: remaining })}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(false)}
              className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
              data-testid="kylo-approval-deny"
            >
              {t("kylo.approval.deny")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(true, true)}
              className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              {t("kylo.approval.always")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              data-testid="kylo-approval-allow"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t("kylo.approval.allow_once")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
