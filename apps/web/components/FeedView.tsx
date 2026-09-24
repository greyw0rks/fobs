"use client";

import { useState } from "react";
import type { FeedTrade, FeedView as FeedViewName } from "@/lib/types";
import { FeedCard, TradeConfirmation } from "@/components/TradeCard";
import { FomoSheet } from "@/components/FomoSheet";
import { LiveDot } from "@/components/AppShell";
import { useLiveFeed } from "@/lib/use-live";

export function FeedView({
  view,
  initial
}: {
  view: FeedViewName;
  initial: FeedTrade[];
}) {
  const { trades, connected, hasMore, loadMore } = useLiveFeed(view, initial);
  const [confirmation, setConfirmation] = useState<FeedTrade | null>(null);
  const [fomoTarget, setFomoTarget] = useState<FeedTrade | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  return (
    <>
      {confirmation ? (
        <TradeConfirmation trade={confirmation} onDismiss={() => setConfirmation(null)} />
      ) : null}

      <div className="row feed-status">
        <span className="muted">
          {trades.length} {trades.length === 1 ? "trade" : "trades"}
        </span>
        <LiveDot connected={connected} />
      </div>

      {trades.length === 0 ? (
        <div className="card">
          <h3>Nothing here yet</h3>
          <p className="muted">
            {view === "following"
              ? "Nobody you follow has traded yet. Follow someone from Friends, or switch to For you to see the whole room."
              : "No trades yet. Make one from Markets to get the room started."}
          </p>
        </div>
      ) : (
        trades.map((trade) => (
          <FeedCard
            key={trade.id}
            trade={trade}
            onFomo={setFomoTarget}
            onFomoed={setConfirmation}
          />
        ))
      )}

      <div className="row feed-footer">
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

      {fomoTarget ? (
        <FomoSheet
          trade={fomoTarget}
          onDone={(result) => {
            setConfirmation(result);
            setFomoTarget(null);
          }}
          onClose={() => setFomoTarget(null)}
        />
      ) : null}
    </>
  );
}

