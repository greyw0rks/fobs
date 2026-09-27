"use client";

// components/fobs/market-news-panel.tsx
//
// The homepage "Market News" panel: recent headlines for the routed tickers,
// each shown next to that ticker's live price and 1D move so a story reads
// beside the number it is about. It sits under the Friends card in the summary
// rail (desktop) and, because that rail stacks below the main column on smaller
// screens, inline there too — one instance, responsive by CSS.
//
// The refresh is a deliberate new pattern. The rest of the app pushes updates
// over SSE (`lib/use-live.ts`); news does not need a live socket, just a periodic
// pull, so this polls `/api/market-news` every NEWS_REFRESH_MS and replaces only
// its own state. Nothing here navigates or reloads — the chart, feed, and friends
// list beside it never reset.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { MarketNews } from "@/lib/types";
import { api } from "@/lib/api";
import { ago, price as fmtPrice } from "@/lib/format";

/** How often the panel re-pulls. One knob, so the cadence is easy to change. */
const NEWS_REFRESH_MS = 60_000;

/** How long the header shows "↻ Updated" after a successful refresh. */
const UPDATED_FLASH_MS = 1_500;

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function changeClass(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "text-[#999a93]";
  return value >= 0 ? "text-[#23845b]" : "text-[#c94c4c]";
}

export function MarketNewsPanel() {
  const [news, setNews] = useState<MarketNews[]>([]);
  // `loaded` distinguishes "still fetching the first batch" from "fetched, empty",
  // so the empty state never flashes before the first response lands.
  const [loaded, setLoaded] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNews = useCallback(async () => {
    try {
      const { news: fresh } = await api.marketNews();
      setNews(fresh);
      // Flash the indicator only once the first batch is in — the mount load
      // should read as "Live", not "Updated".
      setLoaded((wasLoaded) => {
        if (wasLoaded) {
          setJustUpdated(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setJustUpdated(false), UPDATED_FLASH_MS);
        }
        return true;
      });
    } catch {
      // A failed poll keeps the last good stories on screen — a transient vendor
      // blip should not blank a panel that was working a minute ago.
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadNews();
    const interval = setInterval(loadNews, NEWS_REFRESH_MS);
    return () => {
      clearInterval(interval);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [loadNews]);

  return (
    <div className="fobs-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Market News</h3>

        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${
            justUpdated ? "text-[#3175c6]" : "text-[#85867f]"
          }`}
          aria-live="polite"
        >
          {justUpdated ? (
            <>↻ Updated</>
          ) : (
            <>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#62c795]" />
              Live
            </>
          )}
        </span>
      </div>

      {!loaded ? (
        <p className="text-xs text-[#85867f]">Loading market news…</p>
      ) : news.length === 0 ? (
        <p className="text-xs text-[#85867f]">No market news right now.</p>
      ) : (
        // The scroll region: ~3 cards on small screens, ~5 on desktop, the rest
        // reached by scrolling. `overscroll-contain` keeps a scroll gesture in the
        // panel from also scrolling the page once it bottoms out.
        <div className="-mx-2 max-h-[300px] space-y-1 overflow-y-auto overscroll-contain px-2 lg:max-h-[464px]">
          {news.map((story) => (
            <div
              key={story.id}
              className="rounded-lg px-2 py-2.5 transition-colors hover:bg-[#f2f1ec]"
            >
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/asset/${story.ticker}` as Route}
                  className="inline-flex shrink-0 items-center gap-1.5"
                >
                  <span className="rounded bg-[#f0efe9] px-1.5 py-0.5 text-[9px] font-bold">
                    {story.ticker}
                  </span>
                  <span className="text-[10px] text-[#92938c]">{story.company}</span>
                </Link>

                <div className="shrink-0 text-right">
                  <div className="text-xs font-medium tabular-nums">
                    {fmtPrice(story.price)}
                  </div>
                  <div className={`text-[10px] font-semibold tabular-nums ${changeClass(story.changePercent)}`}>
                    {pct(story.changePercent)}
                  </div>
                </div>
              </div>

              <a
                href={story.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 block text-xs font-medium leading-4 text-[#111312] line-clamp-2 hover:text-[#3175c6]"
              >
                {story.headline}
              </a>

              <div className="mt-1 text-[10px] text-[#9b9c95]">
                {story.source} · {ago(story.publishedAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
