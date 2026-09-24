/**
 * Measure, per venue, whether Jupiter's quote is net of the transfer fee.
 *
 * Run: `pnpm calibrate:venues` (add `-- SYMBOL` to check one token)
 *
 * `quote.ts` encodes a claim that Jupiter documents nowhere: that on a Meteora
 * DLMM route the quoted output is what arrives, and on a Manifest route it is
 * not. The only way that claim stays true is if something re-measures it, so
 * this script does the thing the module cannot — it builds the swap, simulates
 * it, and reads what the destination account actually receives.
 *
 * The measurement is a balance delta, not an inference. A buy moves the
 * fee-bearing token out of the pool and into the user, so among that mint's
 * post-simulation balances the pool is debited by the gross amount and the user
 * is credited with the net. The difference is the withheld fee, and comparing
 * the user's credit against Jupiter's `outAmount` says which side of the ledger
 * the quote was on.
 *
 * Exits non-zero if any measurement contradicts `VENUE_NETTING`, so this can
 * gate a deploy the same way `verify:prestocks` does.
 *
 * ## How the sell direction finds a holder
 *
 * A simulation executes against current state, so selling needs a wallet that
 * already holds the token. The obvious source, `getTokenLargestAccounts`, is
 * unavailable: every public endpoint either refuses it outright (`publicnode`
 * wants a personal token for "indexed requests") or rate-limits that one method
 * specifically (`api.mainnet-beta` returns 429 for it while answering everything
 * else). Chasing endpoints is a dead end.
 *
 * But the mint account is a party to every transfer of itself, so
 * `getSignaturesForAddress` on the mint lists recent trading, and each of those
 * transactions, parsed, names the counterparties and their balances. That gives
 * candidate owners; `getTokenAccountsByOwner` then confirms a candidate really
 * holds the mint and reports how much. Neither call is restricted.
 *
 * Candidates are tried in order until one simulates, because discovery cannot
 * tell a wallet from a pool authority by inspection — a liquidity pool holds the
 * token too, and its owner is a PDA that cannot sign a top-level transfer. Rather
 * than guessing at the difference, the loop lets the runtime answer: the pool
 * candidate fails and the next one is tried. First success wins, and if every
 * candidate fails the direction is reported as unmeasured rather than skipped
 * quietly.
 */

import { fetchPreStocks, type PreStockToken } from "../lib/server/prestocks";
import { applyNetting, nettingFor, type Direction, type NettingBehavior } from "../lib/server/quote";
import { feeBpsForEpoch, readEpoch, readMintPolicy, type MintPolicy } from "../lib/server/token2022";

const RPC = process.env.PRESTOCKS_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const JUPITER = process.env.JUPITER_API_URL ?? "https://lite-api.jup.ag/swap/v1";

/** USDC on mainnet. The quote currency for every route here. */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

/** How much to move per probe. Small enough to keep price impact out of the way. */
const PROBE_USDC = 100;

/**
 * The fallback simulated owner, used only for buys. It is a large public wallet
 * that holds USDC, so a buy simulates without needing to source a holder first.
 */
const FALLBACK_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const TIMEOUT_MS = 30_000;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) throw new Error(`${method} returned ${response.status}`);
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
  if (body.result === undefined) throw new Error(`${method}: no result`);
  return body.result;
}

type TokenBalance = {
  accountIndex: number;
  mint: string;
  uiTokenAmount: { amount: string };
};

type Simulation = {
  err: unknown;
  logs?: string[];
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
};

/**
 * The credited and debited totals for one mint across a simulation.
 *
 * Sums rather than taking the extremes: a route can touch more than one account
 * per mint, and a split route can touch several pools.
 */
function deltasFor(
  simulation: Simulation,
  mint: string
): { credited: bigint; debited: bigint } {
  const pre = new Map<number, bigint>();
  for (const balance of simulation.preTokenBalances ?? []) {
    if (balance.mint === mint) pre.set(balance.accountIndex, BigInt(balance.uiTokenAmount.amount));
  }

  let credited = 0n;
  let debited = 0n;
  for (const balance of simulation.postTokenBalances ?? []) {
    if (balance.mint !== mint) continue;
    const before = pre.get(balance.accountIndex) ?? 0n;
    const after = BigInt(balance.uiTokenAmount.amount);
    const delta = after - before;
    if (delta > 0n) credited += delta;
    else debited += -delta;
  }
  return { credited, debited };
}

async function jupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint
): Promise<Record<string, unknown>> {
  const url =
    `${JUPITER}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amount.toString()}&slippageBps=100`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`quote returned ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function jupiterSwap(quoteResponse: Record<string, unknown>, wallet: string): Promise<string> {
  const response = await fetch(`${JUPITER}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ quoteResponse, userPublicKey: wallet, wrapAndUnwrapSol: true })
  });
  if (!response.ok) throw new Error(`swap returned ${response.status}`);
  const body = (await response.json()) as { swapTransaction?: string };
  if (!body.swapTransaction) throw new Error("swap returned no transaction");
  return body.swapTransaction;
}

async function simulate(transaction: string): Promise<Simulation> {
  const response = await rpc<{ value?: Simulation }>("simulateTransaction", [
    transaction,
    {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "processed"
    }
  ]);

  // `simulateTransaction` wraps its payload in `{context, value}` like most read
  // methods. Reading the result one level too shallow yields `undefined` for
  // every field, which reads downstream as "no balances moved" — a silent zero
  // that looks exactly like a token nobody traded.
  const value = response.value;
  if (!value) throw new Error("simulation returned no value");
  if (value.err) throw new Error(`simulation failed: ${JSON.stringify(value.err)}`);
  if (!value.postTokenBalances?.length) {
    throw new Error("simulation reported no token balances — cannot measure");
  }
  return value;
}

/** A wallet holding the mint, and the balance that qualifies it as the seller. */
type HolderCandidate = { owner: string; balance: bigint };

/**
 * Holders found for a mint, or why none could be.
 *
 * Returns a reason on failure rather than an empty list, because "the endpoint
 * rate limited us" and "nobody holds this" are different problems with different
 * fixes, and a lookup that reports both as one reads as the second.
 */
type HolderLookup = { ok: true; candidates: HolderCandidate[] } | { ok: false; reason: string };

/** How many of the mint's recent transactions to read while hunting owners. */
const SIGNATURE_SCAN = 12;

/** Distinct owners to confirm. The first that simulates is the one used. */
const CANDIDATE_LIMIT = 4;

/** Spacing between reads, to stay a polite guest on a shared endpoint. */
const READ_SPACING_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ParsedTransaction = {
  meta?: {
    preTokenBalances?: { mint?: string; owner?: string }[];
    postTokenBalances?: { mint?: string; owner?: string }[];
  } | null;
};

/**
 * Read a transaction, tolerating the ones the client's default version rejects.
 *
 * Some recent transactions declare a newer version than `maxSupportedTransactionVersion: 0`
 * admits. The RPC names the fix in its own error, so it is taken once before
 * giving up — dropping these silently would quietly shrink the candidate pool and
 * present as "nobody holds this".
 */
async function parsedTransaction(signature: string): Promise<ParsedTransaction | null> {
  const read = (version: number) =>
    rpc<ParsedTransaction | null>("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: version }
    ]);

  try {
    return await read(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("maxSupportedTransactionVersion")) return null;
    try {
      return await read(1);
    } catch {
      return null;
    }
  }
}

/**
 * Owners that have recently touched this mint, newest first.
 *
 * Both `pre` and `post` balances are read: an owner that sent its entire balance
 * appears only in the former and one that received only in the latter, so
 * reading just one side would quietly halve the candidate pool.
 */
async function candidateOwners(mint: string): Promise<string[]> {
  const signatures = await rpc<{ signature: string; err?: unknown }[]>(
    "getSignaturesForAddress",
    [mint, { limit: SIGNATURE_SCAN }]
  );

  const owners: string[] = [];
  for (const entry of signatures) {
    if (entry.err) continue;

    const tx = await parsedTransaction(entry.signature);

    for (const balance of [
      ...(tx?.meta?.postTokenBalances ?? []),
      ...(tx?.meta?.preTokenBalances ?? [])
    ]) {
      if (balance.mint !== mint) continue;
      if (typeof balance.owner !== "string") continue;
      if (!owners.includes(balance.owner)) owners.push(balance.owner);
    }

    if (owners.length >= CANDIDATE_LIMIT) break;
    await sleep(READ_SPACING_MS);
  }
  return owners;
}

/**
 * Confirm an owner really holds the mint, and how much.
 *
 * The confirmation is the part that matters: a liquidity pool holds the token
 * too, and its owner is a PDA that cannot sign a top-level transfer. A zero
 * balance is not a holder, and is reported as such rather than returned as one.
 */
async function confirmHolder(owner: string, mint: string): Promise<bigint | null> {
  const result = await rpc<{
    value?: {
      account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } };
    }[];
  }>("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);

  let largest = 0n;
  for (const entry of result.value ?? []) {
    const amount = entry.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amount !== "string") continue;
    const value = BigInt(amount);
    if (value > largest) largest = value;
  }
  return largest > 0n ? largest : null;
}

async function holderFor(mint: string): Promise<HolderLookup> {
  try {
    const owners = await candidateOwners(mint);
    if (owners.length === 0) {
      return { ok: false, reason: "no recent transfers named an owner" };
    }

    const candidates: HolderCandidate[] = [];
    for (const owner of owners) {
      const balance = await confirmHolder(owner, mint);
      if (balance !== null) candidates.push({ owner, balance });
      await sleep(READ_SPACING_MS);
    }

    return candidates.length > 0
      ? { ok: true, candidates }
      : { ok: false, reason: `none of ${owners.length} candidate owner(s) held the mint` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * How much of a holder's bag to sell.
 *
 * A tenth of it, capped at a thousandth of supply. The bag bound is what makes
 * the simulation succeed at all — a probe larger than the wallet holds fails,
 * and sizing from the mint's supply instead is exactly how that happened. The
 * supply bound keeps a large holder's probe from pushing the pool, which would
 * confound the fee being measured with price impact.
 */
function sellProbeSize(holderBalance: bigint, rawSupply: bigint): bigint {
  const byBag = holderBalance / 10n;
  const bySupply = rawSupply / 1_000n;
  return byBag < bySupply ? byBag : bySupply;
}

type Probe = {
  direction: Direction;
  venues: string[];
  quoted: bigint;
  received: bigint;
  withheld: bigint;
  /**
   * The fee actually withheld, in basis points of the fee-bearing side's own
   * gross movement.
   *
   * Computed against that side rather than against `quoted`, because on a sell
   * the two are different mints — tokens withheld against USDC quoted — and the
   * ratio of those is a number with units that mean nothing. It read 349bps
   * against a scheduled 50bps on one Manifest sell before this existed.
   */
  withheldBps: number;
  /** Which hypothesis the measurement fits, or `ambiguous` if neither does. */
  measured: NettingBehavior | "ambiguous";
  /** Relative error of each hypothesis, for reporting. */
  fit: { nets: number; gross: number };
  /** What `VENUE_NETTING` predicted, so a mismatch is visible. */
  predicted: NettingBehavior;
  unverified: string[];
};

/** How close is close enough. One basis point — well under the fee itself. */
const FIT_TOLERANCE = 1e-4;

function relativeError(actual: bigint, expected: bigint): number {
  if (expected === 0n) return actual === 0n ? 0 : Number.POSITIVE_INFINITY;
  const diff = actual > expected ? actual - expected : expected - actual;
  return Number(diff) / Number(expected);
}

/**
 * Decide which hypothesis the measurement supports.
 *
 * Not `quoted === received`: a quote is struck at one slot and executed at
 * another, so the two can differ by a base unit or two without anything being
 * wrong. Classifying on exact equality would flip a venue's entry on drift, and
 * a silently flipped entry is worse than a reported ambiguous one — so the test
 * is which hypothesis fits better, with a tie reported rather than guessed.
 */
function classify(
  quoted: bigint,
  received: bigint,
  feeBps: number
): { measured: NettingBehavior | "ambiguous"; fit: { nets: number; gross: number } } {
  const netsExpected = quoted;
  const grossExpected = applyNetting(quoted, feeBps, "gross").outAmount;

  // With no fee the two hypotheses are the same statement, and so is the answer.
  if (grossExpected === netsExpected) return { measured: "nets", fit: { nets: 0, gross: 0 } };

  const fit = {
    nets: relativeError(received, netsExpected),
    gross: relativeError(received, grossExpected)
  };

  if (fit.nets <= FIT_TOLERANCE && fit.nets <= fit.gross) return { measured: "nets", fit };
  if (fit.gross <= FIT_TOLERANCE && fit.gross < fit.nets) return { measured: "gross", fit };
  return { measured: "ambiguous", fit };
}

/** Either a measurement, or why one could not be taken. */
type ProbeOutcome = { ok: true; probe: Probe } | { ok: false; reason: string };

/**
 * Quote, simulate, and read what landed — for a wallet and size already decided.
 *
 * The fee-bearing mint is always the PreStocks token — `policy.mint` — and the
 * direction decides which end of the swap that is. Everything else follows from
 * the two balance deltas.
 */
async function measure(
  token: PreStockToken,
  policy: MintPolicy,
  direction: Direction,
  feeBps: number,
  wallet: string,
  amount: bigint
): Promise<Probe> {
  const inputMint = direction === "buy" ? USDC_MINT : policy.mint;
  const outputMint = direction === "buy" ? policy.mint : USDC_MINT;

  const quote = await jupiterQuote(inputMint, outputMint, amount);
  const quoted = BigInt(String(quote.outAmount));

  const transaction = await jupiterSwap(quote, wallet);
  const simulation = await simulate(transaction);

  // The fee-bearing mint is where the fee shows up, whichever end it is on.
  const feeSide = deltasFor(simulation, policy.mint);
  const withheld = feeSide.debited > feeSide.credited ? feeSide.debited - feeSide.credited : 0n;
  const withheldBps =
    feeSide.debited > 0n ? (Number(withheld) * 10_000) / Number(feeSide.debited) : 0;

  const outputSide = deltasFor(simulation, outputMint);
  const received = outputSide.credited;

  // A zero here is the failure mode this whole script exists to avoid: it reads
  // identically to a genuine measurement if nothing checks. If the fee-bearing
  // mint moved nothing, the simulation told us nothing.
  if (feeSide.debited === 0n && feeSide.credited === 0n) {
    throw new Error(`simulation moved no ${token.symbol} — nothing to measure`);
  }

  const venues = ((quote.routePlan as { swapInfo?: { label?: string } }[] | undefined) ?? [])
    .map((leg) => leg.swapInfo?.label)
    .filter((label): label is string => typeof label === "string");

  const { behavior: predicted, unverified } = nettingFor(venues, direction);
  const { measured, fit } = classify(quoted, received, feeBps);

  return {
    direction,
    venues,
    quoted,
    received,
    withheld,
    withheldBps,
    measured,
    fit,
    predicted,
    unverified
  };
}

/**
 * One direction for one token, deciding who is trading and for how much.
 *
 * A buy always simulates from the same funded wallet at a fixed USD size, so
 * consecutive runs are comparable. A sell cannot — it needs a wallet that holds
 * the token, and the size has to come from that wallet's bag.
 *
 * Candidates are tried in order until one simulates. Discovery cannot tell a
 * wallet from a pool authority by inspection: a pool holds the token too, and
 * its owner is a PDA that cannot sign a top-level transfer. Rather than guess at
 * that difference, this lets the runtime answer — the pool candidate fails and
 * the next is tried. Only when every candidate has failed is the direction
 * reported unmeasured, and it says why.
 */
async function probe(
  token: PreStockToken,
  policy: MintPolicy,
  direction: Direction,
  feeBps: number
): Promise<ProbeOutcome> {
  if (direction === "buy") {
    const amount = BigInt(PROBE_USDC) * 10n ** BigInt(USDC_DECIMALS);
    return { ok: true, probe: await measure(token, policy, direction, feeBps, FALLBACK_WALLET, amount) };
  }

  const lookup = await holderFor(policy.mint);
  if (!lookup.ok) return { ok: false, reason: lookup.reason };

  const failures: string[] = [];
  for (const candidate of lookup.candidates) {
    const amount = sellProbeSize(candidate.balance, policy.rawSupply);
    if (amount <= 0n) {
      failures.push(`${candidate.owner.slice(0, 8)}… holds too little to probe`);
      continue;
    }

    // If the fee truncates to zero base units at this size there is nothing to
    // detect: quoted and received would agree whether or not Jupiter modelled
    // the transfer fee, and reporting that agreement as "nets" would be a
    // measurement of nothing. A smaller holder is not a worse witness, it is a
    // witness with nothing to say.
    if (feeBps > 0 && (amount * BigInt(feeBps)) / 10_000n === 0n) {
      failures.push(
        `${candidate.owner.slice(0, 8)}… holds too little for a ${feeBps}bps fee to be visible`
      );
      continue;
    }

    try {
      const probe = await measure(token, policy, direction, feeBps, candidate.owner, amount);
      return { ok: true, probe };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.owner.slice(0, 8)}… ${reason}`);
    }
  }

  return {
    ok: false,
    reason: `all ${lookup.candidates.length} candidate(s) failed to simulate — ${failures.join("; ")}`
  };
}

/**
 * Format a base-unit amount for display.
 *
 * Never renders a value that exists as `0`. A small-but-real fee shown as `0` is
 * indistinguishable from the silent-zero failure this script was written to
 * catch, and one Meteora sell was very nearly read that way.
 */
function fmt(value: bigint, decimals: number): string {
  if (value === 0n) return "0";
  const asNumber = Number(value) / 10 ** decimals;
  const rounded = asNumber.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return rounded === "0" || rounded === "-0" ? asNumber.toExponential(3) : rounded;
}

async function main(): Promise<void> {
  // pnpm forwards the `--` separator through to argv rather than eating it, so
  // the first non-flag argument is the symbol, not necessarily argv[2].
  const only = process.argv
    .slice(2)
    .find((arg) => !arg.startsWith("-"))
    ?.toUpperCase();
  const epoch = await readEpoch();
  console.log(`mainnet epoch ${epoch}\n`);

  const all = await fetchPreStocks();
  const tokens = only ? all.filter((token) => token.symbol === only) : all;
  if (tokens.length === 0) throw new Error(`no token matching ${only}`);

  let mismatches = 0;
  let splitRouteNotes = 0;
  let measuredSells = 0;

  for (const token of tokens) {
    console.log(`${token.symbol}  ${token.mint}`);
    const policy = await readMintPolicy(token.mint);
    const feeBps = feeBpsForEpoch(policy, epoch);
    const decimals = policy.decimals;

    for (const direction of ["buy", "sell"] as Direction[]) {
      let outcome: ProbeOutcome;
      try {
        outcome = await probe(token, policy, direction, feeBps);
      } catch (error) {
        console.log(
          `  ${direction.padEnd(4)} could not measure: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }

      if (!outcome.ok) {
        console.log(`  ${direction.padEnd(4)} unmeasured — ${outcome.reason}`);
        continue;
      }
      const result = outcome.probe;

      const venue = result.venues.join("+") || "<no label>";
      const isSplit = result.venues.length > 1;
      const agree = result.measured === result.predicted;
      const amountDecimals = direction === "buy" ? decimals : USDC_DECIMALS;

      console.log(
        `  ${direction.padEnd(4)} ${venue.padEnd(18)} ` +
          `quoted ${fmt(result.quoted, amountDecimals).padStart(13)}  ` +
          `received ${fmt(result.received, amountDecimals).padStart(13)}  ` +
          `withheld ${fmt(result.withheld, decimals).padStart(11)}  ` +
          `→ ${result.measured}${agree ? "" : `  !! predicted ${result.predicted}`}`
      );

      if (result.measured === "ambiguous") {
        console.log(
          isSplit
            ? `       split route with an unmeasured leg — a per-venue table cannot ` +
              `represent a mix, so gross is assumed. nets off by ` +
              `${(result.fit.nets * 100).toFixed(3)}%, gross off by ` +
              `${(result.fit.gross * 100).toFixed(3)}%`
            : `       fits neither hypothesis on a single-leg route — nets off by ` +
              `${(result.fit.nets * 100).toFixed(3)}%, gross off by ` +
              `${(result.fit.gross * 100).toFixed(3)}%`
        );
      } else if (result.measured === "gross" && result.withheld > 0n) {
        console.log(
          `       withheld ${result.withheldBps.toFixed(1)}bps against a scheduled ${feeBps}bps; ` +
            `gross hypothesis off by ${(result.fit.gross * 100).toFixed(4)}% ` +
            `(quote-vs-execution drift, not a model error)`
        );
      }
      if (result.unverified.length > 0) {
        console.log(
          `       unverified venue(s): ${result.unverified.join(", ")} — ` +
            `route treated as gross, which is the safe direction`
        );
      }

      // Only a single-leg route can falsify the table. A split route mixing a
      // measured venue with an unmeasured one is *expected* to fit neither
      // hypothesis, and failing on it would mean failing on the design working
      // as intended — the route was treated as gross, which under-promises.
      const falsifies = !isSplit && (!agree || result.measured === "ambiguous");
      if (falsifies) mismatches += 1;
      if (isSplit && !agree) splitRouteNotes += 1;
      if (direction === "sell") measuredSells += 1;
    }
  }

  console.log(
    `\n${tokens.length} tokens, ${mismatches} single-leg mismatch(es), ` +
      `${splitRouteNotes} split route(s) treated conservatively, ` +
      `${measuredSells} sell direction(s) measured`
  );
  if (mismatches > 0) {
    console.log(
      "A single-leg mismatch means VENUE_NETTING has a venue wrong — add or correct it."
    );
  }
  if (splitRouteNotes > 0) {
    console.log(
      "Split-route ambiguity is expected: one leg is unmeasured, so the quote is " +
        "treated as gross and under-promises. Not a failure, but the venue list is " +
        "worth watching — it changes between runs."
    );
  }
  if (measuredSells === 0) {
    console.log(
      "No sell direction was measured, so the sell entries in VENUE_NETTING remain " +
        "conservative defaults rather than measurements. The per-token reasons above say " +
        "whether that was a missing holder or a simulation that would not run."
    );
  }
  if (mismatches > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
