"use client";

import { useState } from "react";
import type { FeedTrade, FeedView as FeedViewName } from "@/lib/types";
import { FeedCard, TradeConfirmation } from "@/components/TradeCard";
import { LiveDot } from "@/components/AppShell";
import { useLiveFeed } from "@/lib/use-live";

/**
 * The feed, wired to the live wire.
 *
 * Server-rendered trades arrive as `initial` so the first paint is complete
 * without a client fetch; the subscription then keeps it current. Refetches go
 * through the same query the server used, so a trade that arrives over SSE
 * renders through exactly the same path as one that was there at load.
 */
export function FeedView({
  view,
  initial
}: {
  view: FeedViewName;
  initial: FeedTrade[];
}) {
  const { trades, connected, hasMore, loadMore } = useLiveFeed(view, initial);
  const [confirmation, setConfirmation] = useState<FeedTrade | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  return (
    <>
      {confirmation ? (
        <TradeConfirmation trade={confirmation} onDismiss={() => setConfirmation(null)} />
      ) : null}

      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted">{trades.length} trades</span>
        <LiveDot connected={connected} />
      </div>

      {trades.length === 0 ? (
        <div className="card">
          <h3>Nothing here yet</h3>
          <p className="muted">
            {view === "following"
              ? "Nobody you follow has traded yet. Follow someone from Friends, or switch to For you to see the whole room."
              : "No trades have been indexed. Make one from Markets, or run the indexer from /dev."}
          </p>
        </div>
      ) : (
        trades.map((trade) => (
          <FeedCard key={trade.id} trade={trade} onFomoed={setConfirmation} />
        ))
      )}

      <div className="row" style={{ marginTop: 16, justifyContent: "center" }}>
        {loadError ? (
          <p className="danger">{loadError}</p>
        ) : hasMore ? (
          <button
            className="secondary"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              setLoadError(null);
              try {
                await loadMore();
              } catch (caught) {
                setLoadError(
                  caught instanceof Error ? caught.message : "Could not load more trades."
                );
              } finally {
                setLoadingMore(false);
              }
            }}
          >
            {loadingMore ? "Loading…" : "Load more trades"}
          </button>
        ) : (
          <p className="muted">
            {trades.length === 0
              ? null
              : `That is all ${trades.length} indexed ${trades.length === 1 ? "trade" : "trades"}.`}
          </p>
        )}
      </div>
    </>
  );
}

