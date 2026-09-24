// components/fobs/activity-card.tsx
//
// A single feed item: who did what, on which symbol, when. The white utility
// card family (12px radius, hairline border). Fed a real trade — no invented
// change figure; the only numbers are the trade amount and the real FOMO count.

import Link from "next/link";
import type { Route } from "next";
import type { FeedTrade } from "@/lib/types";
import { ago, initials, money } from "@/lib/format";

export function ActivityCard({ trade }: { trade: FeedTrade }) {
  const action = trade.side === "buy" ? "bought" : "sold";

  return (
    <div className="rounded-xl border border-[#e5e3dd] bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex gap-3">
          <Link
            href={`/profile/${trade.user.username}` as Route}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e5e1d9] text-[10px] font-semibold"
          >
            {initials(trade.user.displayName)}
          </Link>

          <div>
            <Link
              href={`/profile/${trade.user.username}` as Route}
              className="text-xs font-semibold"
            >
              {trade.user.displayName}
            </Link>

            <div className="mt-1 text-xs text-[#6f706a]">
              {action}{" "}
              <Link href={`/asset/${trade.asset.symbol}` as Route} className="font-semibold text-black">
                {trade.asset.symbol}
              </Link>
            </div>

            <div className="mt-1 text-xs font-medium">{money(trade.amountUsdc)}</div>
          </div>
        </div>

        <span className="text-[10px] text-[#999a93]">{ago(trade.tradedAt)}</span>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Link
          href={`/asset/${trade.asset.symbol}` as Route}
          className="rounded-md bg-[#edf4fb] px-2 py-1 text-[10px] font-medium text-[#3175c6]"
        >
          {trade.asset.symbol}
        </Link>

        <span className="text-[10px] text-[#777872]">
          ♡ {trade.fomoCount}
        </span>
      </div>
    </div>
  );
}
