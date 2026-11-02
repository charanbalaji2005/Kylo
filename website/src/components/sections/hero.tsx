"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { site } from "@/lib/site";
import { GithubIcon, WindowsIcon } from "../icons";
import { HeroApp } from "../mockups/hero-app";
import { ButtonLink } from "../ui/button";
import { EASE_OUT } from "../ui/reveal";

const LINES = [
  { text: "Your computer.", tone: "text-muted" },
  { text: "Your commands.", tone: "text-muted" },
  { text: "Your AI.", tone: "text-ink" },
];

const FACTS = ["Windows 10 & 11", "PowerShell · CMD · WSL", "Voice or text", "Your own API keys"];

export function Hero() {
  const reduce = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stageRef, offset: ["start end", "end start"] });
  const rotateX = useTransform(scrollYProgress, [0, 0.45], [reduce ? 0 : 14, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.45], [reduce ? 1 : 0.94, 1]);
  const y = useTransform(scrollYProgress, [0.45, 1], [0, reduce ? 0 : -60]);

  const fade = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.9, ease: EASE_OUT, delay },
        };

  return (
    <section id="top" className="relative pt-16">
      <div className="frame frame-rules">
        <div className="flex flex-col items-center px-5 pb-16 pt-20 text-center sm:px-10 md:pt-28 lg:pt-32">
          <motion.p
            {...fade(0)}
            className="inline-flex items-center gap-2.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 font-mono text-eyebrow uppercase text-body"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-ink/60" />
              <span className="relative size-1.5 rounded-full bg-ink" />
            </span>
            AI agent for your desktop
          </motion.p>

          <h1 className="mt-10 text-display font-medium">
            {LINES.map((line, i) => (
              <span key={line.text} className="block overflow-hidden pb-[0.08em]">
                <motion.span
                  className={`block ${line.tone}`}
                  initial={reduce ? false : { y: "105%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.1 + i * 0.12 }}
                >
                  {line.text}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p
            {...fade(0.5)}
            className="mt-8 max-w-[38rem] text-pretty text-base leading-relaxed text-body md:text-lg"
          >
            {site.description}
          </motion.p>

          <motion.div {...fade(0.62)} className="mt-10 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            <ButtonLink href="#download" size="lg" className="w-full sm:w-auto">
              <WindowsIcon />
              Download for Windows
            </ButtonLink>
            <ButtonLink href={site.links.github} external variant="secondary" size="lg" className="w-full sm:w-auto">
              <GithubIcon />
              Explore on GitHub
              <ArrowRight className="transition-transform duration-200 group-hover/btn:translate-x-0.5" />
            </ButtonLink>
          </motion.div>
        </div>
      </div>

      {/* Product stage */}
      <div className="rule-top relative">
        <div className="frame frame-rules corner-marks">
          <div ref={stageRef} className="relative overflow-hidden px-3 py-10 sm:px-8 md:py-16 lg:px-14" style={{ perspective: 1600 }}>
            <div
              aria-hidden
              className="dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
            />
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, ease: EASE_OUT, delay: 0.7 }}
            >
              <motion.div style={{ rotateX, scale, y, transformOrigin: "50% 0%" }} className="relative">
                <HeroApp />
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>

      <div className="rule-top">
        <div className="frame frame-rules">
          <ul className="grid grid-cols-2 md:grid-cols-4">
            {FACTS.map((fact, i) => (
              <li
                key={fact}
                className={`border-hairline px-5 py-5 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-muted ${
                  i % 2 === 1 ? "border-l" : ""
                } ${i >= 2 ? "max-md:border-t" : ""} ${i === 2 ? "md:border-l" : ""}`}
              >
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
