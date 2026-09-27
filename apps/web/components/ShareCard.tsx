"use client";

// components/ShareCard.tsx
//
// The shareable trade card, rendered to a real PNG the user can save. The card
// itself is the same dark editorial surface as before; the difference is the
// "Save image" action, which rasterises the card node with html-to-image and
// downloads it as a PNG file (`fobs-<SYMBOL>.png`).

import { useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { toPng } from "html-to-image";
import { money, price, qty } from "@/lib/format";

export type ShareCardTrade = {
  id: string;
  side: "buy" | "sell";
  amountUsdc: number;
  quantity: number;
  price: number;
  user: { displayName: string };
  asset: { symbol: string; name: string };
};

export function ShareCard({ trade }: { trade: ShareCardTrade }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const verb = trade.side === "sell" ? "sold" : "bought";

  async function toBlob(): Promise<Blob | null> {
    const node = cardRef.current;
    if (!node) return null;
    // pixelRatio 3 keeps it crisp when a phone rescales it into the gallery.
    // The first rasterisation can miss a just-loaded webfont, so render twice
    // and keep the second — a known html-to-image quirk, cheap to absorb here.
    const options = { pixelRatio: 3, cacheBust: true, backgroundColor: "#f4f3ef" };
    await toPng(node, options);
    const dataUrl = await toPng(node, options);
    return (await fetch(dataUrl)).blob();
  }

  async function saveImage() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await toBlob();
      if (!blob) return;

      // Always a PNG download. The object URL is revoked on a delay, not
      // synchronously after click(): the download reads the blob asynchronously,
      // so revoking it right away kills the read (and a browser that navigates to
      // the blob rather than downloading lands on an already-revoked URL — the
      // ERR_FILE_NOT_FOUND this avoids).
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `fobs-${trade.asset.symbol}.png`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        anchor.remove();
        URL.revokeObjectURL(url);
      }, 10_000);
      setNote("Saved as a PNG to your downloads.");
    } catch {
      setNote("Could not create the image. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — leave the label unchanged */
    }
  }

  return (
    <div className="w-full max-w-[520px]">
      <div className="mb-4 text-center">
        <span className="text-xs text-[#777872]">Share your trade</span>
      </div>

      {/* The capture target. The warm padding becomes the image's frame, so the
          card's rounded corners read as intended rather than as clipped edges. */}
      <div ref={cardRef} className="rounded-[32px] bg-[#f4f3ef] p-4">
        <div className="relative overflow-hidden rounded-[28px] bg-[#111312] p-7 text-white shadow-2xl">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#3175c6] opacity-40 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-[#a98ad4] opacity-30 blur-3xl" aria-hidden="true" />

          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold tracking-[-0.06em]">fobs</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[10px]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#62c795]" />
                Mainnet
              </span>
            </div>

            <div className="mt-14">
              <p className="text-xs text-white/50">
                {trade.user.displayName} {verb}
              </p>

              <div className="mt-2 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-sm font-bold tabular-nums text-black">
                  {trade.asset.symbol.slice(0, 2)}
                </div>
                <div>
                  <h1 className="text-[38px] font-semibold tracking-[-0.06em] tabular-nums">
                    {trade.asset.symbol}
                  </h1>
                  <p className="text-xs text-white/50">{trade.asset.name}</p>
                </div>
              </div>

              <div className="mt-12">
                <span className="text-xs text-white/50">Size</span>
                <p className="mt-1 text-[34px] font-semibold tabular-nums">
                  {money(trade.amountUsdc)}
                </p>
                <p className="mt-1 text-sm text-white/60 tabular-nums">
                  {qty(trade.quantity)} at {price(trade.price)}
                </p>
              </div>
            </div>

            <div className="mt-14 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold">FOMO this.</p>
                <p className="mt-1 text-[10px] text-white/40">People. Markets. FOMO.</p>
              </div>
              <div className="text-[10px] text-white/40">fobs</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <button className="fobs-button-primary" onClick={saveImage} disabled={busy}>
          {busy ? "Preparing…" : "Save image"}
        </button>
        <button className="fobs-button-secondary" onClick={copyLink}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      {note ? (
        <p className="mt-3 text-center text-[11px] text-[#777872]">{note}</p>
      ) : null}

      <div className="mt-4 text-center">
        <Link
          href={`/asset/${trade.asset.symbol}` as Route}
          className="text-xs text-[#777872] hover:text-[#111312]"
        >
          ← Back to {trade.asset.symbol}
        </Link>
      </div>
    </div>
  );
}
