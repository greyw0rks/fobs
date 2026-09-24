/**
 * Token-2022 mint policy: the part of a mint that changes what a balance means.
 *
 * Every PreStocks token is Token-2022, not plain SPL, and every one carries the
 * same extension set. Four of those extensions are load-bearing for this app,
 * and all four fail *silently* if ignored — a wrong number on screen rather
 * than an exception.
 *
 *   scaledUiAmountConfig   a multiplier that changes what a raw balance is worth
 *   transferFeeConfig      a fee withheld on every transfer, doubled at an epoch
 *   permanentDelegate      the issuer can seize or burn any holder's tokens
 *   pausableConfig         the issuer can halt all transfers
 *
 * Verified against mainnet on 2026-09-20 (slot 448831496). SpaceX carries a
 * live ×5 multiplier; OpenAI ×1.4861347. A wallet holding one raw SpaceX unit
 * is holding five scaled units, so pricing a raw balance at the API's per-unit
 * price understates it by 5×. That is the single most likely way this app ships
 * broken and the reason this module exists.
 *
 * ## The multiplier is measured, not assumed
 *
 * Token-2022 interpolates between `multiplier` and `newMultiplier` across the
 * effective timestamp, and the exact ramp is a detail of the runtime rather than
 * something this app should re-derive. So we do not guess: `deriveMultiplier`
 * computes it from two independent observations of the same quantity —
 * `fetchPreStocks().supply` (already scaled) over the mint's raw on-chain supply
 * — and `effectiveMultiplier` is the config-derived fallback for when the API is
 * unreachable. `reconcileMultiplier` prefers the measurement and reports when the
 * two disagree, because a disagreement means an extension changed and the app's
 * belief about every held balance is now stale.
 *
 * ## The fee changes on a schedule, so it is read on a schedule
 *
 * `transferFeeConfig` holds two fees and the epoch each applies from. On
 * 2026-09-20 the schedule was:
 *
 *   olderTransferFee  epoch 1032 →  50 bps
 *   newerTransferFee  epoch 1039 → 100 bps, maximumFee = u64::MAX
 *
 * The chain was at epoch 1038. So the fee was 0.5% and about to become 1.0%
 * within hours — meaning any constant written into this file is wrong by the
 * time it is read. `feeBpsForEpoch` mirrors the runtime's own `get_epoch_fee`
 * selection: older applies strictly below the newer epoch, newer from it onward.
 *
 * ## Why this talks to mainnet regardless of the app's cluster
 *
 * PreStocks tokens are mainnet. The app's own program may be on devnet, and
 * `lib/solana/config.ts`'s `rpcUrl()` follows that. Reusing it here would point
 * these reads at a cluster where the mints do not exist, and the failure would
 * look like "PreStocks is down" rather than "we asked the wrong chain".
 */

export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * The mainnet endpoint every PreStocks read goes through.
 *
 * Deliberately separate from `SOLANA_RPC_URL`. Overridable so a private endpoint
 * can be used where one exists, but defaulting to mainnet because that is where
 * these mints live and a wrong-but-well-formed endpoint fails confusingly.
 *
 * Exported because reading a wallet's PreStocks *balances* needs the same
 * cluster as reading their mint policy — pointing the two at different chains
 * would produce balances that no policy describes.
 */
export function prestocksRpcUrl(): string {
  return process.env.PRESTOCKS_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

const TIMEOUT_MS = 10_000;

/**
 * Multipliers are read far more often than they change, and they only ever
 * change on the issuer's schedule. A minute is short enough that a change is
 * picked up well inside a session and long enough that a portfolio render does
 * not re-fetch a mint account per row.
 */
const CACHE_TTL_MS = 60_000;

export type MintPolicy = {
  mint: string;
  decimals: number;
  /** Raw on-chain supply, in base units. Unscaled. */
  rawSupply: bigint;
  /** `null` when the mint carries no `scaledUiAmountConfig`. */
  scaledUiAmount: {
    multiplier: number;
    newMultiplier: number;
    newMultiplierEffectiveTimestamp: number;
  } | null;
  /** `null` when the mint carries no `transferFeeConfig`. */
  transferFee: {
    older: { epoch: number; basisPoints: number };
    newer: { epoch: number; basisPoints: number };
  } | null;
  /** Can move any holder's tokens without their signature. `null` if unset. */
  permanentDelegate: string | null;
  /** Can freeze individual token accounts. `null` if unset. */
  freezeAuthority: string | null;
  /** `null` when the mint carries no `pausableConfig`. */
  paused: boolean | null;
  /**
   * The program every transfer will call, if the issuer sets one. `null` today
   * on every PreStocks mint, but the authority to set it is live — so the
   * absence is a current fact, not a property of the mint.
   */
  transferHookProgram: string | null;
};

export class MintPolicyError extends Error {
  constructor(mint: string, reason: string) {
    super(`No mint policy for ${mint}: ${reason}`);
    this.name = "MintPolicyError";
  }
}

type RawExtension = { extension?: string; state?: Record<string, unknown> };

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function findExtension(extensions: RawExtension[], name: string): Record<string, unknown> | null {
  const found = extensions.find((entry) => entry.extension === name);
  return found?.state ?? null;
}

/** The mint's policy as the chain reports it. Throws rather than defaulting. */
export async function readMintPolicy(mint: string): Promise<MintPolicy> {
  const cached = policyCache.get(mint);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.policy;

  let body: unknown;
  try {
    const response = await fetch(prestocksRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [mint, { encoding: "jsonParsed" }]
      })
    });
    if (!response.ok) {
      throw new MintPolicyError(mint, `rpc returned ${response.status}`);
    }
    body = await response.json();
  } catch (error) {
    if (error instanceof MintPolicyError) throw error;
    throw new MintPolicyError(mint, error instanceof Error ? error.message : String(error));
  }

  const value = (body as { result?: { value?: unknown } })?.result?.value as
    | { owner?: string; data?: { parsed?: { info?: Record<string, unknown> } } }
    | null
    | undefined;

  if (!value) throw new MintPolicyError(mint, "account not found");
  if (value.owner !== TOKEN_2022_PROGRAM) {
    throw new MintPolicyError(mint, `owner is ${value.owner ?? "unknown"}, not Token-2022`);
  }

  const info = value.data?.parsed?.info;
  if (!info) throw new MintPolicyError(mint, "account did not parse as a mint");

  const decimals = num(info.decimals);
  // Read from the raw string rather than through `Number`. A supply is a u64,
  // and these run to 13 significant digits — past 2^53 a `Number` round-trip
  // would start losing the low digits this module exists to get exactly right.
  const rawSupply =
    typeof info.supply === "string"
      ? BigInt(info.supply)
      : typeof info.supply === "number" && Number.isSafeInteger(info.supply)
        ? BigInt(info.supply)
        : null;
  if (decimals === null || rawSupply === null) {
    throw new MintPolicyError(mint, "mint carried no decimals or supply");
  }

  const extensions = Array.isArray(info.extensions) ? (info.extensions as RawExtension[]) : [];

  const scaled = findExtension(extensions, "scaledUiAmountConfig");
  const fee = findExtension(extensions, "transferFeeConfig");
  const delegate = findExtension(extensions, "permanentDelegate");
  const pause = findExtension(extensions, "pausableConfig");
  const hook = findExtension(extensions, "transferHook");

  const policy: MintPolicy = {
    mint,
    decimals,
    rawSupply,
    scaledUiAmount: scaled
      ? {
          multiplier: num(scaled.multiplier) ?? 1,
          newMultiplier: num(scaled.newMultiplier) ?? 1,
          newMultiplierEffectiveTimestamp: num(scaled.newMultiplierEffectiveTimestamp) ?? 0
        }
      : null,
    transferFee: fee
      ? {
          older: {
            epoch: num((fee.olderTransferFee as Record<string, unknown>)?.epoch) ?? 0,
            basisPoints:
              num((fee.olderTransferFee as Record<string, unknown>)?.transferFeeBasisPoints) ?? 0
          },
          newer: {
            epoch: num((fee.newerTransferFee as Record<string, unknown>)?.epoch) ?? 0,
            basisPoints:
              num((fee.newerTransferFee as Record<string, unknown>)?.transferFeeBasisPoints) ?? 0
          }
        }
      : null,
    permanentDelegate: typeof delegate?.delegate === "string" ? delegate.delegate : null,
    freezeAuthority: typeof info.freezeAuthority === "string" ? info.freezeAuthority : null,
    paused: pause ? Boolean(pause.paused) : null,
    transferHookProgram: typeof hook?.programId === "string" ? hook.programId : null
  };

  policyCache.set(mint, { at: Date.now(), policy });
  return policy;
}

const policyCache = new Map<string, { at: number; policy: MintPolicy }>();

/**
 * The transfer fee in basis points for a given epoch.
 *
 * Mirrors the runtime's `get_epoch_fee`: the older fee applies strictly below
 * the newer fee's epoch, the newer from that epoch onward. An unset fee schedule
 * is zero, which is the correct answer for a mint that charges nothing.
 */
export function feeBpsForEpoch(policy: MintPolicy, epoch: number): number {
  const fee = policy.transferFee;
  if (!fee) return 0;
  return epoch < fee.newer.epoch ? fee.older.basisPoints : fee.newer.basisPoints;
}

/**
 * The cluster's current epoch.
 *
 * Read rather than derived, because the fee schedule is keyed on it and these
 * mints have a change queued at a specific epoch. A cached epoch would go stale
 * exactly when it matters — across the boundary the schedule is waiting on.
 */
export async function readEpoch(): Promise<number> {
  const response = await fetch(prestocksRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getEpochInfo" })
  });
  if (!response.ok) throw new Error(`getEpochInfo returned ${response.status}`);
  const body = (await response.json()) as { result?: { epoch?: number } };
  const epoch = body.result?.epoch;
  if (typeof epoch !== "number") throw new Error("getEpochInfo returned no epoch");
  return epoch;
}

/** The fee in basis points a mint charges right now, epoch and all. */
export async function currentFeeBps(policy: MintPolicy): Promise<number> {
  return feeBpsForEpoch(policy, await readEpoch());
}

/**
 * The multiplier implied by the mint's own config, as of `nowSeconds`.
 *
 * The fallback path. Prefer `reconcileMultiplier`, which measures the value from
 * two sources instead of trusting this one — the runtime interpolates across the
 * effective timestamp and this collapses that ramp to a step.
 */
export function effectiveMultiplier(policy: MintPolicy, nowSeconds: number): number {
  const scaled = policy.scaledUiAmount;
  if (!scaled) return 1;
  const effective =
    scaled.newMultiplierEffectiveTimestamp > 0 &&
    nowSeconds >= scaled.newMultiplierEffectiveTimestamp;
  return effective ? scaled.newMultiplier : scaled.multiplier;
}

/**
 * The multiplier implied by two independent observations of the same supply.
 *
 * `rawSupply` is in base units and `scaledSupply` is in whole tokens, so the
 * mint's decimals divide out first. Omitting that step does not fail loudly —
 * it returns a multiplier short by exactly the decimal factor, which for these
 * mints is 1e-9, and every balance priced with it collapses toward zero.
 */
export function deriveMultiplier(
  rawSupply: bigint,
  decimals: number,
  scaledSupply: number
): number | null {
  if (rawSupply <= 0n || !Number.isFinite(scaledSupply) || scaledSupply <= 0) return null;
  const rawTokens = Number(rawSupply) / 10 ** decimals;
  if (rawTokens <= 0) return null;
  return scaledSupply / rawTokens;
}

/** How far the measured and configured multipliers may drift before we say so. */
const MULTIPLIER_TOLERANCE = 0.005;

export type ReconciledMultiplier = {
  multiplier: number;
  /** `"measured"` is preferred; `"config"` is the fallback. */
  source: "measured" | "config";
  /** Set when both were available and disagreed beyond `MULTIPLIER_TOLERANCE`. */
  disagreement: { measured: number; config: number } | null;
};

/**
 * The multiplier to price a raw balance with.
 *
 * Prefers the measured value: `scaledSupply / rawSupply` is two independent
 * reports of one quantity, and it needs no assumption about how the runtime
 * ramps between multipliers. Falls back to the config when the API is
 * unreachable, and reports a disagreement rather than silently picking a side —
 * a drift means the mint changed underneath us and every held balance in the
 * app is now priced against a stale belief.
 */
export function reconcileMultiplier(
  policy: MintPolicy,
  scaledSupply: number | null,
  nowSeconds: number
): ReconciledMultiplier {
  const config = effectiveMultiplier(policy, nowSeconds);
  const measured =
    scaledSupply === null
      ? null
      : deriveMultiplier(policy.rawSupply, policy.decimals, scaledSupply);

  if (measured === null) return { multiplier: config, source: "config", disagreement: null };

  const relative =
    config > 0 ? Math.abs(measured - config) / config : Math.abs(measured) > 0 ? Infinity : 0;

  return {
    multiplier: measured,
    source: "measured",
    disagreement:
      relative > MULTIPLIER_TOLERANCE ? { measured, config } : null
  };
}

/**
 * A raw on-chain balance in *scaled* units — the units every price is quoted in.
 *
 * This is the function whose absence produces a 5× error on SpaceX, so it is
 * named for the conversion rather than the number, and it takes the policy so
 * that decimals come from the mint rather than from a constant here.
 *
 * Note what it does *not* do: it applies no transfer fee. A balance is not a
 * sale, and the fee is a cost of trading rather than a property of what is held.
 */
export function toScaledAmount(rawAmount: bigint, policy: MintPolicy, multiplier: number): number {
  return (Number(rawAmount) / 10 ** policy.decimals) * multiplier;
}

/** Whether a holder's tokens can be taken or frozen by the issuer. */
export function issuerCanActUnilaterally(policy: MintPolicy): boolean {
  return (
    policy.permanentDelegate !== null ||
    policy.freezeAuthority !== null ||
    policy.paused === true ||
    policy.transferHookProgram !== null
  );
}
