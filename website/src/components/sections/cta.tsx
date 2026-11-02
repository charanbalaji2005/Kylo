import { ArrowRight } from "lucide-react";
import { site } from "@/lib/site";
import { KyloMark } from "../kylo-logo";
import { buttonVariants } from "../ui/button";
import { Reveal } from "../ui/reveal";
import { cn } from "@/lib/utils";

/** Closing call to action, set in reverse: black ink on a white panel. */
export function Cta() {
  return (
    <section className="rule-top">
      <div className="frame frame-rules corner-marks">
        <div className="p-3 sm:p-6 lg:p-8">
          <Reveal className="relative overflow-hidden rounded-2xl bg-ink px-6 py-16 text-center text-canvas sm:px-10 md:py-24">
            <KyloMark onLight className="mx-auto size-14" />
            <h2 className="mx-auto mt-8 max-w-3xl text-balance text-headline font-medium">
              Tell your computer what to do.
              <span className="block text-zinc-500">Kylo takes it from there.</span>
            </h2>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="#download"
                className={cn(buttonVariants({ size: "lg" }), "w-full bg-canvas text-ink hover:bg-zinc-800 sm:w-auto")}
              >
                Download for Windows
              </a>
              <a
                href={site.links.docs}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  buttonVariants({ size: "lg", variant: "secondary" }),
                  "w-full border-zinc-300 text-canvas hover:border-canvas hover:bg-black/[0.04] sm:w-auto",
                )}
              >
                Read the docs
                <ArrowRight className="transition-transform duration-200 group-hover/btn:translate-x-0.5" />
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
