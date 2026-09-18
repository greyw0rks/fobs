"use client";

import Link from "next/link";
import { useState } from "react";
import type { AssetSummary, FeedTrade, WalletBalances } from "@/lib/types";
import { ago, explorerUrl, initials, money, price, qty, shortSignature, synthetic } from "@/lib/format";
import { api } from "@/lib/api";

/**
 * One trade in the feed.
 *
 * The FOMO panel is the only interactive part, and it is deliberately a *sizing*
 * form rather than a confirm button: "FOMO" means "do this too, in my own size",
 * and a one-click copy would be the exact thing the product is not.
 */

export function Avatar({ name, avatar }: { name: string; avatar?: string | null }) {
  return <span className="avatar">{avatar ?? initials(name)}</span>;
}

export function FeedCard({
  trade,
  onFomoed
}: {
  trade: FeedTrade;
  onFomoed?: (trade: FeedTrade) => void;
}) {
  const verb = trade.side === "buy" ? "bought" : "sold";
  const [open, setOpen] = useState(false);

  return (
    <article className="card">
      <div className="row">
        <div className="user">
          <Avatar name={trade.user.displayName} avatar={trade.user.avatar} />
          <span>
            <strong>
              <Link href={`/profile/${trade.user.username}`}>
                {trade.user.displayName}
              </Link>
            </strong>
            <br />
            <span className="muted">
              @{trade.user.username} · {ago(trade.tradedAt)}
            </span>
          </span>
        </div>
        <span className="chip">
          {trade.asset.priceFeedType === "pyth" ? "Pyth priced" : "Mock oracle"}
        </span>
      </div>

      <h3 className="trade-title">
        {verb} {synthetic(trade.asset.symbol)}
      </h3>
      <p className="muted">
        {money(trade.amountUsdc)} · {qty(trade.quantity)} shares at {price(trade.price)}
      </p>

      {trade.source ? (
        <p className="muted">
          FOMO&apos;d{" "}
          <Link href={`/profile/${trade.source.user.username}`}>
            @{trade.source.user.username}
          </Link>
          &apos;s {trade.asset.symbol} trade at their own size ({money(trade.amountUsdc)}{" "}
          vs {money(trade.source.amountUsdc)})
        </p>
      ) : null}

      {trade.fomoCount > 0 ? (
        <p className="muted">
          {trade.fomoCount} {trade.fomoCount === 1 ? "person" : "people"} FOMO&apos;d this
        </p>
      ) : null}

      {/* Proof, not decoration: this is the transaction that moved the money. */}
      {trade.txSignature ? (
        <p className="muted">
          <a href={explorerUrl(trade.txSignature)} target="_blank" rel="noreferrer">
            {shortSignature(trade.txSignature)}
          </a>{" "}
          on devnet
        </p>
      ) : (
        <p className="muted">On chain · signature pending</p>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <Link className="secondary" href={`/asset/${trade.asset.symbol}`}>
          View {trade.asset.symbol}
        </Link>
        {trade.viewerFomoed ? (
          <span className="chip">You FOMO&apos;d this</span>
        ) : (
          <button className="button fomo" onClick={() => setOpen((value) => !value)}>
            {open ? "Cancel" : "FOMO this trade"}
          </button>
        )}
      </div>

      {open && !trade.viewerFomoed ? (
        <FomoForm
          trade={trade}
          onDone={(result) => {
            setOpen(false);
            onFomoed?.(result);
          }}
        />
      ) : null}
    </article>
  );
}

/**
 * Sized by the person, prefilled at half the source trade as a *suggestion* they
 * can overwrite — the amount is never taken from the source.
 */
function FomoForm({
  trade,
  onDone
}: {
  trade: FeedTrade;
  onDone: (trade: FeedTrade) => void;
}) {
  const suggested = Math.max(10, Math.round(trade.amountUsdc / 2));
  const [amount, setAmount] = useState(String(suggested));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <div className="trade-panel" style={{ marginTop: 14 }}>
      <div className="row">
        <label className="muted" htmlFor={`fomo-${trade.id}`}>
          Your size (USDC)
        </label>
        <span className="muted">suggested {money(suggested)}</span>
      </div>
      <input
        id={`fomo-${trade.id}`}
        className="input"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />
      <p className="muted">
        This places your own trade at your own size. It does not copy{" "}
        @{trade.user.username}&apos;s order.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      <button
        className="button"
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const result = await api.fomo(trade.id, value);
            onDone(result.trade);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "FOMO failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Signing…" : `Buy ${money(value)} of ${trade.asset.symbol}`}
      </button>
    </div>
  );
}

/**
 * The confirmation after a trade or a FOMO lands.
 *
 * A trade is the whole point of this product and it takes several seconds of
 * devnet round trips, so it gets more than a line of text that fades: the size,
 * the fill price the *program* computed, and the signature — which is the thing
 * that proves it happened and is the only artifact here worth keeping.
 *
 * Dismissible rather than auto-hiding, because it is a receipt rather than a
 * notification. The old version put a chip above the feed, where it read as
 * decoration and was easy to scroll past without registering that money moved.
 */
export function TradeConfirmation({
  trade,
  onDismiss
}: {
  trade: FeedTrade;
  onDismiss: () => void;
}) {
  const fomo = trade.source !== null;

  return (
    <div className="card" style={{ borderLeft: "4px solid var(--green)" }}>
      <div className="row">
        <h3>{fomo ? "Your FOMO is on chain" : "Your trade is on chain"}</h3>
        <button className="secondary" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      <p className="trade-title">
        {trade.side === "buy" ? "Bought" : "Sold"} {synthetic(trade.asset.symbol)}
      </p>
      <p className="muted">
        {money(trade.amountUsdc)} · filled at {money(trade.price)} per share
      </p>

      {fomo && trade.source ? (
        <p className="muted">
          At your own size —{" "}
          <span className="chip">
            @{trade.source.user.username}&apos;s was {money(trade.source.amountUsdc)}
          </span>
          . Your fill price is yours, not theirs.
        </p>
      ) : null}

      {trade.txSignature ? (
        <p className="muted">
          <a href={explorerUrl(trade.txSignature)} target="_blank" rel="noreferrer">
            {shortSignature(trade.txSignature)}
          </a>{" "}
          on devnet
        </p>
      ) : null}
    </div>
  );
}

/**
 * The trade form on an asset page: same path as a FOMO, no source trade.
 *
 * It knows two things the program will check anyway, and checks them first so
 * the answer arrives instantly and in words rather than as a preflight failure
 * after a devnet round trip: how much test USDC the wallet has, and how many
 * shares it holds. Neither figure disables anything on its own — that would be
 * this form claiming authority the program has — it just refuses to *send* an
 * order it can already see is impossible.
 */
export function TradePanel({
  asset,
  needsWallet,
  balances,
  position,
  onTraded
}: {
  asset: AssetSummary;
  /**
   * The viewer is signed in but has no wallet yet. Their first trade creates
   * one — a keypair, SOL, a token account and test USDC — which is several
   * devnet round trips. Saying so up front turns a slow button into an expected
   * one; finding out afterwards is what makes it feel broken.
   */
  needsWallet?: boolean;
  /** Null when signed out, when there is no wallet, or when devnet was unreadable. */
  balances?: WalletBalances | null;
  /** The viewer's current position in this asset, from the mirrored Holding row. */
  position?: { quantity: number; avgPrice: number } | null;
  onTraded?: (trade: FeedTrade) => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<FeedTrade | null>(null);
  // Seeded from the server so the first paint is right, then re-read after a
  // trade — a balance that survives a fill is a balance that disables the next
  // button for no reason.
  const [wallet, setWallet] = useState<WalletBalances | null>(balances ?? null);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  // A buy spends exactly `amountUsdc`, so this comparison is exact.
  const overBalance =
    side === "buy" && wallet !== null && valid && value > wallet.usdc;
  // A sell needs at least this many shares before the program's spread, which
  // only ever increases the number required. So this catches the clearly
  // impossible case and leaves the borderline one to the program, which is the
  // only thing that knows the spread.
  const estimatedShares = valid && asset.price ? value / asset.price : null;
  const overPosition =
    side === "sell" &&
    position != null &&
    estimatedShares !== null &&
    estimatedShares > position.quantity;

  const blocked = overBalance
    ? `That is more than your test USDC balance of ${money(wallet!.usdc)}. Trade a smaller size.`
    : overPosition
      ? `You hold ${qty(position!.quantity)} shares. Selling ${money(value)} at ${price(asset.price)} would need about ${qty(estimatedShares!)} — more than you have.`
      : null;

  if (done) {
    return (
      <div className="stack">
        <TradeConfirmation trade={done} onDismiss={() => setDone(null)} />
      </div>
    );
  }

  return (
    <div className="panel trade-panel">
      <h3>Trade {synthetic(asset.symbol)}</h3>
      <p className="muted">
        {asset.priceKnown
          ? `Oracle price ${price(asset.price)} · your fill carries the program's spread`
          : "Price not read yet — refresh the indexer on /dev"}
      </p>

      <div className="segmented">
        <button
          className={side === "buy" ? "active" : ""}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
        <button
          className={side === "sell" ? "active" : ""}
          onClick={() => setSide("sell")}
        >
          Sell
        </button>
      </div>

      <label className="muted" htmlFor="trade-amount">
        Amount (USDC)
      </label>
      <input
        id="trade-amount"
        className="input"
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
      />

      {/* Quote from the oracle price, not from a fill: the real price includes
          the spread and is computed by the program. */}
      {valid && asset.priceKnown && asset.price ? (
        <p className="quote muted">
          ≈ {qty(value / asset.price)} shares before spread
        </p>
      ) : null}

      <dl className="muted" style={{ margin: 0 }}>
        <dt>{side === "buy" ? "Test USDC available" : "Shares you hold"}</dt>
        <dd>
          {side === "buy"
            ? wallet === null
              ? "not read"
              : money(wallet.usdc)
            : position == null
              ? "none"
              : `${qty(position.quantity)} at avg ${price(position.avgPrice)}`}
        </dd>
      </dl>

      {error ? <p className="danger">{error}</p> : null}
      {blocked ? <p className="danger">{blocked}</p> : null}

      <button
        className="button"
        disabled={!valid || busy || blocked !== null || (side === "buy" && needsWallet === true)}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const result = await api.trade({
              symbol: asset.symbol,
              side,
              amountUsdc: value
            });
            setDone(result.trade);
            onTraded?.(result.trade);
            // Re-read rather than adjusting locally: the server just spent real
            // USDC, and the next thing this panel does is decide whether the
            // next trade is affordable.
            void api
              .balances()
              .then((fresh) => setWallet(fresh.balances))
              .catch(() => {});
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Trade failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Signing on devnet…" : `${side === "buy" ? "Buy" : "Sell"} ${money(value)}`}
      </button>
      <p className="muted">
        {needsWallet
          ? "Your first trade creates your devnet wallet — a keypair, SOL and test USDC. It takes a few seconds."
          : "Signs a real devnet transaction from this account's wallet."}
      </p>
    </div>
  );
}
