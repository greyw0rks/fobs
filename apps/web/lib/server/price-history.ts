/**
 * A historical price series for a listed equity.
 *
 * The trade-price chart only knows what FOBS itself has traded, which for a
 * freshly bridged asset is little or nothing. For a *listed* underlying there is
 * a real public series, and this reads it.
 *
 * The primary source is Twelve Data, behind `TWELVEDATA_API_KEY` — a keyed API
 * because the keyless ones (Yahoo, Stooq) rate-limit or anti-bot datacenter IPs,
 * so from a server they return nothing. Yahoo is kept as a best-effort fallback
 * for environments where it does answer (e.g. local dev). With neither, this
 * returns [] and the chart falls back to the trade series.
 *
 * Only listed equities have a series. A pre-IPO name (SPACEX, OPENAI, …) has no
 * public price history — its only prices are the issuer's current mark and token
 * price — so there is nothing to return and the caller shows trades or a note.
 *
 * Cached for five minutes per ticker: a daily series does not move faster than
 * that, and the asset page is otherwise a fresh upstream hit on every view.
 */

export type PricePoint = { at: number; price: number };

/**
 * A real one-day change, in percent, or null.
 *
 * Derived from the last two daily closes of the public series — never invented.
 * Null when the series has fewer than two points (a freshly bridged or pre-IPO
 * name), so the UI shows an em dash rather than a fabricated percentage. This is
 * the only "24h change" in the app and it is a genuine close-to-close move for a
 * listed underlying.
 */
export async function assetChange1d(ticker: string): Promise<number | null> {
  const series = await priceHistory(ticker);
  if (series.length < 2) return null;
  const prev = series[series.length - 2].price;
  const last = series[series.length - 1].price;
  if (!(prev > 0)) return null;
  return ((last - prev) / prev) * 100;
}

/** 1D change for many tickers at once, as a symbol→percent (or null) map. */
export async function changesForSymbols(
  symbols: string[]
): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    symbols.map(async (symbol) => [symbol, await assetChange1d(symbol)] as const)
  );
  return Object.fromEntries(entries);
}

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TIMEOUT_MS = 8_000;
const REVALIDATE_SECONDS = 300;

/** How many daily points to ask for — roughly a trading month. */
const OUTPUT_SIZE = 40;

export async function priceHistory(ticker: string): Promise<PricePoint[]> {
  const keyed = await fromTwelveData(ticker);
  if (keyed.length > 0) return keyed;
  // Best effort where a keyless source happens to answer (local dev, mostly).
  return fromYahoo(ticker);
}

/** Twelve Data `/time_series` — the primary, keyed source. */
async function fromTwelveData(ticker: string): Promise<PricePoint[]> {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) return [];
  try {
    const url =
      `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}` +
      `&interval=1day&outputsize=${OUTPUT_SIZE}&order=ASC&apikey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) return [];

    const data = (await response.json()) as {
      status?: string;
      values?: { datetime?: string; close?: string }[];
    };
    // A bad symbol or an exhausted quota comes back as `{status:"error"}` with a
    // 200 — treat anything without values as no data, not a throw.
    if (data.status === "error" || !Array.isArray(data.values)) return [];

    return data.values
      .map((row) => ({
        at: Date.parse(`${row.datetime}T00:00:00Z`),
        price: row.close != null ? Number(row.close) : NaN
      }))
      .filter((point): point is PricePoint => Number.isFinite(point.at) && point.price > 0)
      .sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

type YahooChart = {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

// Two Yahoo hosts; `query1` rate-limits some IPs where `query2` answers.
const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com/v8/finance/chart/",
  "https://query2.finance.yahoo.com/v8/finance/chart/"
];

/** Yahoo chart — keyless fallback, often blocked on datacenter IPs. */
async function fromYahoo(ticker: string): Promise<PricePoint[]> {
  for (const host of YAHOO_HOSTS) {
    try {
      const url = `${host}${encodeURIComponent(ticker)}?interval=1d&range=1mo`;
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        next: { revalidate: REVALIDATE_SECONDS },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!response.ok) continue;

      const data = (await response.json()) as YahooChart;
      const result = data.chart?.result?.[0];
      const timestamps = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];

      const points = timestamps
        .map((seconds, index) => ({ at: seconds * 1000, price: closes[index] }))
        .filter((point): point is PricePoint => typeof point.price === "number" && point.price > 0);
      if (points.length > 0) return points;
    } catch {
      // Try the next host.
    }
  }
  return [];
}
