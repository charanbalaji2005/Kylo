import { site } from "@/lib/site";
import { KyloWordmark } from "@/components/kylo-logo";

export function Footer() {
  return (
    <footer className="border-t border-hairline bg-surface/50 py-16">
      <div className="frame px-5 sm:px-10 lg:px-16">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div>
            <KyloWordmark className="text-xl" />
            <p className="mt-3 text-xs leading-relaxed text-muted max-w-sm">
              Open source agent operating system for your desktop. Built for modern developers.
            </p>
          </div>

          <div className="flex flex-wrap gap-8 text-xs font-medium text-body">
            <a href="#product" className="transition-colors hover:text-ink">
              Product
            </a>
            <a href="#features" className="transition-colors hover:text-ink">
              Features
            </a>
            <a href={site.links.docs} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
              Documentation
            </a>
            <a href={site.links.github} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
              GitHub
            </a>
            <a href={site.links.releases} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
              Releases
            </a>
            <a href={site.links.license} target="_blank" rel="noreferrer" className="transition-colors hover:text-ink">
              License (Apache 2.0)
            </a>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-hairline pt-8 text-[11px] text-faint sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Kylo Contributors. All rights reserved.</p>
          <p>Built with Next.js & Tailwind CSS.</p>
        </div>
      </div>
    </footer>
  );
}
