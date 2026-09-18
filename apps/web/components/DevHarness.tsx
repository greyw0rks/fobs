"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FobsEvent } from "@/lib/server/events";
import { ago, explorerUrl, money, shortSignature } from "@/lib/format";

/**
 * The dev harness.
 *
 * Everything the test environment needs to be drivable from a browser: see the
 * real chain state, refresh the indexer, and produce trades as the test users.
 *
 * The live log at the bottom is the same SSE stream the feed uses, unfiltered —
 * which makes it the fastest way to answer "did that notification actually get
 * created, and for whom".
 */

type Status = {
  assets: {
    symbol: string;
    onchainId: number;
    indexedTrades: number;
    onchainTradeCount: number | null;
    behind: number | null;
    cachedPrice: string | null;
  }[];
  users: {
    username: string;
    displayName: string;
    walletAddress: string | null;
    tradeCount: number;
  }[];
  trades: number;
  notifications: number;
  subscribers: number;
};

const SCENARIOS = [
  { label: "Alice buys $250 sNVDA", trades: [{ username: "alice", symbol: "sNVDA", side: "buy" as const, amountUsdc: 250 }] },
  { label: "Bob buys $120 sTSLA", trades: [{ username: "bob", symbol: "sTSLA", side: "buy" as const, amountUsdc: 120 }] },
  { label: "Charlie buys $80 sAAPL", trades: [{ username: "charlie", symbol: "sAAPL", side: "buy" as const, amountUsdc: 80 }] },
  {
    label: "All three at once",
    trades: [
      { username: "alice", symbol: "sMSFT", side: "buy" as const, amountUsdc: 300 },
      { username: "bob", symbol: "sMSFT", side: "buy" as const, amountUsdc: 40 },
      { username: "charlie", symbol: "sAMZN", side: "buy" as const, amountUsdc: 90 }
    ]
  }
];

export function DevHarness() {
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<FobsEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const call = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch("/api/dev", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Request failed");
        if (payload.status) setStatus(payload.status);
        return payload;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Request failed");
        return null;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  useEffect(() => {
    void call({ action: "status" }, "status");
  }, [call]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as FobsEvent;
        setEvents((current) => [...current.slice(-199), event]);
      } catch {
        // Ignore frames we cannot parse; the log is for humans.
      }
    };
    return () => {
      source.close();
      setConnected(false);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  return (
    <div className="grid">
      <section className="feed">
        {error ? <p className="danger">{error}</p> : null}

        <div className="card">
          <div className="row">
            <h3>Chain state</h3>
            <button
              className="button"
              disabled={busy !== null}
              onClick={() => call({ action: "refresh" }, "refresh")}
            >
              {busy === "refresh" ? "Indexing…" : "Refresh indexer"}
            </button>
          </div>
          <p className="muted">
            Reads each asset&apos;s <code>trade_count</code> from the program and
            ingests any receipts the cursor has not seen.
          </p>
          {status ? (
            <div className="asset-list">
              {status.assets.map((asset) => (
                <div className="asset-row" key={asset.symbol}>
                  <span>
                    <strong>{asset.symbol}</strong>
                    <br />
                    <span className="muted">
                      id {asset.onchainId} · price{" "}
                      {asset.cachedPrice ? money(Number(asset.cachedPrice)) : "not read"}
                    </span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <span className="muted">
                      indexed {asset.indexedTrades} / onchain{" "}
                      {asset.onchainTradeCount ?? "?"}
                    </span>
                    <br />
                    {asset.behind === null ? (
                      <span className="chip">unreachable</span>
                    ) : asset.behind === 0 ? (
                      <span className="chip">in sync</span>
                    ) : (
                      <span className="chip">{asset.behind} behind</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </div>

        <div className="card">
          <h3>Seed trades</h3>
          <p className="muted">
            Each of these signs a real devnet transaction from that user&apos;s wallet,
            then indexes it. Watch the log below — you should see a{" "}
            <code>trade</code> event and one <code>notification</code> per follower.
          </p>
          <div className="row">
            {SCENARIOS.map((scenario) => (
              <button
                key={scenario.label}
                className="secondary"
                disabled={busy !== null}
                onClick={() =>
                  call({ action: "seed", trades: scenario.trades }, scenario.label)
                }
              >
                {busy === scenario.label ? "Signing…" : scenario.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="row">
            <h3>Live events</h3>
            <span className="chip">
              {connected ? "connected" : "reconnecting"} · {status?.subscribers ?? 0}{" "}
              subscriber{status?.subscribers === 1 ? "" : "s"}
            </span>
          </div>
          <div
            ref={logRef}
            style={{
              maxHeight: 320,
              overflowY: "auto",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12
            }}
          >
            {events.length === 0 ? (
              <p className="muted">
                Nothing yet. Seed a trade, or open the feed in another tab.
              </p>
            ) : (
              events.map((event, index) => (
                <div key={index} style={{ padding: "2px 0" }}>
                  <EventLine event={event} />
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <aside className="stack">
        <div className="panel">
          <h3>
            Users
            <span className="chip" style={{ marginLeft: 8 }}>
              {status?.trades ?? 0} trades · {status?.notifications ?? 0} notifications
            </span>
          </h3>
          {status?.users.map((user) => (
            <div key={user.username} style={{ marginBottom: 10 }}>
              <strong>{user.displayName}</strong>
              <br />
              <span className="muted">
                @{user.username} · {user.tradeCount}{" "}
                {user.tradeCount === 1 ? "trade" : "trades"}
                <br />
                {user.walletAddress
                  ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-6)}`
                  : "no wallet"}
              </span>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>Fund wallets</h3>
          <p className="muted">
            From a terminal, at the repo root:
            <br />
            <code>pnpm devnet:users</code>
          </p>
          <p className="muted">
            Devnet SOL comes from the admin wallet rather than an airdrop, because
            devnet throttles airdrops hard enough that a four-user run fails halfway.
          </p>
        </div>

        <div className="panel disclosure">
          The harness signs real devnet transactions as the seeded accounts. It is
          refused outright when <code>NODE_ENV=production</code>.
        </div>
      </aside>
    </div>
  );
}

function EventLine({ event }: { event: FobsEvent }) {
  if (event.type === "trade") {
    return (
      <>
        <span style={{ color: "#18a058" }}>trade</span> @{event.username}{" "}
        {event.side} {money(Number(event.amountUsdc))} {event.assetSymbol}
        {event.sourceTradeId ? " (FOMO)" : ""}
        {event.txSignature ? (
          <>
            {" "}
            <a href={explorerUrl(event.txSignature)} target="_blank" rel="noreferrer">
              {shortSignature(event.txSignature)}
            </a>
          </>
        ) : null}
      </>
    );
  }
  if (event.type === "notification") {
    return (
      <>
        <span style={{ color: "#7a5af8" }}>notify</span> {event.kind} →{" "}
        {event.userId.slice(0, 6)}… from @{event.actorUsername ?? "system"}{" "}
        {event.assetSymbol ?? ""}
      </>
    );
  }
  return (
    <>
      <span className="muted">
        indexer pass: {event.assets} assets, {event.tradesIngested} new trades ·{" "}
        {ago(event.at)}
      </span>
    </>
  );
}
