/**
 * The Pyth reference price, and the harder question of when it is allowed to be
 * old.
 *
 * A routed equity trade has two prices: what the venue charges, and what the
 * underlying is worth. `quote.ts` gives the first. This module gives the second,
 * read from Pyth — the same oracle the on-chain program already trusts, so the
 * reference the guard compares against is the reference the protocol prices from.
 *
 * ## The problem this module exists to solve
 *
 * Pyth's US equity feeds only publish while the market is open. Measured on
 * 2026-09-20 (a Sunday) on mainnet-beta, all five feeds the app cares about were
 * **46 hours stale** — the last publish was Friday's close:
 *
 *   NVDA $222.51   AAPL $334.82   MSFT $493.95   TSLA $364.17   AMZN $254.16
 *   all 46h old
 *
 * Meanwhile a live Jupiter route for USDC → NVDAx implied $221.78. That is a
 * −33bps deviation — the venue tracking Friday's close almost exactly. So the
 * naive guard, the one that refuses any route whose reference is older than
 * Pyth's own 90-second staleness bound, **refuses a perfectly good trade every
 * weekend**. It would be a guard that only allows trading during New York
 * business hours, which is not a safety feature; it is an outage with good
 * intentions.
 *
 * The fix is that "old" is not one condition. A price can be old because the
 * market is shut — in which case the last close *is* the reference, and a
 * deviation from it is real information — or because the oracle has stopped
 * while the market is trading, in which case there is no reference at all and
 * nothing should be routed against it. Pyth publishes the market schedule
 * alongside the feed, so this is a distinction we can look up rather than guess:
 *
 *   live       published within `MAX_PRICE_AGE_SECS`. Use it.
 *   closed     older, but the market is shut and the feed is younger than any
 *              plausible closure. This is the last close. Usable, and labelled.
 *   stale      older, and the market is open — or older than any closure could
 *              explain. The feed has stopped. There is no reference.
 *
 * `freshness` carries all three, so a caller cannot collapse them by accident.
 */

import bs58 from "bs58";

const HERMES = "https://hermes.pyth.network";

/** The Pyth receiver program, which owns every `PriceUpdateV2` account. */
const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

/**
 * Pyth's own bound, mirrored from the program's `MAX_PRICE_AGE_SECS`. A price
 * younger than this is live in the sense the protocol means it.
 */
const MAX_PRICE_AGE_SECS = 90;

/**
 * The oldest a reference may be while still counting as a market closure.
 *
 * The longest regular US closure is a long holiday weekend — Friday's close to
 * Tuesday's open is around 87 hours. Five days clears that with room to spare
 * while still catching a feed that has been dead for a week, which no closure
 * explains.
 */
export const MAX_CLOSURE_AGE_SECS = 5 * 24 * 60 * 60;

const TIMEOUT_MS = 10_000;

/** `feed_id` sits after the 8-byte discriminator, the authority, and the level. */
const FEED_ID_OFFSET = 41;
/** The embedded `Price` struct starts right after the 32-byte feed id. */
const PRICE_OFFSET = FEED_ID_OFFSET + 32;

/**
 * Feeds and schedules change on the order of days, and the listing call returns
 * a kilobyte. A minute keeps the schedule honest without re-asking per row.
 */
const DISCOVERY_TTL_MS = 60_000;

/**
 * How long a read reference is reused, and how long to wait between reads.
 *
 * Both exist because `getProgramAccounts` is the most expensive call this app
 * makes and the public RPC throttles it first. Measured on 2026-09-20: reading
 * five underlyings back to back returned 429 on the fifth, which the guard
 * reported as `unchecked` — correct, and useless. A price inside its staleness
 * bound does not need re-reading, and the reads that do happen are spaced.
 */
const REFERENCE_TTL_MS = 60_000;
const READ_SPACING_MS = 250;

/** A rate limit on a heavy call wants a longer pause than a transport retry. */
const RPC_RETRY_MS = 1_200;
const RPC_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PythUnavailableError extends Error {
  constructor(reason: string) {
    super(`No Pyth reference: ${reason}`);
    this.name = "PythUnavailableError";
  }
}

/** When the underlying market is open, as Pyth reports it. */
export type MarketHours = {
  isOpen: boolean;
  /** Unix seconds. Null when the feed publishes no schedule. */
  nextOpen: number | null;
  nextClose: number | null;
};

export type ReferenceFeed = {
  /** Upper-case US ticker, e.g. `NVDA`. */
  symbol: string;
  feedId: string;
  description: string;
  marketHours: MarketHours;
};

/**
 * How much the reference can be trusted, which is not the same as how old it is.
 *
 * The three states are deliberately not a boolean: `closed` is usable and `live`
 * is usable, but they mean different things to anything downstream, and a caller
 * that treats them alike will eventually describe Friday's close as today's
 * price.
 */
export type Freshness =
  | { state: "live"; ageSecs: number }
  | { state: "closed"; ageSecs: number; nextOpen: number | null }
  | { state: "stale"; ageSecs: number; reason: string };

export type ReferencePrice = {
  symbol: string;
  feedId: string;
  /** USD per unit of the underlying, scaled from Pyth's own exponent. */
  price: number;
  /** Pyth's confidence interval, same units as `price`. */
  confidence: number;
  publishTime: number;
  ageSecs: number;
  freshness: Freshness;
  marketHours: MarketHours;
};

type Discovered = { feed: ReferenceFeed; at: number };

const discovery = new Map<string, Discovered>();

/**
 * The on-chain read, and the queue that keeps them apart.
 *
 * `readQueue` is a promise chain rather than a lock: each read waits on the
 * previous one and then hands the baton on. It is the simplest correct thing for
 * a limit that is shared by every caller in the process.
 */
const readCache = new Map<
  string,
  { at: number; value: { price: number; confidence: number; publishTime: number } | null }
>();
let readQueue: Promise<void> = Promise.resolve();
let lastReadAt = 0;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The feed for a US ticker, or null if Pyth does not carry one.
 *
 * Matching is on `Equity.US.<TICKER>/USD` and not on the ticker alone, because
 * the listing contains 1243 equity feeds across every exchange Pyth covers and a
 * bare three-letter match would happily return a Hong Kong listing. The exact
 * symbol is the only safe key.
 *
 * The `query` filter is what keeps this call small — the unfiltered listing is
 * 700KB, and the filtered one is about a kilobyte. It carries `market_hours`,
 * which is the part this module actually needs and the part that is not on chain.
 */
export async function discoverFeed(symbol: string): Promise<ReferenceFeed | null> {
  const ticker = symbol.toUpperCase();
  const cached = discovery.get(ticker);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.feed;

  const url = `${HERMES}/v2/price_feeds?asset_type=equity&query=${encodeURIComponent(ticker)}`;
  let payload: unknown;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new PythUnavailableError(`Hermes listing returned ${response.status}`);
    }
    payload = await response.json();
  } catch (error) {
    if (error instanceof PythUnavailableError) throw error;
    throw new PythUnavailableError(
      error instanceof Error ? error.message : String(error)
    );
  }

  if (!Array.isArray(payload)) throw new PythUnavailableError("listing was not an array");

  const wanted = `Equity.US.${ticker}/USD`;
  for (const entry of payload as Array<{
    id?: string;
    attributes?: Record<string, string>;
    market_hours?: { is_open?: boolean; next_open?: number; next_close?: number };
  }>) {
    const attributes = entry.attributes ?? {};
    if (attributes.symbol !== wanted || typeof entry.id !== "string") continue;

    const hours = entry.market_hours ?? {};
    const feed: ReferenceFeed = {
      symbol: ticker,
      feedId: entry.id.replace(/^0x/, ""),
      description: attributes.description ?? "",
      marketHours: {
        isOpen: hours.is_open === true,
        nextOpen: num(hours.next_open),
        nextClose: num(hours.next_close)
      }
    };
    discovery.set(ticker, { feed, at: Date.now() });
    return feed;
  }

  return null;
}

/**
 * The newest on-chain price for a feed.
 *
 * `getProgramAccounts` with a memcmp filter is the only way to find these: an
 * account address is shard-derived, not a function of the feed id, and anyone
 * may post an update, so one feed id maps to many accounts. What matters is the
 * newest, so this scans by `publish_time` rather than trusting the first result
 * — the same approach `scripts/verify-pyth-feeds.ts` uses to decide whether the
 * app has a live feed at all.
 *
 * `dataSlice` keeps the scan to the 28 bytes we read; a busy feed has thousands
 * of accounts and pulling them whole is the difference between a fast call and a
 * timeout.
 *
 * `encoding` is passed explicitly, and that is not optional. Left out, this RPC
 * defaults to base58 and returns `data` as a bare string rather than the
 * `[payload, "base64"]` pair — a difference that produced zero accounts, silently
 * and identically to "this feed has never published". An earlier version skipped
 * any account whose `data` was not a pair, which turned a decoding mistake into
 * an apparent oracle outage. It now decodes what it is given and complains about
 * what it cannot.
 */
async function newestOnChain(
  feedId: string,
  rpcUrl: string
): Promise<{ price: number; confidence: number; publishTime: number } | null> {
  // Only the on-chain read is cached, never the freshness derived from it. The
  // price and its publish time do not change; the age does, every second. A
  // cached `ReferencePrice` would report the age it had when it was read, which
  // is how a two-minute-old read comes to look live.
  const cached = readCache.get(feedId);
  if (cached && Date.now() - cached.at < REFERENCE_TTL_MS) return cached.value;

  // Serialised, and spaced. Both are about the RPC's `getProgramAccounts`
  // allowance, which a burst spends immediately and which is shared by every
  // caller in this process.
  await readQueue;
  let release: () => void = () => {};
  readQueue = new Promise((resolve) => {
    release = resolve;
  });

  try {
    const since = Date.now() - lastReadAt;
    if (lastReadAt > 0 && since < READ_SPACING_MS) await sleep(READ_SPACING_MS - since);
    lastReadAt = Date.now();

    let lastError: PythUnavailableError | null = null;
    for (let attempt = 0; attempt < RPC_ATTEMPTS; attempt += 1) {
      try {
        const value = await newestOnChainOnce(feedId, rpcUrl);
        readCache.set(feedId, { at: Date.now(), value });
        return value;
      } catch (error) {
        if (!(error instanceof PythUnavailableError)) throw error;
        lastError = error;
        // This RPC rate-limits `getProgramAccounts` before anything else it
        // serves, so a 429 here is expected under a modest burst and worth
        // waiting out. Any other failure is an answer.
        if (!error.message.includes("429")) throw error;
        if (attempt < RPC_ATTEMPTS - 1) await sleep(RPC_RETRY_MS);
      }
    }
    throw lastError ?? new PythUnavailableError("every attempt failed");
  } finally {
    release();
  }
}

async function newestOnChainOnce(
  feedId: string,
  rpcUrl: string
): Promise<{ price: number; confidence: number; publishTime: number } | null> {
  let body: unknown;
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getProgramAccounts",
        params: [
          PYTH_RECEIVER,
          {
            encoding: "base64",
            filters: [
              {
                memcmp: {
                  offset: FEED_ID_OFFSET,
                  bytes: bs58.encode(Buffer.from(feedId, "hex"))
                }
              }
            ],
            dataSlice: { offset: PRICE_OFFSET, length: 28 }
          }
        ]
      })
    });
    if (!response.ok) throw new PythUnavailableError(`getProgramAccounts returned ${response.status}`);
    body = await response.json();
  } catch (error) {
    if (error instanceof PythUnavailableError) throw error;
    throw new PythUnavailableError(error instanceof Error ? error.message : String(error));
  }

  const parsed = body as {
    result?: Array<{ pubkey: string; account: { data: unknown } }>;
    error?: { message?: string };
  };
  if (parsed.error) throw new PythUnavailableError(parsed.error.message ?? "rpc error");
  if (!Array.isArray(parsed.result)) throw new PythUnavailableError("rpc returned no result");

  let newest: { price: number; confidence: number; publishTime: number } | null = null;
  let undecodable = 0;

  for (const { account } of parsed.result) {
    const data = decodeAccountData(account?.data);
    if (data === null) {
      undecodable += 1;
      continue;
    }
    if (data.length < 28) continue;

    const publishTime = Number(data.readBigInt64LE(20));
    if (!newest || publishTime > newest.publishTime) {
      const exponent = data.readInt32LE(16);
      const scale = 10 ** exponent;
      newest = {
        price: Number(data.readBigInt64LE(0)) * scale,
        confidence: Number(data.readBigUInt64LE(8)) * scale,
        publishTime
      };
    }
  }

  // If accounts came back and none of them decoded, the fault is ours and
  // saying so beats reporting an oracle that has never published.
  if (!newest && undecodable > 0) {
    throw new PythUnavailableError(
      `${undecodable} account(s) for ${feedId.slice(0, 16)}… came back in a form this reader does not decode`
    );
  }

  return newest;
}

/**
 * The bytes of a `getProgramAccounts` result, whichever shape the RPC chose.
 *
 * Handles both the `[payload, "base64"]` pair and the bare base58 string that
 * this endpoint returns when `encoding` is not specified. Returning null for
 * anything else keeps the caller able to distinguish "no accounts" from "could
 * not read the accounts".
 */
function decodeAccountData(data: unknown): Buffer | null {
  if (Array.isArray(data) && typeof data[0] === "string") {
    return data[1] === "base64"
      ? Buffer.from(data[0], "base64")
      : Buffer.from(bs58.decode(data[0]));
  }
  if (typeof data === "string") return Buffer.from(bs58.decode(data));
  return null;
}

/**
 * Classify an age, given what the market is doing.
 *
 * The order matters. A live feed is live regardless of the schedule; a shut
 * market explains any age up to a long weekend; anything else is a feed that has
 * stopped, and the reason string says which of the two ways, because "46h old"
 * and "46h old with the market open" call for completely different responses.
 */
/**
 * Freshness from an age and the market's own hours — the whole three-state
 * rule, as a pure function so it can be asserted without waiting for a weekend.
 *
 * Exported for `check:pyth`: testing this through a live feed makes the result
 * depend on whether the market happens to be open when the test runs, which is
 * how the "long-weekend reference is usable" case silently passed only on
 * weekends. The states are the logic; the live feed is just one input to it.
 */
export function classify(
  ageSecs: number,
  marketHours: MarketHours
): Freshness {
  if (ageSecs <= MAX_PRICE_AGE_SECS) return { state: "live", ageSecs };

  if (!marketHours.isOpen) {
    if (ageSecs <= MAX_CLOSURE_AGE_SECS) {
      return { state: "closed", ageSecs, nextOpen: marketHours.nextOpen };
    }
    return {
      state: "stale",
      ageSecs,
      reason: `market is shut but the feed has not published in ${Math.floor(ageSecs / 3600)}h — longer than any closure`
    };
  }

  return {
    state: "stale",
    ageSecs,
    reason: `market is open and the feed has not published in ${ageSecs}s (Pyth's bound is ${MAX_PRICE_AGE_SECS}s)`
  };
}

/**
 * The Pyth reference for a US ticker.
 *
 * Throws only when there is no reference to be had at all — no feed, an
 * unreachable listing, an unreadable chain. A *stale* reference is not a throw:
 * it is returned as `freshness.state === "stale"` so the caller decides, because
 * whether a stopped feed should block a route depends on what the route is for,
 * and this module does not know that.
 */
export async function referencePrice(
  symbol: string,
  options: { rpcUrl?: string; nowSeconds?: number } = {}
): Promise<ReferencePrice> {
  const feed = await discoverFeed(symbol);
  if (!feed) throw new PythUnavailableError(`Pyth carries no US equity feed for ${symbol}`);

  const rpcUrl = options.rpcUrl ?? process.env.PYTH_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const newest = await newestOnChain(feed.feedId, rpcUrl);
  if (!newest) {
    throw new PythUnavailableError(
      `no published PriceUpdateV2 for ${symbol} (${feed.feedId.slice(0, 16)}…)`
    );
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ageSecs = Math.max(0, now - newest.publishTime);

  return {
    symbol: feed.symbol,
    feedId: feed.feedId,
    price: newest.price,
    confidence: newest.confidence,
    publishTime: newest.publishTime,
    ageSecs,
    freshness: classify(ageSecs, feed.marketHours),
    marketHours: feed.marketHours
  };
}

/** The reference as a sentence, for a surface that has to explain itself. */
export function describeFreshness(freshness: Freshness): string {
  if (freshness.state === "live") {
    return `live, published ${freshness.ageSecs}s ago`;
  }
  if (freshness.state === "closed") {
    const opens = freshness.nextOpen
      ? `, market opens ${new Date(freshness.nextOpen * 1000).toISOString()}`
      : "";
    return `last close — market shut, published ${Math.floor(freshness.ageSecs / 3600)}h ago${opens}`;
  }
  return `STALE — ${freshness.reason}`;
}
