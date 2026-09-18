import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FOBS",
  description: "The social stock market for Solana"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
