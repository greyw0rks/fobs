// components/fobs/fomo-card.tsx
//
// A soft editorial card — pastel surface, no border, organic blurred forms.
// This is the FOMO/social highlight family, distinct from the white utility
// cards. The "FOMO this" CTA is black (an action), not blue. Fed the most
// recent notable trade; renders nothing when there isn't one.

import Link from "next/link";
import type { Route } from "next";
import type { FeedTrade } from "@/lib/types";
import { money } from "@/lib/format";

export function FomoCard({ trade }: { trade: FeedTrade | null }) {
  if (!trade) return null;

  const action = trade.side === "buy" ? "just bought" : "just sold";

  return (
    <div className="relative min-h-[210px] overflow-hidden rounded-[18px] bg-[#e7e1f3] p-5">
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#f5ddd2] blur-2xl" />

      <div className="absolute bottom-[-30px] right-[-20px] h-32 w-32 rounded-full bg-[#dceafa] blur-xl" />

      <div className="relative">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
            ↯
          </span>
          FOMO
        </div>

        <p className="text-xs text-[#555650]">
          {trade.user.displayName} {action}
        </p>

        <h3 className="mt-1 text-[24px] font-semibold tracking-[-0.04em]">
          {trade.asset.symbol}
        </h3>

        <div className="mt-1 flex gap-2">
          <span className="text-sm">{money(trade.amountUsdc)}</span>
        </div>

        <Link
          href={`/asset/${trade.asset.symbol}` as Route}
          className="fobs-button-primary mt-5 inline-block"
        >
          FOMO this →
        </Link>
      </div>
    </div>
  );
}
