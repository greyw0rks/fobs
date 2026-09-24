/**
 * Display helpers.
 *
 * Two rules apply to everything here:
 *
 *   - A null price is *not* zero. `price` is null until the indexer has read the
 *     oracle, and formatting it as `$0.00` would state something false. Callers
 *     get an em dash and a reason instead.
 *   - Nothing invents data. There is no synthetic "24h change" here because the
 *     app has no way to know one, and a plausible-looking invented percentage
 *     next to a real price is the kind of thing someone trades on.
 */

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const digits = Math.abs(value) >= 1000 ? 0 : 2;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

/** Prices need more precision than balances: these are real oracle values. */
export function price(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })}`;
}

export function qty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function ago(date: string | Date): string {
  const ms = typeof date === "string" ? Date.parse(date) : date.getTime();
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Initials for an avatar fallback, from a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * The disclosure, in one place.
 *
 * These tokens track a real company's price and settle against a vault the
 * operator controls. Calling one "NVDA" would be a claim about owning NVIDIA
 * stock, which is false and is the one piece of framing this product cannot get
 * wrong. Every surface that names an asset goes through here.
 */
/**
 * A display label for an asset symbol. Kept as a seam (callers pass symbols
 * through it) but no longer prefixes "Synthetic" — the tokens are real mainnet
 * tokens FOBS does not issue, so the label is just the symbol.
 */
export function synthetic(symbol: string): string {
  return symbol;
}

export function explorerUrl(signature: string): string {
  // Mainnet is the explorer's default cluster; no query param needed.
  return `https://explorer.solana.com/tx/${signature}`;
}

/** Shortened for display; the full value is available on the Explorer link. */
export function shortSignature(signature: string): string {
  return `${signature.slice(0, 8)}…${signature.slice(-8)}`;
}
