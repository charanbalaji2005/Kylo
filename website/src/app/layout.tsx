import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const title = `${site.name} — AI agent for your desktop`;

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title,
  description: site.description,
  icons: {
    icon: [{ url: "/favicon.ico" }, { url: "/kylo-mark-256.png", type: "image/png" }],
    apple: "/kylo-mark-256.png",
  },
  openGraph: {
    title,
    description: site.description,
    siteName: site.name,
    type: "website",
    images: [{ url: "/kylo-mark-256.png", width: 256, height: 256, alt: "Kylo" }],
  },
  twitter: { card: "summary", title, description: site.description },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
