import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";
import { Reveal } from "./reveal";

type SectionProps = {
  id?: string;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  /** Draw the horizontal rule and corner squares at the top of the section. */
  ruled?: boolean;
};

/** One band of the page: a full-width rule, then the framed content column. */
export function Section({ id, children, className, innerClassName, ruled = true }: SectionProps) {
  return (
    <section id={id} className={cn("relative", ruled && "rule-top", className)}>
      <div className={cn("frame frame-rules", ruled && "corner-marks")}>
        <div className={cn("px-5 py-20 sm:px-10 md:py-28 lg:px-16 lg:py-32", innerClassName)}>
          {children}
        </div>
      </div>
    </section>
  );
}

type SectionHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  /** Second line of the headline, set in the secondary ink. */
  aside?: ReactNode;
  lede?: ReactNode;
  align?: "left" | "center";
  className?: string;
};

export function SectionHeader({ eyebrow, title, aside, lede, align = "left", className }: SectionHeaderProps) {
  const centered = align === "center";
  return (
    <Reveal className={cn("max-w-3xl", centered && "mx-auto text-center", className)}>
      <Eyebrow className={cn(centered && "justify-center")}>{eyebrow}</Eyebrow>
      <h2 className="mt-6 text-balance text-headline font-medium text-ink">
        {title}
        {aside ? <span className="block text-muted">{aside}</span> : null}
      </h2>
      {lede ? (
        <p className={cn("mt-6 max-w-xl text-pretty text-base leading-relaxed text-body md:text-lg", centered && "mx-auto")}>
          {lede}
        </p>
      ) : null}
    </Reveal>
  );
}
