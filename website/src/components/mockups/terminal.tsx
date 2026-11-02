import { cn } from "@/lib/utils";

export type Shell = "powershell" | "cmd" | "wsl" | "custom";

export type TermLine =
  | { kind: "cmd"; text: string; shell?: Shell; cwd?: string }
  | { kind: "out"; text: string; tone?: "dim" | "strong" | "default" }
  | { kind: "blank" };

const prompts: Record<Shell, (cwd: string) => string> = {
  powershell: (cwd) => `PS ${cwd}>`,
  cmd: (cwd) => `${cwd}>`,
  wsl: (cwd) => `dev@ubuntu:${cwd}$`,
  custom: (cwd) => `${cwd} ❯`,
};

const defaultCwd: Record<Shell, string> = {
  powershell: "C:\\dev\\acme-web",
  cmd: "C:\\dev\\acme-web",
  wsl: "~/acme-web",
  custom: "~/acme-web",
};

export function Prompt({ shell, cwd }: { shell: Shell; cwd?: string }) {
  return <span className="text-muted">{prompts[shell](cwd ?? defaultCwd[shell])}</span>;
}

/** Renders a list of terminal lines in monospace; used by static and animated terminals. */
export function TerminalLines({
  lines,
  shell = "powershell",
  cursor = false,
  className,
}: {
  lines: TermLine[];
  shell?: Shell;
  cursor?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("font-mono text-[11px] leading-[1.7] text-ink-soft", className)}>
      {lines.map((line, i) => {
        if (line.kind === "blank") return <div key={i} className="h-[1.7em]" />;
        if (line.kind === "cmd") {
          return (
            <div key={i} className="whitespace-pre-wrap break-all">
              <Prompt shell={line.shell ?? shell} cwd={line.cwd} /> <span className="text-ink">{line.text}</span>
            </div>
          );
        }
        return (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words",
              line.tone === "dim" && "text-faint",
              line.tone === "strong" && "text-ink",
              (!line.tone || line.tone === "default") && "text-body",
            )}
          >
            {line.text}
          </div>
        );
      })}
      {cursor ? <span aria-hidden className="inline-block h-[1.1em] w-[0.55em] translate-y-[2px] animate-blink bg-ink" /> : null}
    </div>
  );
}
