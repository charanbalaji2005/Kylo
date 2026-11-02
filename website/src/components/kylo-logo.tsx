import { cn } from "@/lib/utils";

type KyloMarkProps = {
  className?: string;
  title?: string;
};

/** The Kylo mark, drawn from the official brand assets. */
export function KyloMark({ className, title = "Kylo" }: KyloMarkProps) {
  return (
    <img
      src="/kylo-mark-256.png"
      alt={title}
      className={cn("size-6 shrink-0 object-contain", className)}
      loading="eager"
    />
  );
}

/** The Kylo wordmark, using the official brand logo. */
export function KyloWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <img
        src="/kylo-logo.png"
        alt="Kylo"
        className="h-7 w-auto object-contain"
        loading="eager"
      />
    </span>
  );
}

