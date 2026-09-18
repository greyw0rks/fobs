import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Two fonts, self-hosted from `app/fonts/` rather than fetched at build time.
 *
 * The stylesheet has always asked for `Inter` without anything ever loading it,
 * so every glyph on every page has come from the OS default — which is why the
 * numbers in the feed do not line up. JetBrains Mono is here for the other half
 * of that problem: every price, share count, address and signature is set in it
 * with `tabular-nums`, so a column of figures is a column rather than a ragged
 * edge.
 *
 * These were `next/font/google` for about ten minutes. That version made the
 * build take **18 minutes**: the loader fetches the CSS and the woff2 files
 * during `next build`, and against this network it spent most of that time in
 * `read ETIMEDOUT` and `Retrying 1/3`. The fonts are now two committed woff2
 * files, which takes the network out of the build entirely — it is a fixed cost
 * of ~80 KB in the repo against a build that does not depend on whether Google
 * is reachable.
 *
 * Both are variable fonts covering 400–700, so `weight` declares a range rather
 * than a single cut. They expose themselves as CSS variables rather than
 * concrete families, so globals.css stays the only place that decides what
 * anything is set in.
 */
const inter = localFont({
  src: "./fonts/Inter.woff2",
  variable: "--font-sans",
  weight: "400 700",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"]
});

const mono = localFont({
  src: "./fonts/JetBrainsMono.woff2",
  variable: "--font-mono",
  weight: "400 700",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"]
});

export const metadata: Metadata = {
  title: "FOBS",
  description: "The social stock market for Solana"
};

/**
 * `theme-color` so mobile browser chrome matches the app rather than flashing
 * white above a near-black page. Also the reason `<html>` carries a `className`
 * at all — that is where next/font mounts the variables.
 */
export const viewport = {
  themeColor: "#0b0d0e"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
