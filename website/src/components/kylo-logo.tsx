import { cn } from "@/lib/utils";

type KyloMarkProps = {
  className?: string;
  /** Accessible name; omit when the mark sits next to visible "Kylo" text. */
  title?: string;
  /** Use on light surfaces: inverts the white mark to black. */
  onLight?: boolean;
};

/**
 * The official Kylo K mark. public/kylo-mark.png is the white ink of
 * public/kylo-mark-256.png on a transparent background, so it sits on any surface.
 */
export function KyloMark({ className, title, onLight = false }: KyloMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer
    <img
      src="/kylo-mark.png"
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      width={256}
      height={256}
      draggable={false}
      className={cn(
        "size-6 shrink-0 select-none object-contain",
        onLight && "invert",
        className,
      )}
    />
  );
}

/** Mark, hairline divider, and spaced caps: the same lockup as public/kylo-logo.png. */
export function KyloWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3 text-ink", className)}>
      <KyloMark className="size-7" />
      <span aria-hidden className="h-5 w-px bg-hairline-strong" />
      <span className="text-[0.9375rem] font-medium tracking-[0.32em]">KYLO</span>
    </span>
  );
}
