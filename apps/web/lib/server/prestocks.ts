/**
 * PreStocks: tokenized pre-IPO equity, and the only pre-IPO issuer this app touches.
 *
 * PreStocks issues eight tokens on Solana — SPACEX, OPENAI, ANTHROPIC, ANDURIL,
 * KALSHI, NEURALINK, POLYMARKET, FIGUREAI — each described by its own issuer as
 * "backed 1:1 by SPV exposure that tracks the price of the underlying private
 * company." They trade on mainnet through Jupiter, which is the whole reason
 * this app can carry them: routing is a client concern, so fobs integrates
 * pre-IPO equity without deploying a program or holding a token.
 *
 * The endpoint is public — no key, no auth — and returns eleven fields per
 * token. Two of them carry the product:
 *
 *   markPrice   the SPV-backed reference mark
 *   tokenPrice  what the token actually trades at
 *
 * Their ratio is a premium, and it is wildly dispersed. On 2026-09-20 the
 * snapshot ranged from SPACEX at −22.1% (market *below* the SPV mark) to
 * NEURALINK at +26.2%. That single number is the most informative fact in the
 * pre-IPO market and no aggregator surfaces it, because surface it naively is
 * worse than not surfacing it at all — see `premium` and `netPremium`.
 *
 * ## The supply field is not the on-chain supply
 *
 * `supply` here is the *scaled* supply: on-chain raw supply multiplied by the
 * mint's `scaledUiAmountConfig` multiplier. Verified exact on 2026-09-20:
 *
 *   SpaceX  raw 8742.506753069 × 5          = 43712.533765345 = API supply
 *   OpenAI  raw 1901.878196904 × 1.4861347  =  2826.447183592 = API supply
 *
 * Both multipliers were already live (effective Jun 10 and Jul 17, 2026). This
 * matters because it means the API's prices are quoted per *scaled* unit — so
 * `tokenPrice × supply` is a market cap, but `tokenPrice × rawBalance` is not a
 * position value. It is wrong by the multiplier, which is 5× on SpaceX. Any
 * code that prices a user's holdings must go through `token2022.ts` first.
 *
 * The rest of the endpoint is presentation (name, description, image, links) and
 * two company-level valuations we keep for the detail page. Neither is used in
 * any arithmetic we do.
 *
 * ## The endpoint rate-limits, and the limit is sticky
 *
 * This is the fact most likely to be got wrong, because the failure looks like
 * an outage. The endpoint sits behind Vercel, which starts returning 429 after
 * roughly three requests in a twenty-second window **per IP** — and once
 * tripped, the penalty outlives the burst that caused it. Measured on
 * 2026-09-20: seven consecutive 429s across twenty seconds of three-second
 * polling, from a single IP that had done nothing but poll politely.
 *
 * Two consequences, both encoded below and both counter-intuitive:
 *
 *   - A 429 is **never retried**. It is the one failure that gets worse when you
 *     ask again, and the first version of this file did exactly that. A timeout
 *     is silence and worth repeating; a 429 is an instruction.
 *   - The cache TTL is a rate-limit budget, not just a freshness knob. It was
 *     15s, which is a request every fifteen seconds per process, which is enough
 *     to hold a penalty open indefinitely.
 *
 * `scripts/check-prestocks.ts` asserts on request counts for exactly this
 * reason: the policy is only correct relative to what the endpoint permits, and
 * a change that looks harmless locally can spend the whole allowance.
 */

import { describeError } from "./describe-error";

const API_URL = "https://prestocks.com/api/prestocks";

/** A quote request is a fetch, not a trade: fail fast. */
const TIMEOUT_MS = 8_000;

/**
 * How long a fetched snapshot is reused.
 *
 * This was 15s until 2026-09-20, chosen on the reasoning that a static snapshot
 * makes a short TTL free. That reasoning ignored the endpoint's own limit: it is
 * fronted by Vercel, which starts returning 429 after roughly three requests in
 * a twenty-second window *per IP* — and the penalty is sticky, outliving the
 * burst that caused it. A minute costs nothing in accuracy for a snapshot that
 * updates far more slowly than that, and it keeps a page render well inside the
 * allowance. Do not lower this without re-measuring the limit.
 */
const CACHE_TTL_MS = 60_000;

/**
 * How long to stop asking after being told to stop.
 *
 * A 429 here is not a hiccup to retry through — retrying is what *deepens* the
 * penalty, and a burst of them was measured continuing for seven consecutive
 * requests across twenty seconds after the limit tripped. So the response is to
 * actually back off, and to remember it: without this, the next page render
 * arrives seconds later and re-trips a limit that had just begun to recover.
 */
const RATE_LIMIT_COOLDOWN_MS = 60_000;

export type PreStockToken = {
  symbol: string;
  name: string;
  /** Token-2022 mint address, base58. Always `Pre…`-prefixed. */
  mint: string;
  description: string;
  image: string | null;
  externalUrl: string | null;
  /** SPV-backed reference mark, USD per scaled unit. */
  markPrice: number;
  /** Live market price, USD per scaled unit. */
  tokenPrice: number;
  /** Company valuation implied by the SPV mark. Company-level, not per-token. */
  markValuation: number;
  /** Company valuation implied by the market price. Company-level. */
  impliedValuation: number;
  /**
   * Scaled supply — on-chain raw supply × the mint's scaledUiAmount multiplier.
   * Not a balance, and not comparable to a wallet's raw token amount.
   */
  supply: number;
  /**
   * `tokenPrice / markPrice − 1`. Positive means the market is paying above the
   * SPV's own mark. This is the *gross* figure; it does not account for the
   * transfer fee a round trip costs, which is why `netPremium` exists.
   */
  premium: number;
};

export class PreStocksUnavailableError extends Error {
  constructor(reason: string) {
    super(`No PreStocks data: ${reason}`);
    this.name = "PreStocksUnavailableError";
  }
}

/**
 * The shape the endpoint returns, before we have validated it.
 *
 * Every field is optional because none of this is our data: the endpoint is
 * unversioned and unauthenticated, so a field rename is a live possibility and
 * a parse that assumes otherwise turns a schema change into a crash. We check
 * what we use and drop what we do not.
 */
type RawToken = {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  external_url?: string;
  contract_address?: string;
  markPrice?: number | string;
  markValuation?: number | string;
  tokenPrice?: number | string;
  impliedValuation?: number | string;
  supply?: number | string;
};

/** The endpoint has been seen to return these as strings as well as numbers. */
function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Either a priced token, or the field that stopped it being one. */
type ParseResult = { ok: true; token: PreStockToken } | { ok: false; reason: string };

/**
 * One raw record to one token, or a reason it was refused.
 *
 * The reason carries its weight. On 2026-09-20 the endpoint was caught
 * returning records with `tokenPrice` and `supply` set to `null` — 58 bytes
 * short of a full response, roughly one request in twelve, and it took the
 * market from eight tokens to one. An earlier version of this function returned
 * a bare `null`, so all that reached the log was that seven tokens had vanished;
 * naming the field is the difference between a diagnosable outage and an
 * alarming one.
 *
 * A record is refused rather than defaulted: a token we cannot price is dropped
 * and reported, and a token we price wrongly is a lie told to a user.
 */
function parseToken(raw: RawToken): ParseResult {
  const symbol = str(raw.symbol) ?? "<no symbol>";
  const name = str(raw.name);
  const mint = str(raw.contract_address);
  const markPrice = num(raw.markPrice);
  const tokenPrice = num(raw.tokenPrice);
  const supply = num(raw.supply);

  if (!name || !mint || markPrice === null || tokenPrice === null || supply === null) {
    const missing = [
      !name && "name",
      !mint && "contract_address",
      markPrice === null && "markPrice",
      tokenPrice === null && "tokenPrice",
      supply === null && "supply"
    ]
      .filter(Boolean)
      .join(", ");
    return { ok: false, reason: `${symbol}: missing ${missing}` };
  }

  if (markPrice <= 0 || tokenPrice <= 0 || supply <= 0) {
    const invalid = [
      markPrice <= 0 && `markPrice=${markPrice}`,
      tokenPrice <= 0 && `tokenPrice=${tokenPrice}`,
      supply <= 0 && `supply=${supply}`
    ]
      .filter(Boolean)
      .join(", ");
    return { ok: false, reason: `${symbol}: non-positive ${invalid}` };
  }

  return {
    ok: true,
    token: {
      symbol,
      name,
      mint,
      description: str(raw.description) ?? "",
      image: str(raw.image),
      externalUrl: str(raw.external_url),
      markPrice,
      tokenPrice,
      markValuation: num(raw.markValuation) ?? 0,
      impliedValuation: num(raw.impliedValuation) ?? 0,
      supply,
      premium: tokenPrice / markPrice - 1
    }
  };
}

/** One fetch of the endpoint, split into what parsed and what did not. */
type Attempt = { tokens: PreStockToken[]; dropped: string[] };

/** How long to wait before retrying a request that never got an answer. */
const TRANSPORT_RETRY_MS = 500;

/**
 * A request that never reached the endpoint.
 *
 * Separate from its parent so the retry decision is a type check rather than a
 * match against message text. It is still a `PreStocksUnavailableError`, so every
 * caller that already handles an unreachable endpoint handles this too — the
 * distinction only matters to the one function doing the retrying.
 *
 * Note what is *not* here: an HTTP status. A status is an answer, and the two
 * answers worth distinguishing — 429 and 5xx — are both ones where asking again
 * promptly is the wrong move. Only a silence is worth repeating.
 */
class TransportError extends PreStocksUnavailableError {
  constructor(reason: string) {
    super(reason);
    this.name = "TransportError";
  }
}

/**
 * When the endpoint last told us to stop, and for how long.
 *
 * Module state rather than per-call, because the limit is per-IP and per-process
 * is the closest thing this app has to that. It is deliberately not persisted:
 * a fresh process should be allowed to ask once and find out for itself.
 */
let rateLimitedUntil = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One request, parsed as far as it goes.
 *
 * Returning the drops rather than throwing on the first bad record is what lets
 * the caller tell a single malformed record from a wholesale shape change. The
 * transport errors are still thrown — an unreachable endpoint is not a partial
 * read, and there is nothing to compare a retry against.
 */
async function requestOnce(): Promise<Attempt> {
  let response: Response;
  try {
    response = await fetch(API_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new TransportError(describeError(error));
  }

  if (!response.ok) {
    // 429 is a rate limit, and it is the one failure here that gets *worse* if
    // you retry it — see `requestTokens`. Record the cooldown before reporting.
    if (response.status === 429) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      throw new PreStocksUnavailableError(
        `rate limited by the issuer's endpoint (HTTP 429) — backing off for ` +
          `${RATE_LIMIT_COOLDOWN_MS / 1000}s rather than retrying into it`
      );
    }
    throw new PreStocksUnavailableError(`endpoint returned ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    // A 200 carrying something that is not JSON. That is a shape problem, not a
    // transport one, so it is not retried — the next request would look the same.
    throw new PreStocksUnavailableError(`response was not JSON: ${describeError(error)}`);
  }

  if (!Array.isArray(payload)) {
    throw new PreStocksUnavailableError("response was not an array");
  }

  const tokens: PreStockToken[] = [];
  const dropped: string[] = [];
  for (const entry of payload as RawToken[]) {
    const result = parseToken(entry);
    if (result.ok) tokens.push(result.token);
    else dropped.push(result.reason);
  }

  return { tokens, dropped };
}

/**
 * One request, retried once if it never got an answer.
 *
 * Exactly one retry, and only for a request that went unanswered. The endpoint
 * is flaky in two independent ways — it rate-limits hard, and it intermittently
 * nulls out `tokenPrice` and `supply` — but neither improves by being asked
 * twice in quick succession. A timeout is evidence about the network and asking
 * again is diligence; a 429 is an *instruction*, and a second request sent
 * 500ms later is disobeying it. That distinction was learned the hard way: the
 * first version of this retried 429s and turned a brief limit into a long one.
 */
async function requestTokens(): Promise<Attempt> {
  // Checked before the first request, so a page render that arrives during a
  // cooldown does not reopen a limit that had begun to recover. The cache is
  // consulted ahead of this, so a snapshot inside its TTL is still served.
  if (Date.now() < rateLimitedUntil) {
    const remaining = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
    throw new PreStocksUnavailableError(
      `still inside the backoff after a rate limit — ${remaining}s to go`
    );
  }

  try {
    return await requestOnce();
  } catch (error) {
    if (!(error instanceof TransportError)) throw error;
    await sleep(TRANSPORT_RETRY_MS);
    return await requestOnce();
  }
}

let cache: { at: number; tokens: PreStockToken[] } | null = null;
let inFlight: Promise<PreStockToken[]> | null = null;

/**
 * Every PreStocks token, priced.
 *
 * Throws rather than returning a stale or empty list. An empty list would read
 * downstream as "this app does not carry pre-IPO equity", which is a product
 * claim made by an outage — the same class of dishonesty as a defaulted price.
 * The cached value is only ever served inside its TTL.
 *
 * Concurrent callers share one request. A page that renders the router and the
 * premium table in the same pass should not issue two fetches.
 */
export async function fetchPreStocks(): Promise<PreStockToken[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.tokens;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let attempt = await requestTokens();

    // The endpoint intermittently returns records with `tokenPrice` and `supply`
    // gutted to null — caught live, roughly one request in twelve. A partial
    // read is worth one retry before it becomes anyone's problem, because the
    // fault is per-request rather than sustained and the second attempt usually
    // is complete. Only a retry that actually recovers more is kept.
    if (attempt.dropped.length > 0) {
      const retry = await requestTokens().catch(() => null);
      if (retry && retry.dropped.length < attempt.dropped.length) attempt = retry;
    }

    const total = attempt.tokens.length + attempt.dropped.length;
    if (attempt.tokens.length === 0) {
      throw new PreStocksUnavailableError(
        `every record was unparseable — ${attempt.dropped.join("; ")}`
      );
    }

    // Losing a minority of records is a bad record; losing half of them is a
    // market we do not know. The distinction is the whole point: rendering eight
    // names when one failed is honest, and rendering *one* name when seven
    // failed is a plausible-looking market that is missing seven eighths of
    // itself, with nothing on screen to say so. So the majority case throws —
    // the page then says it could not read, which is true.
    if (attempt.dropped.length * 2 >= total) {
      throw new PreStocksUnavailableError(
        `${attempt.dropped.length} of ${total} records unparseable — ` +
          `the endpoint changed shape: ${attempt.dropped.join("; ")}`
      );
    }

    // Loud, because a shrinking list is how an exclusivity problem or an API
    // change would first show up, and both are worse the longer they go unseen.
    if (attempt.dropped.length > 0) {
      console.warn(
        `[prestocks] dropped ${attempt.dropped.length} of ${total}: ${attempt.dropped.join("; ")}`
      );
    }

    cache = { at: Date.now(), tokens: attempt.tokens };
    return attempt.tokens;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** One token by symbol (`"SPACEX"`), or undefined. */
export async function fetchPreStock(symbol: string): Promise<PreStockToken | undefined> {
  const tokens = await fetchPreStocks();
  return tokens.find((token) => token.symbol === symbol.toUpperCase());
}
