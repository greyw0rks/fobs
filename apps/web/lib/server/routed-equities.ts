/**
 * Routed tokenized equities: Backed's xStocks and Ondo's tokenized stocks.
 *
 * These are the tokens PreStocks is not. PreStocks issues private-company
 * exposure — SpaceX, OpenAI — where there is no public market and therefore no
 * oracle. Both issuers here wrap *listed* companies, so every token has an
 * underlying with a Pyth reference feed and can be checked rather than merely
 * quoted. That is the whole reason `deviation.ts` can exist.
 *
 * ## Two issuers, same companies, very different routes
 *
 * On 2026-09-20, for NVDA specifically:
 *
 *   xStock   NVDAx    via Riptide     $222.08 implied  0.19% impact   usable
 *   Ondo     NVDAon   via Manifest   $1,466.42 implied   84.9% impact   a dead pool
 *
 * Ondo's own documentation says its liquidity comes from NASDAQ and NYSE with
 * near-zero slippage, and that is true of its mint/redeem rail — but Jupiter
 * routes through on-chain pools, and Ondo's Solana pool for this pair holds
 * almost nothing. The implied price scaling with trade size is the tell: $597 at
 * a $10 probe, $1,466 at $1,000, $4,947 at $5,000. That is not a dislocation in
 * a market; it is the absence of one.
 *
 * So a token being listed and routable says nothing about whether it is
 * tradeable, and the deviation guard is what tells the two apart. Listing
 * multiple issuers is worth it for exactly that reason.
 *
 * ## Discovery by ticker is a trap, and this module pins addresses because of it
 *
 * Jupiter's token search will happily return a memecoin for any ticker you type.
 * Searching `NVDA` on 2026-09-20 returned, in order, `Next Value Dog Asset`,
 * `Nonstop Voluptuous Digital`, and only then the actual NVIDIA xStock — all
 * three with symbol `NVDA`, all three Token-2022. `MSFT` returned `Meowcrosoft`.
 * A registry built by asking for a ticker and taking the first answer would have
 * routed users into someone's joke, and it would have looked like it worked.
 *
 * So addresses are pinned here, verified against each issuer's own metadata, and
 * **re-validated on every read**. The validation is the point: a pin alone rots
 * silently, and the signature is cheap to check.
 */

const SEARCH_URL = "https://api.jup.ag/tokens/v2/search";

const TIMEOUT_MS = 10_000;

/**
 * Jupiter's token endpoint throttles hard: measured on 2026-09-20, five
 * sequential lookups succeed and the sixth returns 429 — and the penalty is
 * sticky, with calls seven through nine still failing at 300ms spacing.
 *
 * That made one-call-per-mint unworkable. The registry has ten pinned mints, so
 * a per-mint loop spent its whole allowance before reaching AMZN and reported the
 * last symbols as "not pinned", which is a rate limit wearing the costume of a
 * missing token.
 *
 * `query` accepts a comma-separated list and returns exactly the mints asked
 * for, so the whole registry is one request. That is the fix — the retry below
 * only covers the case where that single call is the one that gets throttled.
 */
const SEARCH_RETRY_MS = 1_500;
const SEARCH_ATTEMPTS = 3;

/** Cached for the process: token metadata does not change under us. */
let cache: { at: number; tokens: SearchResult[] } | null = null;
let inFlight: Promise<SearchResult[]> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Metadata for every pinned mint, in one request, cached.
 *
 * Serialised through `inFlight` so two concurrent callers cannot each spend one
 * of the five calls the endpoint allows.
 */
async function searchTokens(mints: string[]): Promise<SearchResult[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.tokens;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const query = mints.join(",");
    let lastStatus = 0;

    for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(
          `${SEARCH_URL}?query=${encodeURIComponent(query)}`,
          {
            headers: { accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS)
          }
        );

        if (response.ok) {
          const payload: unknown = await response.json();
          if (!Array.isArray(payload)) {
            throw new RoutedEquityError("token search was not an array");
          }
          cache = { at: Date.now(), tokens: payload as SearchResult[] };
          return payload as SearchResult[];
        }

        lastStatus = response.status;
        // Only a rate limit is worth repeating. Anything else is an answer.
        if (response.status !== 429) break;
        if (attempt < SEARCH_ATTEMPTS - 1) await sleep(SEARCH_RETRY_MS);
      } catch (error) {
        if (error instanceof RoutedEquityError) throw error;
        // A timeout is silence, and worth one more ask.
        if (attempt === SEARCH_ATTEMPTS - 1) {
          throw new RoutedEquityError(
            `token search: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        await sleep(SEARCH_RETRY_MS);
      }
    }

    throw new RoutedEquityError(
      lastStatus === 429
        ? `token search is rate limited (429) for all ${SEARCH_ATTEMPTS} attempts`
        : `token search returned ${lastStatus}`
    );
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export type Issuer = "Backed" | "Ondo";

/** Token-2022, which every token here uses. */
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type RoutedEquity = {
  /** Which issuer minted it. Two issuers means two prices for one share. */
  issuer: Issuer;
  /** The underlying's US ticker — `NVDA`. This is the key the Pyth feed uses. */
  symbol: string;
  /** The routed token's symbol — `NVDAx`, `NVDAon`. */
  tokenSymbol: string;
  name: string;
  mint: string;
  decimals: number;
};

type IssuerSpec = {
  issuer: Issuer;
  /** Pinned 2026-09-20, image-host-style verification, see below. */
  pins: Record<string, string>;
  /** What establishes provenance for this issuer. */
  validate: (token: SearchResult) => string | null;
};

type SearchResult = {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  tokenProgram?: string;
};

/**
 * An xStock is identified by the issuer's metadata host — names, symbols and
 * mint prefixes are all free to anyone, but only Backed can serve a logo from
 * `xstocks-metadata.backed.fi`. The `Xs` mint prefix and trailing `x` are
 * corroboration, not proof.
 */
const BACKED: IssuerSpec = {
  issuer: "Backed",
  pins: {
    AAPL: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    AMZN: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    COIN: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    GOOGL: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    META: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    MSFT: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    MSTR: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    NVDA: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    TSLA: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"
  },
  validate: (token) => {
    if (!token.symbol?.endsWith("x")) return `${token.symbol ?? "?"} does not end in x`;
    if (!token.icon?.includes("xstocks-metadata.backed.fi")) {
      return "icon is not served by xstocks-metadata.backed.fi";
    }
    return null;
  }
};

/**
 * An Ondo token is identified the same way, by `cdn.ondo.finance`, with the
 * `ondo` mint suffix and the `on` symbol suffix as corroboration.
 */
const ONDO: IssuerSpec = {
  issuer: "Ondo",
  pins: {
    NVDA: "gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo"
  },
  validate: (token) => {
    if (!token.symbol?.endsWith("on")) return `${token.symbol ?? "?"} does not end in on`;
    if (!token.icon?.includes("cdn.ondo.finance")) {
      return "icon is not served by cdn.ondo.finance";
    }
    return null;
  }
};

const ISSUERS: IssuerSpec[] = [BACKED, ONDO];

/** Underlyings this app will route, ordered for display. */
export const SUPPORTED = ["NVDA", "AAPL", "MSFT", "TSLA", "AMZN"] as const;

export class RoutedEquityError extends Error {
  constructor(reason: string) {
    super(`No routed equity: ${reason}`);
    this.name = "RoutedEquityError";
  }
}

/** Every pinned mint, across every issuer. What the one search asks for. */
function everyPinnedMint(): string[] {
  const mints: string[] = [];
  for (const spec of ISSUERS) {
    for (const mint of Object.values(spec.pins)) {
      if (!mints.includes(mint)) mints.push(mint);
    }
  }
  return mints;
}

/**
 * The routed token for a ticker from a given issuer, validated against that
 * issuer's metadata.
 *
 * Throws rather than returning an unvalidated token. A registry that falls back
 * to "probably this one" is worse than no registry, because the failure is
 * invisible — the user gets a token, the app gets a price, and neither is the
 * share.
 */
export async function routedEquityFor(
  issuer: Issuer,
  symbol: string
): Promise<RoutedEquity> {
  const spec = ISSUERS.find((candidate) => candidate.issuer === issuer);
  if (!spec) throw new RoutedEquityError(`unknown issuer ${issuer}`);

  const ticker = symbol.toUpperCase();
  const mint = spec.pins[ticker];
  if (!mint) throw new RoutedEquityError(`${issuer} does not list ${ticker}`);

  const results = await searchTokens(everyPinnedMint());
  const match = results.find((token) => token.id === mint);
  if (!match) {
    throw new RoutedEquityError(`${issuer} ${ticker}: pinned mint ${mint} is not listed any more`);
  }
  if (match.tokenProgram !== TOKEN_2022_PROGRAM) {
    throw new RoutedEquityError(`${issuer} ${ticker}: not Token-2022 (${match.tokenProgram ?? "?"})`);
  }
  if (typeof match.decimals !== "number") {
    throw new RoutedEquityError(`${issuer} ${ticker}: no decimals`);
  }

  const problem = spec.validate(match);
  if (problem) throw new RoutedEquityError(`${issuer} ${ticker}: ${problem}`);

  return {
    issuer,
    symbol: ticker,
    tokenSymbol: match.symbol ?? ticker,
    name: match.name ?? ticker,
    mint,
    decimals: match.decimals
  };
}

/**
 * Every issuer's token for every supported ticker, with per-pair failures
 * reported rather than thrown.
 *
 * Sequential, not parallel: every endpoint this touches throttles, and fanning
 * eighteen searches at once is how the last module earned a 429.
 */
export async function routedEquities(
  symbols: readonly string[] = SUPPORTED
): Promise<{ equities: RoutedEquity[]; failures: { label: string; reason: string }[] }> {
  const equities: RoutedEquity[] = [];
  const failures: { label: string; reason: string }[] = [];

  for (const symbol of symbols) {
    for (const spec of ISSUERS) {
      if (!spec.pins[symbol.toUpperCase()]) continue;
      try {
        equities.push(await routedEquityFor(spec.issuer, symbol));
      } catch (error) {
        failures.push({
          label: `${spec.issuer} ${symbol.toUpperCase()}`,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return { equities, failures };
}
