import type { Metadata } from "next";
import localFont from "next/font/local";
import { WalletProviders } from "@/components/WalletProvider";
import "./globals.css";
// The Fobs frame system is now the product UI, so its Tailwind utilities and
// `--fobs-*` tokens load app-wide. Order matters: globals first, then utilities
// (they layer over globals' element rules), then the fobs token sheet.
import "@/styles/tailwind.css";
import "@/styles/fobs.css";

/**
 * Two fonts, self-hosted from `app/fonts/`.
 *
 * Geist is Vercel's variable font — sharper terminals than Inter, better tabular
 * figure support, and covers weights 100-900. GeistMono replaces JetBrains Mono
 * for a more cohesive pairing: every price, share count, address and signature
 * is set in it with `tabular-nums`.
 *
 * Both are variable fonts and expose themselves as CSS variables rather than
 * concrete families, so globals.css stays the only place that decides what
 * anything is set in — which is why neither declares a `fallback` list here.
 * Naming fallbacks in both places produced a stack with `system-ui,
 * -apple-system, "Segoe UI", sans-serif` in it twice.
 */
const geist = localFont({
  src: "./fonts/Geist.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap"
});

const geistMono = localFont({
  src: "./fonts/GeistMono.woff2",
  variable: "--font-mono",
  weight: "100 900",
  display: "swap"
});

export const metadata: Metadata = {
  title: "FOBS",
  description: "The social stock market for Solana"
};

/**
 * `theme-color` so mobile browser chrome matches the app. One light theme now,
 * so one value — the warm off-white canvas the whole product sits on.
 */
export const viewport = {
  themeColor: "#f4f3ef",
  colorScheme: "light"
} as const;

/**
 * The wallet provider wraps everything, including the signed-out pages.
 *
 * It has to be at the root rather than on the pages that trade, because a wallet
 * connection is a property of the *browser*, not of a route — and because the
 * sign-in page is itself a place you connect a wallet. Mounting it per-page
 * would tear the connection down on every navigation.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <WalletProviders>{children}</WalletProviders>
      </body>
    </html>
  );
}
