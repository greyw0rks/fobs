/**
 * Real market prices, from a public quote endpoint.
 *
 * The program prices every trade from an on-chain oracle account, and on devnet
 * that account is a `MockOracle` — a PDA only the operator can write. That is
 * not a shortcut, it is a measured constraint: there is no usable Pyth US-equity
 * feed on devnet (0/5, newest account 23 days old — see
 * `docs/PYTH_VERIFICATION.md`), while the same feeds on mainnet are seconds old.
 *
 * So the *source* has to be off-chain, and what makes the price real is where it
 * comes from, not which account stores it. This module is that source: it reads
 * the live quote and hands the number to `push-prices.ts`, which writes it into
 * the oracle the program actually trades against. The number a trader gets
 * filled at is the number the market is printing.
 *
 * What this deliberately does not do is pretend the quote is something it is
 * not. `asOf` is the market's own timestamp for the print, not the time we
 * fetched it, so a weekend or after-hours price is published carrying the moment
 * it was actually struck. A stale price that says it is stale is honest; one
 * that has been re-stamped with `Date.now()` is not.
 *
 * Two public endpoints carry these quotes, tried in order: Yahoo's chart API and
 * Nasdaq's quote API. Neither needs a key, which is why they are here rather than
 * a broker API, and neither has an uptime contract. Two is not redundancy for its
 * own sake — Yahoo answers a datacenter IP with a 429 often enough to be a real
 * outage, and a price loop that dies on one vendor's rate limiter leaves the
 * oracle frozen at whatever it last held, which is the exact failure this module
 * exists to prevent.
 *
 * Yahoo is tried first because it alone reports a full `regularMarketTime`; Nasdaq
 * gives a date. That is a real difference in precision, so it is worth preferring,
 * but not worth failing over.
 */

/** The company each synthetic tracks. `sNVDA` is a token; `NVDA` is the ticker. */
const TICKERS: Record<string, string> = {
  sNVDA: "NVDA",
  sAAPL: "AAPL",
  sMSFT: "MSFT",
  sTSLA: "TSLA",
  sAMZN: "AMZN"
};

/**
 * The ticker for a synthetic symbol.
 *
 * Falls back to stripping the leading `s` — the same convention
 * `format.ts`'s `synthetic()` uses to name these assets — so a sixth asset works
 * without an edit here, rather than silently resolving to no price at all.
 */
export function tickerFor(symbol: string): string {
  return TICKERS[symbol] ?? symbol.replace(/^s/, "");
}

export type Quote = {
  symbol: string;
  ticker: string;
  /** USD per share. */
  price: number;
  /**
   * When the market struck this price, from the quote's own `regularMarketTime`.
   * Not the fetch time.
   */
  asOf: Date;
  /** The venue's name for the session, e.g. `"regular"`. */
  marketState: string | null;
};

/**
 * Yahoo answers a request with no `User-Agent` inconsistently — sometimes a
 * redirect to a consent page, sometimes a 429. A browser-shaped one is what
 * makes this endpoint behave.
 */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const QUOTE_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const NASDAQ_BASE = "https://api.nasdaq.com/api/quote/";

/** A quote request is a fetch, not a trade: it should fail fast and be retried. */
const TIMEOUT_MS = 8_000;

export class QuoteUnavailableError extends Error {
  constructor(symbol: string, reason: string) {
    super(`No market price for ${tickerFor(symbol)} (${symbol}): ${reason}`);
    this.name = "QuoteUnavailableError";
  }
}

/**
 * The live price for one synthetic.
 *
 * Throws rather than returning a fallback. A default price would be invented
 * market data, and every downstream number — a fill, a portfolio total, a P&L —
 * would then be built on it without anything saying so.
 */
/** A source either reads a quote or throws a short reason. */
type Source = {
  name: string;
  read: (symbol: string, ticker: string) => Promise<Quote>;
};

/** Shared GET: fail fast, never cache. */
async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    // Prices are the one thing in this app that must never be cached by a fetch
    // layer; a cached quote is a stale quote wearing a fresh timestamp.
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  if (!response.ok) throw new Error(`returned ${response.status}`);
  return response.json();
}

/**
 * Yahoo, preferred because `regularMarketTime` is a full timestamp — the moment
 * the print was struck, to the second.
 */
const yahoo: Source = {
  name: "yahoo",
  async read(symbol, ticker) {
    const payload = (await getJson(
      `${QUOTE_BASE}${encodeURIComponent(ticker)}?interval=1d&range=1d`
    )) as {
      chart?: {
        error?: { description?: string } | null;
        result?: {
          meta?: {
            regularMarketPrice?: number;
            regularMarketTime?: number;
            marketState?: string;
          };
        }[];
      };
    };

    if (payload.chart?.error) {
      throw new Error(payload.chart.error.description ?? "the endpoint reported an error");
    }

    const meta = payload.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error("the quote carried no usable price");
    }

    // `regularMarketTime` is the market's own stamp, in seconds. Falling back to
    // now would relabel a stale print as a current one, which is the specific
    // dishonesty this field exists to prevent — so an absent stamp is an error.
    const struckAt = meta?.regularMarketTime;
    if (typeof struckAt !== "number" || struckAt <= 0) {
      throw new Error("the quote carried no market timestamp");
    }

    return {
      symbol,
      ticker,
      price,
      asOf: new Date(struckAt * 1000),
      marketState: meta?.marketState ?? null
    };
  }
};

/**
 * Nasdaq, the fallback, and a coarser one: it reports the session's *date* rather
 * than the second it was struck, so an after-hours quote reads as midnight of
 * that day. Still the venue's own stamp rather than our fetch time, which is the
 * property that matters — the age shown is wrong by hours, never by days.
 */
const nasdaq: Source = {
  name: "nasdaq",
  async read(symbol, ticker) {
    const payload = (await getJson(
      `${NASDAQ_BASE}${encodeURIComponent(ticker)}/info?assetclass=stocks`
    )) as {
      data?: {
        primaryData?: { lastSalePrice?: string; lastTradeTimestamp?: string };
        marketStatus?: string;
      } | null;
    };

    if (!payload.data) throw new Error("returned no quote data");

    // "$222.27" — the venue formats it, so strip rather than parse.
    const raw = payload.data.primaryData?.lastSalePrice;
    const price = typeof raw === "string" ? Number(raw.replace(/[^0-9.]/g, "")) : NaN;
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("the quote carried no usable price");
    }

    // "Sep 17, 2026". Checked rather than trusted: an `Invalid Date` would
    // otherwise read downstream as an extremely old price and quietly drop the
    // asset from every portfolio total.
    const stamp = payload.data.primaryData?.lastTradeTimestamp;
    const asOf = typeof stamp === "string" ? new Date(stamp) : new Date(NaN);
    if (Number.isNaN(asOf.getTime())) {
      throw new Error("the quote carried no market timestamp");
    }

    return {
      symbol,
      ticker,
      price,
      asOf,
      marketState: payload.data.marketStatus ?? null
    };
  }
};

const SOURCES: Source[] = [yahoo, nasdaq];

/**
 * The live price for one synthetic.
 *
 * Throws rather than returning a fallback. A default price would be invented
 * market data, and every downstream number — a fill, a portfolio total, a P&L —
 * would then be built on it without anything saying so.
 *
 * Every source is tried before giving up, and the error carries each one's
 * reason: "yahoo returned 429; nasdaq returned 503" is a diagnosable line, where
 * a bare "no price" sends the next reader to the wrong place.
 */
export async function fetchQuote(symbol: string): Promise<Quote> {
  const ticker = tickerFor(symbol);
  const failures: string[] = [];

  for (const source of SOURCES) {
    try {
      return await source.read(symbol, ticker);
    } catch (error) {
      failures.push(
        `${source.name} ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  throw new QuoteUnavailableError(symbol, failures.join("; "));
}

/**
 * Every symbol the given assets need, quoted.
 *
 * Per-symbol failures are collected rather than thrown, so one delisted ticker
 * cannot stop the other four from being priced. The caller decides what to do
 * with the failures — `push-prices.ts` skips those assets and reports them.
 */
export async function fetchQuotes(symbols: string[]): Promise<{
  quotes: Quote[];
  errors: { symbol: string; message: string }[];
}> {
  const settled = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return { quote: await fetchQuote(symbol) };
      } catch (error) {
        return {
          error: {
            symbol,
            message: error instanceof Error ? error.message : String(error)
          }
        };
      }
    })
  );

  const quotes: Quote[] = [];
  const errors: { symbol: string; message: string }[] = [];
  for (const entry of settled) {
    if ("quote" in entry && entry.quote) quotes.push(entry.quote);
    else if ("error" in entry && entry.error) errors.push(entry.error);
  }
  return { quotes, errors };
}

/** USD to the program's 6-decimal base units (`$178.24` → `178_240_000n`). */
export function toOraclePrice(usd: number): bigint {
  return BigInt(Math.round(usd * 1e6));
}
