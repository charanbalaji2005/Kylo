"use client";

import Link from "next/link";
import { Github, Download } from "lucide-react";
import { site, navItems } from "@/lib/site";
import { KyloWordmark } from "@/components/kylo-logo";
import { ButtonLink } from "@/components/ui/button";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-hairline/80 bg-canvas/80 backdrop-blur-md">
      <div className="frame flex h-16 items-center justify-between px-5 sm:px-10 lg:px-16">
        <Link href="/" className="transition-opacity hover:opacity-90">
          <KyloWordmark className="text-xl" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              {...("external" in item && item.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              className="text-sm font-medium text-body transition-colors hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <ButtonLink
            href={site.links.github}
            variant="ghost"
            size="sm"
            external
            aria-label="GitHub Repository"
          >
            <Github className="size-4" />
            <span className="hidden sm:inline">GitHub</span>
          </ButtonLink>

          <ButtonLink
            href={site.links.downloadWindows}
            variant="primary"
            size="sm"
            external
          >
            <Download className="size-3.5" />
            <span>Download</span>
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
