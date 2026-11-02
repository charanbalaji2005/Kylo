"use client";

import { useState } from "react";
import { ArrowUpRight, BookOpen, Check, Copy, Download } from "lucide-react";
import { site } from "@/lib/site";
import { GithubIcon, WindowsIcon } from "../icons";
import { ButtonLink } from "../ui/button";
import { Reveal } from "../ui/reveal";
import { Section, SectionHeader } from "../ui/section";

const INSTALL_COMMAND =
  "irm https://raw.githubusercontent.com/charanbalaji2005/Kylo/main/install/install.ps1 | iex";

const STEPS = [
  { title: "Download Kylo", body: "Grab the Windows installer, or run the one-line PowerShell command below." },
  { title: "Open the app", body: "The installer launches Kylo. Pick your language, voice, and default terminal." },
  { title: "Add a provider", body: "Paste an API key for the provider you use, or point Kylo at a local model." },
  { title: "Ask for something", body: "Type or say your first request. Kylo shows the plan before anything runs." },
];

const RESOURCES = [
  { icon: BookOpen, label: "Setup guide", href: site.links.setupDocs },
  { icon: Download, label: "Installer guide", href: site.links.installDocs },
  { icon: GithubIcon, label: "GitHub repository", href: site.links.github },
];

export function Install() {
  return (
    <Section id="download">
      <SectionHeader
        eyebrow="Get started"
        title="Bring Kylo to your desktop."
        lede="Free and open source. Set up in a few minutes, with nothing to install first."
      />

      <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-6 md:mt-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        {/* Download card */}
        <Reveal className="flex flex-col rounded-xl border border-hairline bg-surface p-7 md:p-9">
          <div className="flex items-center gap-4">
            <span className="grid size-12 place-items-center rounded-xl border border-hairline-strong bg-raised">
              <WindowsIcon className="size-5 text-ink" />
            </span>
            <div>
              <p className="text-lg font-medium tracking-[-0.01em] text-ink">Kylo for Windows</p>
              <p className="font-mono text-[11px] text-muted">Windows 10 & 11 · x64</p>
            </div>
          </div>
          <p className="mt-6 text-[0.9375rem] leading-relaxed text-body">
            Includes the desktop app, terminal integrations for PowerShell, CMD, and WSL, and voice support.
          </p>
          <ButtonLink href={site.links.downloadWindows} external size="lg" className="mt-8 w-full">
            <Download />
            Download for Windows
          </ButtonLink>
          <a
            href={site.links.releases}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-4 inline-flex items-center justify-center gap-1 text-sm text-body transition-colors hover:text-ink"
          >
            All releases and checksums <ArrowUpRight className="size-3.5" />
          </a>

          <div className="mt-8 border-t border-hairline pt-6 lg:mt-auto">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Or install from PowerShell</p>
            <CopyCommand command={INSTALL_COMMAND} />
          </div>
        </Reveal>

        {/* Steps + resources */}
        <Reveal delay={0.1} className="flex flex-col">
          <ol className="relative">
            <span aria-hidden className="absolute bottom-8 left-[15px] top-8 w-px bg-hairline" />
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative flex gap-5 pb-8 last:pb-0">
                <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border border-hairline-strong bg-canvas font-mono text-[11px] text-ink">
                  {i + 1}
                </span>
                <div className="pt-1">
                  <p className="text-[1.0625rem] font-medium text-ink">{s.title}</p>
                  <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-3 lg:mt-auto">
            {RESOURCES.map(({ icon: Icon, label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center justify-between gap-3 bg-canvas px-5 py-4 text-sm text-body transition-colors hover:bg-surface hover:text-ink"
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="size-4" />
                  {label}
                </span>
                <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
            ))}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be unavailable (insecure context, denied permission); the command stays selectable.
    }
  };

  return (
    <div className="mt-3 flex items-start gap-3 rounded-lg border border-hairline bg-canvas p-3">
      <code className="min-w-0 flex-1 break-all font-mono text-[11.5px] leading-relaxed text-ink-soft">
        <span className="select-none text-muted">PS&gt; </span>
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy install command"}
        className="grid size-8 shrink-0 place-items-center rounded-md border border-hairline text-body transition-colors hover:border-hairline-strong hover:text-ink"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
