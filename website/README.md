# Kylo website

The marketing landing page for Kylo: Next.js (App Router), TypeScript,
Tailwind CSS v4, Framer Motion and Lucide icons. It builds to a static site
(`output: "export"`), which Render serves from `website/out` (see the
`kylo-website` service in the repository's `render.yaml`).

## Develop

```bash
cd website
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run build      # static export into website/out
```

## Where things live

| Path | What |
|---|---|
| `src/lib/site.ts` | Every outbound link (download, docs, GitHub, releases). Change URLs here only. |
| `src/app/globals.css` | Design tokens: monochrome palette, display sizes, the ruled page frame. |
| `src/components/sections/` | One component per page section, in page order in `src/app/page.tsx`. |
| `src/components/mockups/` | Product UI mockups built in React (window chrome, terminals, the animated hero app). |
| `src/components/ui/` | Shared primitives: button, eyebrow, section shell, scroll reveal, parallax. |
| `public/kylo-mark.png` | The K mark on a transparent background, derived from `kylo-mark-256.png`. |

`site.url` in `src/lib/site.ts` is a placeholder; set it to the production
domain so Open Graph URLs resolve.
