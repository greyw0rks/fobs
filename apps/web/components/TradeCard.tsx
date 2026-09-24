"use client";

import Link from "next/link";
import type { AssetSummary, FeedTrade, WalletBalances } from "@/lib/types";
import { ago, explorerUrl, initials, money, price, qty, shortSignature, synthetic } from "@/lib/format";
import { ApiError, api } from "@/lib/api";
import { signAndSubmitTrade } from "@/lib/wallet-trade";
import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";

/**
 * One trade in the feed.
 *
 * The FOMO panel is the only interactive part, and it is deliberately a *sizing*
 * form rather than a confirm button: "FOMO" means "do this too, in my own size",
 * and a one-click copy would be the exact thing the product is not.
 */

export function Avatar({
  name,
  avatar,
  size
}: {
  name: string;
  avatar?: string | null;
  size?: "md" | "lg";
}) {
  const hue = name ? name.charCodeAt(0) % 5 : 0;
  return (
    <span className={`avatar${size === "lg" ? " lg" : ""}`} data-hue={hue}>
      {avatar ?? initials(name)}
    </span>
  );
}

export function FeedCard({
  trade,
  onFomo,
  onFomoed
}: {
  trade: FeedTrade;
  onFomo?: (trade: FeedTrade) => void;
  onFomoed?: (trade: FeedTrade) => void;
}) {
  const verb = trade.side === "buy" ? "Bought" : "Sold";

  return (
    <article className={`card trade-card ${trade.side}`}>
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
        {trade.viewerFomoed ? (
          <span className="chip">You FOMO&apos;d this</span>
        ) : (
          <button className="button fomo" onClick={() => onFomo?.(trade)}>
            FOMO
          </button>
        )}
      </div>

      <div className="trade-hero">
        <div>
          <h3 className="trade-title">
            {verb} <span className="num">{trade.asset.symbol}</span>
          </h3>
          <p className="figures">
            {qty(trade.quantity)} tokens at {price(trade.price)}
          </p>
        </div>
        <div className="text-right">
          <span className="num trade-amount">{money(trade.amountUsdc)}</span>
          <br />
          <span className="chip">
            {trade.asset.priceFeedType === "pyth" ? "Pyth" : "Market"}
          </span>
        </div>
      </div>

      {trade.source ? (
        <p className="muted">
          FOMO&apos;d{" "}
          <Link href={`/profile/${trade.source.user.username}`}>
            @{trade.source.user.username}
          </Link>
          &apos;s trade ({money(trade.amountUsdc)} vs {money(trade.source.amountUsdc)})
        </p>
      ) : null}

      <div className="card-footer">
        {trade.fomoCount > 0 ? (
          <span className="muted">
            {trade.fomoCount} {trade.fomoCount === 1 ? "FOMO" : "FOMOs"}
          </span>
        ) : null}
        {trade.txSignature ? (
          <a className="muted" href={explorerUrl(trade.txSignature)} target="_blank" rel="noreferrer">
            {shortSignature(trade.txSignature)}
          </a>
        ) : null}
        <Link className="muted" href={`/asset/${trade.asset.symbol}`}>
          View {trade.asset.symbol}
        </Link>
      </div>
    </article>
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
    <div
      className={`card confirmed ${trade.side === "buy" ? "buy" : "sell"}`}
    >
      <div className="row">
        <h3>{fomo ? "Your FOMO is on chain" : "Your trade is on chain"}</h3>
        <button className="secondary" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      <p className="trade-title">
        {trade.side === "buy" ? "Bought" : "Sold"} {synthetic(trade.asset.symbol)}
      </p>
      <p className="figures">
        {money(trade.amountUsdc)} · filled at {money(trade.price)} per token
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
          on mainnet
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
  walletAddress,
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
  /**
   * The account's own trading wallet, from the session — the address the server
   * will build any trade for. Used only to decide whether the connected browser
   * wallet is the right one to sign with; it is never sent anywhere.
   */
  walletAddress?: string | null;
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

  const adapter = useWallet();

  /**
   * Who signs the transaction.
   *
   * The connected wallet only gets to sign when it *is* the account's trading
   * wallet. A visitor can be signed in as one account and have a different
   * wallet selected in Phantom, and handing that wallet a transaction owned by
   * someone else produces a signature failure deep inside the wallet — which
   * reads as "Phantom is broken" rather than "that is not your wallet".
   *
   * `wallet.address` is the session account's own address, from the server. When
   * the two match, the browser signs and the key never leaves it. When they do
   * not — or when nothing is connected — the server signs, and if the account
   * has no server-held key at all the route says so and we surface that.
   */
  const connectedAddress = adapter.publicKey?.toBase58() ?? null;
  const accountAddress = walletAddress ?? null;
  const browserSigns =
    adapter.connected && connectedAddress !== null && connectedAddress === accountAddress;

  const mismatchedWallet =
    adapter.connected && connectedAddress !== null && accountAddress !== null && !browserSigns;

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

  // The ceiling for the current side, when it has actually been read: buying is
  // capped by USDC on hand, selling by the value of the position. Null (so the
  // "Max" pill is hidden) when the figure is unknown, rather than a fake 0.
  const maxAmount =
    side === "buy"
      ? wallet !== null
        ? wallet.usdc
        : null
      : position != null && asset.price
        ? position.quantity * asset.price
        : null;

  const blocked = overBalance
    ? `That is more than your USDC balance of ${money(wallet!.usdc)}. Trade a smaller size.`
    : overPosition
      ? `You hold ${qty(position!.quantity)} tokens. Selling ${money(value)} at ${price(asset.price)} would need about ${qty(estimatedShares!)} — more than you have.`
      : null;

  if (done) {
    return (
      <div className="stack">
        <TradeConfirmation trade={done} onDismiss={() => setDone(null)} />
      </div>
    );
  }

  /**
   * Send the order by whichever path this account can actually use, and fall
   * back once if the server says the browser is the only option.
   *
   * The fallback is keyed on the `wallet-signature-required` code rather than on
   * the message, because the message is prose and prose gets edited. It is not
   * attempted when the browser already signed — in that case a refusal is a
   * real refusal and retrying it server-side would be retrying the same thing
   * that just failed.
   */
  async function submit(): Promise<FeedTrade> {
    // The bridge signs nothing: a trade is a Jupiter swap the user's own wallet
    // signs. There is no server-custody path any more, so a connected wallet is
    // required, full stop.
    if (!adapter.connected || !adapter.signTransaction || !adapter.publicKey) {
      throw new Error("Connect a wallet to trade. FOBS routes the swap; your wallet signs it.");
    }
    return signAndSubmitTrade(
      { publicKey: adapter.publicKey, signTransaction: adapter.signTransaction },
      { symbol: asset.symbol, side, amountUsdc: value }
    );
  }

  return (
    <div className="panel trade-panel">
      <h3>Trade {synthetic(asset.symbol)}</h3>
      <p className="muted">
        {asset.priceKnown
          ? `Oracle price ${price(asset.price)} · your fill carries the program's spread`
          : "Price not read yet — try again in a moment"}
      </p>

      <div className="segmented">
        <button
          className={`buy${side === "buy" ? " active" : ""}`}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
        <button
          className={`sell${side === "sell" ? " active" : ""}`}
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

      {/* Quick-select sizes. "Max" is the honest ceiling for the side: a buy is
          capped by USDC on hand, a sell by the value of the position — and it is
          only offered when that figure has actually been read. */}
      <div className="preset-pills">
        {[50, 100, 500].map((preset) => (
          <button
            key={preset}
            type="button"
            className={`preset${Number(amount) === preset ? " active" : ""}`}
            onClick={() => setAmount(String(preset))}
          >
            ${preset}
          </button>
        ))}
        {maxAmount !== null ? (
          <button
            type="button"
            className="preset"
            onClick={() => setAmount(maxAmount.toFixed(2))}
          >
            Max
          </button>
        ) : null}
      </div>

      {/* Quote from the oracle price, not from a fill: the real price includes
          the spread and is computed by the program. */}
      {valid && asset.priceKnown && asset.price ? (
        <p className="quote muted">
          ≈ {qty(value / asset.price)} tokens before fees
        </p>
      ) : null}

      <dl className="muted">
        <dt>{side === "buy" ? "USDC available" : "Tokens you hold"}</dt>
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
      {mismatchedWallet ? (
        <p className="muted">
          Your browser wallet is not this account&apos;s trading wallet, so this order will be
          signed by the account instead. To sign it yourself, connect{" "}
          <span className="mono">
            {accountAddress?.slice(0, 4)}…{accountAddress?.slice(-4)}
          </span>
          .
        </p>
      ) : null}

      <button
        className={`button ${side}`}
        disabled={!valid || busy || blocked !== null || (side === "buy" && needsWallet === true)}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const trade = await submit();
            setDone(trade);
            onTraded?.(trade);
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
        {busy
          ? browserSigns
            ? "Waiting for your wallet…"
            : "Submitting…"
          : `${side === "buy" ? "Buy" : "Sell"} ${money(value)}`}
      </button>
      <p className="muted">
        {browserSigns
          ? "Routes a real swap on mainnet and signs it in your wallet. This server never holds your key."
          : "Connect a wallet to trade. FOBS routes the swap; your wallet signs it, on mainnet."}
      </p>
    </div>
  );
}
