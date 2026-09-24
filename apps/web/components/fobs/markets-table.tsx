// components/fobs/markets-table.tsx
//
// The markets list. "Fobs buying" is a social signal — how many distinct people
// have traded this asset — rendered as a blue data bar scaled to the busiest
// asset. The 1D column is a real close-to-close change (null → em dash); it is
// the only green/red.

import Link from "next/link";
import type { Route } from "next";
import type { AssetSummary } from "@/lib/types";
import { price as fmtPrice } from "@/lib/format";

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function MarketsTable({
  assets,
  changes = {},
  title = "Markets",
  subtitle = "What people are trading"
}: {
  assets: AssetSummary[];
  /** symbol → real 1D change percent (null when unknown). */
  changes?: Record<string, number | null>;
  title?: string;
  subtitle?: string;
}) {
  const maxTraders = Math.max(1, ...assets.map((a) => a.traderCount));

  return (
    <div className="fobs-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#e5e3dd] p-5">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-[11px] text-[#85867f]">{subtitle}</p>
        </div>

        <Link
          href={"/stocks" as Route}
          className="rounded-lg border border-[#e3e2dc] px-3 py-2 text-[11px]"
        >
          All markets
        </Link>
      </div>

      <div className="hidden grid-cols-5 border-b border-[#e5e3dd] px-5 py-3 text-[10px] uppercase tracking-wide text-[#8b8c85] sm:grid">
        <span>Stock</span>
        <span>Price</span>
        <span>1D</span>
        <span>Fobs buying</span>
        <span />
      </div>

      {assets.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-[#85867f]">
          No markets yet.
        </div>
      ) : null}

      {assets.map((asset) => {
        const change = changes[asset.symbol] ?? null;
        return (
          <Link
            key={asset.id}
            href={`/asset/${asset.symbol}` as Route}
            className="grid grid-cols-2 gap-3 border-b border-[#efeee9] px-5 py-4 transition-colors hover:bg-[#f2f1ec] sm:grid-cols-5 sm:items-center"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0efe9] text-[10px] font-bold">
                {asset.symbol.slice(0, 2)}
              </div>

              <div>
                <div className="text-xs font-semibold">{asset.symbol}</div>
                <div className="text-[10px] text-[#92938c]">{asset.name}</div>
              </div>
            </div>

            <span className="text-xs font-medium">{fmtPrice(asset.price)}</span>

            <span
              className={`text-xs font-semibold ${
                change === null
                  ? "text-[#999a93]"
                  : change >= 0
                    ? "text-[#23845b]"
                    : "text-[#c94c4c]"
              }`}
            >
              {pct(change)}
            </span>

            <div className="flex items-center gap-2">
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#e7e7e2]">
                <div
                  className="h-full rounded-full bg-[#3175c6]"
                  style={{ width: `${Math.min((asset.traderCount / maxTraders) * 100, 100)}%` }}
                />
              </div>

              <span className="text-[10px] text-[#777872]">{asset.traderCount}</span>
            </div>

            <span className="hidden justify-self-end text-xs font-medium text-[#3175c6] sm:block">
              Trade →
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Compact single-column markets list for a narrow rail (e.g. the feed sidebar),
 * where the full five-column table would be cramped. Shows price and the real
 * holder count ("Fobs buying"); no invented figures.
 */
export function MarketsRail({
  assets,
  limit = 8
}: {
  assets: AssetSummary[];
  limit?: number;
}) {
  const rows = assets.slice(0, limit);

  return (
    <div className="fobs-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Markets</h3>
        <Link href={"/stocks" as Route} className="text-xs font-medium text-[#3175c6]">
          All markets →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-[#85867f]">No markets yet.</p>
      ) : (
        <div className="space-y-3.5">
          {rows.map((asset) => (
            <Link
              key={asset.id}
              href={`/asset/${asset.symbol}` as Route}
              className="flex items-center justify-between gap-2 rounded-lg -mx-2 px-2 py-1 transition hover:bg-[#f2f1ec]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f0efe9] text-[9px] font-bold">
                  {asset.symbol.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{asset.symbol}</div>
                  <div className="truncate text-[10px] text-[#92938c]">{asset.name}</div>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xs font-medium tabular-nums">
                  {fmtPrice(asset.price)}
                </div>
                <div className="text-[10px] text-[#9b9c95]">
                  {asset.traderCount} holding
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-4 text-[10px] leading-4 text-[#9b9c95]">
        Holder counts are real Fobs accounts holding the asset.
      </p>
    </div>
  );
}
