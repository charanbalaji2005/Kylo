"use client";

import { Download, Github, BookOpen, Check } from "lucide-react";
import { site } from "@/lib/site";
import { Section } from "@/components/ui/section";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { WindowsIcon } from "@/components/icons";

export function DownloadSection() {
  return (
    <Section id="download" innerClassName="text-center">
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <Eyebrow className="justify-center">Get Started Today</Eyebrow>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-6 text-display font-medium text-ink">
            Start coding with Kylo.
          </h2>
        </Reveal>

        <Reveal delay={0.2}>
          <p className="mx-auto mt-6 max-w-xl text-balance text-base text-body md:text-lg">
            Free, open source, and ready for your desktop. Download the Windows installer or clone the repository to run from source.
          </p>
        </Reveal>

        <Reveal delay={0.3}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <ButtonLink href={site.links.downloadWindows} size="lg" external>
              <WindowsIcon className="size-4" />
              <span>Download for Windows (.exe)</span>
            </ButtonLink>

            <ButtonLink href={site.links.github} variant="secondary" size="lg" external>
              <Github className="size-4" />
              <span>GitHub Repository</span>
            </ButtonLink>
          </div>
        </Reveal>

        <Reveal delay={0.4} className="mt-12">
          <div className="inline-flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-full border border-hairline bg-surface/70 px-6 py-3 font-mono text-xs text-muted">
            <span className="flex items-center gap-2">
              <Check className="size-3.5 text-ink" /> Windows 10 & 11 x64
            </span>
            <span className="flex items-center gap-2">
              <Check className="size-3.5 text-ink" /> Signed Installer
            </span>
            <span className="flex items-center gap-2">
              <Check className="size-3.5 text-ink" /> Apache 2.0 License
            </span>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
