import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});
// Carried by the material badge alone, where tabular figures have to line up.
const numeric = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const SITE = "https://sixtyfour-liart.vercel.app";
const DESCRIPTION = "A very small chess game. Play the bot at three difficulties.";

export const metadata: Metadata = {
  // Without this, Next resolves relative Open Graph URLs against localhost and every
  // shared link points somewhere private.
  metadataBase: new URL(SITE),
  title: "sixtyfour",
  description: DESCRIPTION,
  applicationName: "sixtyfour",
  authors: [{ name: "Sanyam Punia", url: "https://sanyam.sh" }],
  creator: "Sanyam Punia",
  keywords: ["chess", "chess game", "play chess", "chess bot", "minimal"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "sixtyfour",
    title: "sixtyfour",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "sixtyfour",
    description: DESCRIPTION,
    creator: "@sanyampunia",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfb" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0f" },
  ],
};

/**
 * Runs before the first paint, so a player who chose dark never sees a light flash. It is
 * inline and blocking on purpose: any deferred version paints the wrong theme first.
 */
const RESTORE_THEME = `try{var t=localStorage.getItem("sixtyfour-theme");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

/*
 * The theme is written by the script above, before React hydrates, so the root element is
 * guaranteed to differ from whatever the server sent. That is the mismatch React reports
 * and refuses to patch up, and `suppressHydrationWarning` is the documented answer for an
 * element deliberately mutated before hydration.
 *
 * It only covers this element's own attributes, one level deep, so it cannot hide a real
 * mismatch inside the tree.
 *
 * `data-theme` is also left out of the JSX. Removing it alone does not silence React,
 * which was worth checking, but it does leave the script as the attribute's only owner.
 * Light needs no attribute either way: the light tokens are the bare `:root` values, so
 * the page is correct with JavaScript disabled.
 */

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${numeric.variable} h-full antialiased`}
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a static string with no interpolation, and it has to run before paint */}
        <script dangerouslySetInnerHTML={{ __html: RESTORE_THEME }} />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
