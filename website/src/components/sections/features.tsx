import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CommandVisual,
  GitHubVisual,
  MemoryVisual,
  MultiTerminalVisual,
  ProvidersVisual,
  VoiceVisual,
} from "../mockups/feature-visuals";
import { Parallax } from "../ui/parallax";
import { Reveal } from "../ui/reveal";
import { Section, SectionHeader } from "../ui/section";

type Feature = {
  title: string;
  body: string;
  points: string[];
  visual: ReactNode;
};

const FEATURES: Feature[] = [
  {
    title: "AI Command Execution",
    body: "Convert natural-language requests into terminal commands and execute them with user-controlled permissions.",
    points: ["Shows the exact command before it runs", "Asks first for anything that deletes or installs", "Explains output in plain language"],
    visual: <CommandVisual />,
  },
  {
    title: "Multi-Terminal Intelligence",
    body: "Work across PowerShell, CMD, WSL, Linux, and user-selected terminals, each in its own live session.",
    points: ["Runs long tasks side by side", "Picks the right shell for each step", "Every session stays open for you to inspect"],
    visual: <MultiTerminalVisual />,
  },
  {
    title: "Persistent Memory",
    body: "Remember project context, preferences, and previous workflows across sessions, so you don't explain twice.",
    points: ["Notes you can read, edit, and delete", "Recalls how each project is built and run", "Learns the shells and tools you prefer"],
    visual: <MemoryVisual />,
  },
  {
    title: "GitHub Workflows",
    body: "Use the GitHub CLI to manage repositories, issues, pull requests, branches, and commits from a single request.",
    points: ["Branch, commit, and open a PR in one ask", "Triage issues and review checks", "Uses your existing gh login"],
    visual: <GitHubVisual />,
  },
  {
    title: "Voice Interaction",
    body: "Speak commands and talk things through with Kylo, then watch the work happen in the terminal.",
    points: ["Your own wake phrase", "Speech recognition that can run offline", "Switch between voice and text anytime"],
    visual: <VoiceVisual />,
  },
  {
    title: "AI Provider Freedom",
    body: "Connect the AI providers you already use with your own API keys, or run a local model with no key at all.",
    points: ["Anthropic, OpenAI, Gemini, OpenRouter, Groq and more", "Local models through Ollama or any OpenAI-compatible server", "Pick a default and switch per task"],
    visual: <ProvidersVisual />,
  },
];

export function Features() {
  return (
    <Section id="features">
      <SectionHeader
        eyebrow="Features"
        title="Built for real work on a real machine."
        aside="Not another chat window."
      />

      <div className="mt-16 md:mt-24">
        {FEATURES.map((f, i) => (
          <article
            key={f.title}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)] items-center gap-10 border-t border-hairline py-14 md:gap-14 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20",
              i === FEATURES.length - 1 && "pb-0 md:pb-0",
            )}
          >
            <Reveal className={cn(i % 2 === 1 && "lg:order-2")}>
              <p className="font-mono text-[11px] tracking-[0.14em] text-faint">{String(i + 1).padStart(2, "0")} / 06</p>
              <h3 className="mt-5 text-[1.75rem] font-medium leading-tight tracking-[-0.025em] text-ink md:text-4xl">{f.title}</h3>
              <p className="mt-4 max-w-md text-pretty text-base leading-relaxed text-body md:text-[1.0625rem]">{f.body}</p>
              <ul className="mt-8 space-y-3">
                {f.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-[0.9375rem] text-ink-soft">
                    <Check className="mt-1 size-3.5 shrink-0 text-muted" strokeWidth={2} />
                    {p}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Parallax className={cn(i % 2 === 1 && "lg:order-1")}>
              <Reveal delay={0.1} y={32}>
                {f.visual}
              </Reveal>
            </Parallax>
          </article>
        ))}
      </div>
    </Section>
  );
}
