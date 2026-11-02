"use client";

import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { navItems, site } from "@/lib/site";
import { cn } from "@/lib/utils";
import { KyloWordmark } from "../kylo-logo";
import { GithubIcon } from "../icons";
import { ButtonLink } from "../ui/button";

export function Navbar() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled || open
          ? "border-hairline bg-canvas/70 backdrop-blur-xl backdrop-saturate-150"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="frame flex h-16 items-center justify-between gap-6 px-1 sm:px-4">
        <a href="#top" aria-label="Kylo home" className="rounded-sm">
          <KyloWordmark />
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-8 text-sm font-medium md:flex">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              {...("external" in item && item.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              className="text-body transition-colors duration-200 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
          <a
            href={site.links.github}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-body transition-colors duration-200 hover:text-ink"
          >
            <GithubIcon className="size-4" />
            GitHub
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink href="#download" size="sm" className="max-sm:hidden">
            Download
          </ButtonLink>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full text-ink md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.nav
            aria-label="Mobile"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-hairline md:hidden"
          >
            <div className="frame flex flex-col py-3">
              {[...navItems, { label: "GitHub", href: site.links.github, external: true }].map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  {...("external" in item && item.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                  className="flex items-center justify-between border-b border-hairline-soft py-3.5 text-[0.9375rem] text-body last:border-0 hover:text-ink"
                >
                  {item.label}
                  {"external" in item && item.external ? <ArrowUpRight className="size-4" /> : null}
                </a>
              ))}
              <ButtonLink href="#download" onClick={() => setOpen(false)} className="mt-3 w-full" size="lg">
                Download for Windows
              </ButtonLink>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
