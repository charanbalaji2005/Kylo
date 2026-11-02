import type { Metadata } from "next";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: `${site.name} — ${site.tagline}`,
  description: site.description,
  icons: {
    icon: "/favicon.ico",
    shortcut: "/kylo-mark-256.png",
    apple: "/kylo-mark-256.png",
  },
  openGraph: {
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    siteName: site.name,
    images: [{ url: "/kylo-logo.png", width: 1024, height: 512, alt: "Kylo Logo" }],
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-canvas text-ink antialiased selection:bg-white selection:text-black">
        {children}
      </body>
    </html>
  );
}
