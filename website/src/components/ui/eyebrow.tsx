import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Mono, letter-spaced caps label that sits above a headline. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2.5 font-mono text-eyebrow font-medium uppercase text-body",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 bg-ink" />
      {children}
    </p>
  );
}
