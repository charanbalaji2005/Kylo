import type { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { KyloMark } from "../kylo-logo";

type AppWindowProps = {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Show the Kylo mark beside the title. */
  branded?: boolean;
};

/** A Windows-style desktop window frame used by every product mockup. */
export function AppWindow({ title, children, className, bodyClassName, branded = true }: AppWindowProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-hairline bg-surface text-left shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.02)]",
        className,
      )}
    >
      <div className="flex h-9 items-center justify-between border-b border-hairline bg-panel pl-3.5 text-[11px] text-muted">
        <div className="flex min-w-0 items-center gap-2">
          {branded ? <KyloMark className="size-3.5 text-ink" /> : null}
          <span className="truncate font-medium text-body">{title}</span>
        </div>
        <div aria-hidden className="flex h-full items-stretch">
          {[Minus, Square, X].map((Icon, i) => (
            <span key={i} className="grid w-10 place-items-center text-faint">
              <Icon className={i === 1 ? "size-2.5" : "size-3"} strokeWidth={1.5} />
            </span>
          ))}
        </div>
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

/** A small, square-cornered status chip used inside mockups. */
export function Chip({ children, className, active }: { children: ReactNode; className?: string; active?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] leading-none",
        active ? "border-hairline-strong bg-elevated text-ink" : "border-hairline text-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
