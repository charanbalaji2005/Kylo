/**
 * Every outbound link on the site lives here so it can be changed in one place.
 * Replace a URL below and every button, nav item and footer link follows.
 */
const REPO = "https://github.com/charanbalaji2005/Kylo";

export const site = {
  name: "Kylo",
  tagline: "AI agent for your desktop",
  description:
    "Kylo is your personal AI desktop agent. Describe what you want to do, and Kylo gets to work across your terminals, files, and development environment.",
  url: "https://kylo.example.com", // Placeholder: set to the production domain.
  links: {
    github: REPO,
    releases: `${REPO}/releases`,
    downloadWindows: `${REPO}/releases/latest`,
    docs: `${REPO}/tree/main/docs`,
    installDocs: `${REPO}/blob/main/docs/desktop-installers.md`,
    setupDocs: `${REPO}/blob/main/README.md`,
    security: `${REPO}/blob/main/SECURITY.md`,
    license: `${REPO}/blob/main/LICENSE`,
    issues: `${REPO}/issues`,
    discussions: `${REPO}/discussions`,
    changelog: `${REPO}/blob/main/CHANGELOG.md`,
    contributing: `${REPO}/blob/main/CONTRIBUTING.md`,
  },
} as const;

export const navItems = [
  { label: "Product", href: "#product" },
  { label: "Features", href: "#features" },
  { label: "Documentation", href: site.links.docs, external: true },
] as const;
