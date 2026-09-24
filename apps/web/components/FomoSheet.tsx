"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import type { FeedTrade } from "@/lib/types";
import { money, price, qty, synthetic } from "@/lib/format";
import { ApiError, api } from "@/lib/api";
import { signAndSubmitTrade } from "@/lib/wallet-trade";
import { TradeConfirmation } from "@/components/TradeCard";

/**
 * FOMO a trade, at your own size.
 *
 * The signing path is chosen exactly as `TradePanel` chooses it — see the long
 * note there. Both surfaces need the same rule, and it is the same rule because
 * a FOMO is an ordinary trade with a `sourceTradeId` attached, not a different
 * kind of order.
 */
export function FomoSheet({
  trade,
  onDone,
  onClose
}: {
  trade: FeedTrade;
  onDone: (result: FeedTrade) => void;
  onClose: () => void;
}) {
  const suggested = Math.max(10, Math.round(trade.amountUsdc / 2));
  const [amount, setAmount] = useState(String(suggested));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<FeedTrade | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const adapter = useWallet();
  // The viewer's own trade is signed by the viewer's own wallet, and this sheet
  // is only ever opened on a feed the viewer is signed in to. So a connected
  // wallet is the wallet — unless it is a different one, in which case the
  // server-side path is used and the account's own address decides.
  const browserSigns = adapter.connected && adapter.publicKey !== null && adapter.signTransaction !== undefined;

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  /**
   * Buy at your own size, signed by whichever party can sign for this account.
   *
   * The fallback is keyed on the `wallet-signature-required` code, not the
   * message: the route is telling us the account's key is in a browser, which is
   * a decision to act on rather than a sentence to show. See `TradePanel` for
   * the full reasoning — this is the same rule.
   */
  async function submitFomo(): Promise<FeedTrade> {
    // A FOMO is a buy of the same asset, routed as a swap the user's own wallet
    // signs. No server-custody path exists any more, so a wallet is required.
    if (!adapter.connected || !adapter.signTransaction || !adapter.publicKey) {
      throw new Error("Connect a wallet to FOMO. FOBS routes the swap; your wallet signs it.");
    }
    return signAndSubmitTrade(
      { publicKey: adapter.publicKey, signTransaction: adapter.signTransaction },
      { symbol: trade.asset.symbol, side: "buy", amountUsdc: value, sourceTradeId: trade.id }
    );
  }

  const sheet = (
    <div
      className="sheet-backdrop"
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-label={`FOMO ${trade.asset.symbol}`}>
        <div className="sheet-handle" />
        {done ? (
          <div className="sheet-body">
            <TradeConfirmation
              trade={done}
              onDismiss={() => {
                onDone(done);
                onClose();
              }}
            />
          </div>
        ) : (
          <>
            <div className="sheet-header">
              <h3>FOMO {synthetic(trade.asset.symbol)}</h3>
              <button className="secondary" onClick={onClose}>Close</button>
            </div>

            <div className="sheet-body">
              <p className="muted">
                @{trade.user.username} {trade.side === "buy" ? "bought" : "sold"}{" "}
                {money(trade.amountUsdc)} of {trade.asset.symbol} at {price(trade.price)}.
                Set your own size below.
              </p>

              <div className="trade-panel">
                <div className="row">
                  <label className="muted" htmlFor="fomo-sheet-amount">
                    Your size (USDC)
                  </label>
                  <span className="figures">suggested {money(suggested)}</span>
                </div>
                <input
                  ref={inputRef}
                  id="fomo-sheet-amount"
                  className="input"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />

                {valid && trade.price ? (
                  <p className="quote muted">
                    ≈ {qty(value / trade.price)} shares before spread
                  </p>
                ) : null}

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
                      setDone(await submitFomo());
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : "FOMO failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? browserSigns
                      ? "Waiting for your wallet…"
                      : "Signing…"
                    : `Buy ${money(value)} of ${trade.asset.symbol}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(sheet, document.body);
}
