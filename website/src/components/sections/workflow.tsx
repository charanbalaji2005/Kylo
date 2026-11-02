"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Eye, ListChecks, MessageSquareText, SquareTerminal } from "lucide-react";
import { Reveal } from "../ui/reveal";
import { Section, SectionHeader } from "../ui/section";

const STAGES = [
  { icon: MessageSquareText, label: "Ask", body: "Say or type what you want done." },
  { icon: ListChecks, label: "Plan", body: "Kylo lays out the steps and the exact commands." },
  { icon: SquareTerminal, label: "Execute", body: "Commands run in your terminal, with approvals." },
  { icon: Eye, label: "Review", body: "Read the summary, then the full output if you want it." },
];

export function Workflow() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 55%"] });
  const progress = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0, 1]);

  return (
    <Section id="workflow">
      <SectionHeader
        eyebrow="Workflow"
        title="Ask. Plan. Execute. Review."
        align="center"
        lede="The same four beats for every task, from renaming a folder to shipping a release."
      />

      <div ref={ref} className="relative mt-16 md:mt-24">
        {/* Connector: horizontal on desktop, vertical on mobile. It fills as you scroll. */}
        <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-8 hidden h-px bg-hairline md:block">
          <motion.div style={{ scaleX: progress }} className="h-full origin-left bg-ink" />
        </div>
        <div aria-hidden className="absolute bottom-8 left-8 top-8 w-px bg-hairline md:hidden">
          <motion.div style={{ scaleY: progress }} className="h-full w-full origin-top bg-ink" />
        </div>

        <ol className="relative grid gap-10 md:grid-cols-4 md:gap-6">
          {STAGES.map(({ icon: Icon, label, body }, i) => (
            <li key={label}>
              <Reveal delay={i * 0.12} y={16} className="flex items-center gap-6 md:flex-col md:text-center">
                <span className="relative grid size-16 shrink-0 place-items-center rounded-full border border-hairline-strong bg-canvas transition-colors duration-300 hover:border-ink">
                  <Icon className="size-5 text-ink" strokeWidth={1.5} />
                  <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-ink font-mono text-[9px] font-medium text-canvas">
                    {i + 1}
                  </span>
                </span>
                <span className="md:mt-6">
                  <span className="block text-xl font-medium tracking-[-0.015em] text-ink">{label}</span>
                  <span className="mt-1.5 block text-[0.9375rem] leading-relaxed text-body md:mx-auto md:max-w-[14rem]">
                    {body}
                  </span>
                </span>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
