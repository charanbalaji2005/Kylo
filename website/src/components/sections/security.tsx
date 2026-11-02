import { Eye, HardDrive, History, KeyRound, ShieldQuestion, UserCheck } from "lucide-react";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";
import { AppWindow } from "../mockups/window";
import { Reveal } from "../ui/reveal";
import { Section, SectionHeader } from "../ui/section";

const PILLARS = [
  {
    icon: UserCheck,
    title: "User-controlled execution",
    body: "You decide which actions Kylo may take on its own and which always need you.",
  },
  {
    icon: ShieldQuestion,
    title: "Permission prompts",
    body: "Sensitive actions pause with the exact command and arguments until you allow or deny them.",
  },
  {
    icon: Eye,
    title: "Transparent output",
    body: "Every command runs in a visible terminal. You can always open the full, unedited output.",
  },
  {
    icon: History,
    title: "Execution history",
    body: "Each run is recorded with its command, shell, decision, and result, so you can review it later.",
  },
  {
    icon: HardDrive,
    title: "Local terminal access",
    body: "Commands run on your computer, in your shells, under your user account. Not on someone else's server.",
  },
  {
    icon: KeyRound,
    title: "User-managed API keys",
    body: "You bring the keys, you choose the provider, and you can remove them at any time.",
  },
];

const HISTORY = [
  { time: "14:02:11", cmd: "git status", shell: "PowerShell", tier: "Safe", result: "exit 0" },
  { time: "14:02:19", cmd: "npm install", shell: "PowerShell", tier: "Ask", result: "allowed · exit 0" },
  { time: "14:03:40", cmd: "docker compose up -d", shell: "WSL", tier: "Monitor", result: "exit 0" },
  { time: "14:05:02", cmd: "Remove-Item C:\\dev\\old -Recurse", shell: "PowerShell", tier: "Ask", result: "denied by you" },
  { time: "14:05:31", cmd: "format D:", shell: "CMD", tier: "Block", result: "refused" },
];

export function Security() {
  return (
    <Section id="security">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-end">
        <SectionHeader eyebrow="Security" title="Your machine." aside="Your control." />
        <Reveal delay={0.1}>
          <p className="max-w-md text-pretty text-base leading-relaxed text-body lg:ml-auto">
            Kylo runs real commands with your account&apos;s permissions, so it is built to show its work. Each action is
            classed as safe, monitored, ask-first, or blocked before it runs.{" "}
            <a
              href={site.links.security}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ink underline decoration-hairline-strong underline-offset-4 transition-colors hover:decoration-ink"
            >
              Read the security policy
            </a>
          </p>
        </Reveal>
      </div>

      <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 md:mt-20 lg:grid-cols-3">
        {PILLARS.map(({ icon: Icon, title, body }, i) => (
          <Reveal
            key={title}
            delay={(i % 3) * 0.06}
            y={12}
            className="group bg-canvas p-7 transition-colors duration-300 hover:bg-surface md:p-8"
          >
            <Icon className="size-5 text-ink transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={1.5} />
            <h3 className="mt-8 text-[1.0625rem] font-medium tracking-[-0.01em] text-ink">{title}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">{body}</p>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-10 md:mt-14">
        <AppWindow title="Kylo — Execution history" bodyClassName="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              <tr className="border-b border-hairline">
                <th className="px-5 py-3 font-normal">Time</th>
                <th className="px-5 py-3 font-normal">Command</th>
                <th className="px-5 py-3 font-normal">Shell</th>
                <th className="px-5 py-3 font-normal">Gate</th>
                <th className="px-5 py-3 text-right font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {HISTORY.map((row) => (
                <tr key={row.time} className="border-b border-hairline-soft last:border-0">
                  <td className="px-5 py-3 font-mono text-[11px] text-faint">{row.time}</td>
                  <td className="px-5 py-3 font-mono text-[11.5px] text-ink">{row.cmd}</td>
                  <td className="px-5 py-3 text-muted">{row.shell}</td>
                  <td className="px-5 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px]",
                        row.tier === "Safe" && "border-hairline text-muted",
                        row.tier === "Monitor" && "border-hairline-strong text-body",
                        row.tier === "Ask" && "border-ink text-ink",
                        row.tier === "Block" && "border-ink bg-ink text-canvas",
                      )}
                    >
                      {row.tier}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-body">{row.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AppWindow>
      </Reveal>
    </Section>
  );
}
