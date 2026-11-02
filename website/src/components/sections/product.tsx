"use client";

import { Mic, Terminal, Shield, Layers, Cpu, Sparkles } from "lucide-react";
import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { AppWindow, Chip } from "@/components/mockups/window";
import { TerminalLines, type TermLine } from "@/components/mockups/terminal";

const VOICE_DEMO_LINES: TermLine[] = [
  { kind: "cmd", text: "kylo session --voice 'T1, review PR #42 and run the test suite'", shell: "powershell" },
  { kind: "out", text: "[Supervisor] Analyzing PR #42: 'Fix WebSocket reconnect backoff'", tone: "strong" },
  { kind: "out", text: "✓ Diff inspected: +24 lines, -8 lines across 2 files", tone: "dim" },
  { kind: "out", text: "⚡ Running pytest tests/contract/test_websocket.py...", tone: "default" },
  { kind: "out", text: "✓ 12 passed in 1.42s (100% test coverage preserved)", tone: "strong" },
  { kind: "cmd", text: "kylo reply --voice 'All checks are green. Merge ready.'", shell: "powershell" },
  { kind: "out", text: "[Spoken audio playback]: 'Tests passed cleanly on PR 42.'", tone: "dim" },
];

const IDE_DEMO_LINES: TermLine[] = [
  { kind: "cmd", text: "kylo ide --split=grid --agents=3", shell: "powershell" },
  { kind: "out", text: "[Agent Pane T1] Backend API: FastAPI + SQLite (Port 8000)", tone: "default" },
  { kind: "out", text: "[Agent Pane T2] Frontend: React 19 + Vite HMR (Port 5173)", tone: "default" },
  { kind: "out", text: "[Agent Pane T3] Test runner: vitest watch mode", tone: "default" },
  { kind: "out", text: "✓ Live bidirectional workspace sync enabled", tone: "strong" },
];

export function Product() {
  return (
    <Section id="product">
      <SectionHeader
        eyebrow="Agent OS Capabilities"
        title="Command your development environment."
        aside="Everything runs locally, with full agent autonomy."
        lede="Kylo bridges your code editor, terminals, voice hardware, and AI models into a unified desktop operating system."
      />

      <div className="mt-16 grid gap-10 lg:grid-cols-2">
        {/* Capability 1: Voice & Chat Control */}
        <Reveal className="flex flex-col justify-between rounded-2xl border border-hairline bg-surface p-6 sm:p-8">
          <div>
            <div className="flex size-10 items-center justify-center rounded-lg border border-hairline bg-panel text-ink">
              <Mic className="size-5" />
            </div>
            <h3 className="mt-6 text-xl font-medium text-ink">Code by talking or typing</h3>
            <p className="mt-2 text-sm leading-relaxed text-body">
              Spoken natural language turns into structured terminal commands, tests, and diffs. Kylo handles wake words, live speech-to-text, and audio responses.
            </p>
          </div>

          <div className="mt-8">
            <AppWindow title="Voice Session #18 — Agent T1" branded={false} bodyClassName="p-4 bg-panel">
              <TerminalLines lines={VOICE_DEMO_LINES} shell="powershell" />
            </AppWindow>
          </div>
        </Reveal>

        {/* Capability 2: Agentic IDE */}
        <Reveal delay={0.15} className="flex flex-col justify-between rounded-2xl border border-hairline bg-surface p-6 sm:p-8">
          <div>
            <div className="flex size-10 items-center justify-center rounded-lg border border-hairline bg-panel text-ink">
              <Terminal className="size-5" />
            </div>
            <h3 className="mt-6 text-xl font-medium text-ink">Multi-Agent Desktop IDE</h3>
            <p className="mt-2 text-sm leading-relaxed text-body">
              Split tasks across multiple coding agents running simultaneously. Each agent operates in its own sandboxed context, sharing live workspace state.
            </p>
          </div>

          <div className="mt-8">
            <AppWindow title="Agentic IDE — Multi-Pane Workspace" branded={false} bodyClassName="p-4 bg-panel">
              <TerminalLines lines={IDE_DEMO_LINES} shell="powershell" />
            </AppWindow>
          </div>
        </Reveal>
      </div>

      {/* Highlights Strip */}
      <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Reveal delay={0.2} className="rounded-xl border border-hairline bg-surface/50 p-6">
          <div className="flex items-center gap-3">
            <Cpu className="size-4 text-ink" />
            <h4 className="text-sm font-medium text-ink">Bring Your Own Models</h4>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-body">
            Use Claude 3.7, OpenAI GPT-4o, Groq Llama, or offline models via Ollama and local GPU acceleration.
          </p>
        </Reveal>

        <Reveal delay={0.25} className="rounded-xl border border-hairline bg-surface/50 p-6">
          <div className="flex items-center gap-3">
            <Shield className="size-4 text-ink" />
            <h4 className="text-sm font-medium text-ink">Zero Telemetry & Private</h4>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-body">
            Your codebase and credentials never leave your machine. No mandatory accounts or remote logging.
          </p>
        </Reveal>

        <Reveal delay={0.3} className="rounded-xl border border-hairline bg-surface/50 p-6">
          <div className="flex items-center gap-3">
            <Layers className="size-4 text-ink" />
            <h4 className="text-sm font-medium text-ink">Extensible Skills & Plugins</h4>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-body">
            Connect git, browser automation, Docker, Discord, Slack, and custom MCP tools with ease.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
