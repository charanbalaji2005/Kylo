import { site } from "@/lib/site";
import { GithubIcon } from "../icons";
import { KyloWordmark } from "../kylo-logo";

type FooterLink = { label: string; href: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#product" },
      { label: "Terminals", href: "#terminals" },
      { label: "Features", href: "#features" },
      { label: "Security", href: "#security" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: site.links.docs },
      { label: "Releases", href: site.links.releases },
      { label: "Changelog", href: site.links.changelog },
      { label: "Security policy", href: site.links.security },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: site.links.github },
      { label: "Discussions", href: site.links.discussions },
      { label: "Issues", href: site.links.issues },
      { label: "Contributing", href: site.links.contributing },
    ],
  },
];

const isExternal = (href: string) => href.startsWith("http");

export function Footer() {
  return (
    <footer className="rule-top">
      <div className="frame frame-rules corner-marks">
        <div className="grid gap-12 px-5 py-16 sm:px-10 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] md:py-20 lg:px-16">
          <div>
            <a href="#top" aria-label="Back to top" className="inline-block">
              <KyloWordmark />
            </a>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-body">
              The AI desktop agent for your terminals, files, and development environment.
            </p>
            <a
              href={site.links.github}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Kylo on GitHub"
              className="mt-6 inline-grid size-9 place-items-center rounded-full border border-hairline text-body transition-colors hover:border-hairline-strong hover:text-ink"
            >
              <GithubIcon className="size-4" />
            </a>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="font-mono text-eyebrow uppercase text-faint">{col.title}</p>
              <ul className="mt-5 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(isExternal(link.href) ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                      className="text-sm text-body transition-colors hover:text-ink"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline px-5 py-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-16">
          <p>© {new Date().getFullYear()} Kylo contributors.</p>
          <p className="flex gap-5">
            <a href={site.links.license} target="_blank" rel="noreferrer noopener" className="transition-colors hover:text-ink">
              Apache 2.0 License
            </a>
            <a href={site.links.releases} target="_blank" rel="noreferrer noopener" className="transition-colors hover:text-ink">
              Releases
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
