/**
 * Market news for the homepage panel, from Google News RSS (keyless).
 *
 * This is the read side of the "connect a headline to its move" panel. It exists
 * because a headline with no price next to it is just a link, and a price with no
 * headline is just a number — the panel wants both, so this module fetches the
 * stories and attaches each ticker's live figures.
 *
 * ## Source, and why not Yahoo
 *
 * The obvious keyless choice was Yahoo's `v1/finance/search` news array — the same
 * vendor the price modules lean on. It was measured and rejected: Yahoo hard-429s
 * a server/datacenter IP across every host, which is the same reason
 * `price-history.ts` treats Yahoo as a best-effort fallback behind keyed Twelve
 * Data. A news source that answers `429` from Vercel is a permanently empty panel.
 *
 * Google News RSS (`news.google.com/rss/search?q=<TICKER>+stock`) answers a server
 * IP with a 200 and a hundred items, keyless, so it is the source that actually
 * works where this runs. It returns RSS, not JSON — parsed here with focused
 * regexes rather than a new XML dependency, which is enough for this one
 * well-formed feed. Best-effort throughout: a query that fails is skipped, not
 * thrown, so one flaky ticker cannot blank the panel.
 *
 * ## The cache is the load-bearing part
 *
 * The panel polls every ~60s, per client. Without a cache, N open tabs would be
 * N × (5 feed fetches + a quote batch + a change batch) every minute. So the
 * normalized response is memoised for `CACHE_TTL_MS`, process-wide, the same
 * `globalThis` pattern the rate limiter and event bus use so a hot reload does not
 * silently reset it. Many polling clients cause at most one upstream batch per TTL.
 *
 * Prices and changes are read from the modules that already own them
 * (`fetchQuotes`, `changesForSymbols`) rather than re-fetched here, so the panel
 * and the rest of the app cannot disagree about what NVDA costs.
 */

import type { MarketNews, MarketNewsResponse } from "@/lib/types";
import { SUPPORTED } from "@/lib/server/routed-equities";
import { fetchQuotes } from "@/lib/server/market-prices";
import { changesForSymbols } from "@/lib/server/price-history";

/** Company names for the supported tickers. Fixed set, so a small map is honest. */
const COMPANY: Record<string, string> = {
  NVDA: "NVIDIA",
  AAPL: "Apple",
  MSFT: "Microsoft",
  TSLA: "Tesla",
  AMZN: "Amazon"
};

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TIMEOUT_MS = 8_000;

/** Match the panel's poll interval: a fresher cache than the client asks for is waste. */
const CACHE_TTL_MS = 60_000;

/** How many stories to keep per ticker before merging, and how many after. */
const PER_TICKER = 6;
const KEEP = 15;

type ParsedItem = {
  id: string;
  headline: string;
  source: string;
  url: string;
  publishedMs: number;
};

const globalForNews = globalThis as unknown as {
  fobsMarketNews?: { at: number; value: MarketNewsResponse } | null;
};

/** The handful of XML entities Google News actually emits in a headline. */
function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function firstMatch(block: string, re: RegExp): string | null {
  const m = block.match(re);
  return m ? m[1] : null;
}

/**
 * Google News RSS for one ticker, most-recent-first, or [] on any failure.
 *
 * The feed's titles carry a trailing " - <Source>"; the publisher is also given
 * in a `<source>` tag, so the suffix is stripped for a clean headline.
 */
async function newsForTicker(ticker: string): Promise<ParsedItem[]> {
  try {
    const url =
      `https://news.google.com/rss/search?q=${encodeURIComponent(`${ticker} stock`)}` +
      `&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/xml" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const blocks = xml.split("<item>").slice(1).map((chunk) => chunk.split("</item>")[0]);

    const items: ParsedItem[] = [];
    for (const block of blocks.slice(0, PER_TICKER)) {
      const link = firstMatch(block, /<link>(.*?)<\/link>/s);
      const rawTitle = firstMatch(block, /<title>(.*?)<\/title>/s);
      if (!link || !rawTitle) continue;

      const source = decodeEntities(firstMatch(block, /<source[^>]*>(.*?)<\/source>/s) ?? "");
      let headline = decodeEntities(rawTitle);
      // Google appends " - Publisher"; drop it when it matches the source tag.
      if (source && headline.endsWith(` - ${source}`)) {
        headline = headline.slice(0, -(source.length + 3)).trim();
      }
      if (!headline) continue;

      const pubDate = firstMatch(block, /<pubDate>(.*?)<\/pubDate>/s);
      const guid = firstMatch(block, /<guid[^>]*>(.*?)<\/guid>/s);
      const publishedMs = pubDate ? Date.parse(pubDate) : NaN;

      items.push({
        id: decodeEntities(guid ?? link),
        headline,
        source: source || "News",
        url: decodeEntities(link),
        publishedMs
      });
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Normalized, deduped, most-recent-first market news, with each story's ticker
 * price and 1D change attached. Cached process-wide for `CACHE_TTL_MS`.
 */
export async function getMarketNews(): Promise<MarketNewsResponse> {
  const cached = globalForNews.fobsMarketNews;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const tickers = [...SUPPORTED];

  // News per ticker, and the price/change batches, in parallel — one round of
  // fetches for the whole panel rather than one per story.
  const [perTicker, quoteResult, changes] = await Promise.all([
    Promise.all(tickers.map((ticker) => newsForTicker(ticker))),
    fetchQuotes(tickers),
    changesForSymbols(tickers)
  ]);

  const priceFor = new Map<string, number>();
  for (const quote of quoteResult.quotes) priceFor.set(quote.symbol, quote.price);

  // Merge across tickers, deduping by the story's stable id (guid, else link).
  // First occurrence wins, so a story surfaced under two tickers keeps the ticker
  // it first appeared under rather than being listed twice.
  const seen = new Set<string>();
  const merged: MarketNews[] = [];

  for (let i = 0; i < tickers.length; i += 1) {
    const ticker = tickers[i];
    for (const item of perTicker[i]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);

      merged.push({
        id: item.id,
        ticker,
        company: COMPANY[ticker] ?? ticker,
        headline: item.headline,
        source: item.source,
        publishedAt: Number.isFinite(item.publishedMs)
          ? new Date(item.publishedMs).toISOString()
          : new Date().toISOString(),
        price: priceFor.get(ticker) ?? null,
        changePercent: changes[ticker] ?? null,
        url: item.url
      });
    }
  }

  merged.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const value: MarketNewsResponse = {
    updatedAt: new Date().toISOString(),
    news: merged.slice(0, KEEP)
  };

  globalForNews.fobsMarketNews = { at: Date.now(), value };
  return value;
}
