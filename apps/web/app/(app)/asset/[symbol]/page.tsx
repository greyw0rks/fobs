import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, FeedCard, TradePanel } from "@/components/TradeCard";
import { PriceChart } from "@/components/PriceChart";
import {
  countHolders,
  getAssetBySymbol,
  getHolding,
  listFollowersHolding,
  listTradesForAsset
} from "@/lib/server/queries";
import { getWalletBalances } from "@/lib/server/balances";
import { currentUserOrDevFallback } from "@/lib/server/session";
import { ago, money, price, qty, synthetic } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssetPage({
  params
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const viewer = await currentUserOrDevFallback();
  const asset = await getAssetBySymbol(symbol);
  if (!asset) notFound();

  const viewerId = viewer?.id ?? null;
  const [trades, holders, followedHolders, balances, position] = await Promise.all([
    // Trades for this asset only, newest first — the same rows the chart plots,
    // so the list and the chart can never disagree about what happened.
    listTradesForAsset(asset.id, 50),
    countHolders(asset.id),
    listFollowersHolding(asset.id, viewerId),
    // Read live from devnet, not from Postgres: the trade panel refuses a trade
    // against this number, and a stale one would refuse a trade that is fine.
    getWalletBalances(viewer?.walletAddress ?? null),
    viewerId ? getHolding(viewerId, asset.id) : Promise.resolve(null)
  ]);

  // FOMOs, not a separate action feed: a FOMO is a trade with a source, so this
  // is the same query filtered. `listTradesForAsset` already carries `source`.
  const fomos = trades.filter((trade) => trade.source !== null);

  return (
    <>
      <div className="topbar">
        <div>
          <h2>
            {synthetic(asset.symbol)} <span className="chip">{asset.symbol}</span>
          </h2>
          <p className="muted">
            {asset.name} · tracks its price, confers no ownership
          </p>
        </div>
      </div>

      <div className="grid">
        <section className="feed">
          <div className="card">
            <h3>Price</h3>
            {asset.priceKnown ? (
              <p className="trade-title">{price(asset.price)}</p>
            ) : (
              <p className="muted">
                Not read yet. The indexer reads this from the asset&apos;s oracle
                account — refresh it from the <Link href="/dev">/dev harness</Link>.
              </p>
            )}
            <p className="muted">
              Source:{" "}
              {asset.priceFeedType === "pyth"
                ? "Pyth"
                : "MockOracle — no Pyth US-equity feed is published on devnet"}
            </p>
            {asset.pythFeedId ? (
              <p className="muted">
                Mainnet Pyth feed{" "}
                <span className="chip">{asset.pythFeedId.slice(0, 12)}…</span>
              </p>
            ) : null}
          </div>

          <div className="card">
            <h3>What people actually paid</h3>
            <PriceChart trades={trades} />
          </div>

          {fomos.length > 0 ? (
            <div className="card">
              <h3>Recent FOMO actions ({fomos.length})</h3>
              <p className="muted">
                Each of these is somebody&apos;s own trade — their size, their
                signature, priced at the time they placed it. The reference to the
                trade that inspired it is what is shared, not the trade itself.
              </p>
              <div className="asset-list" style={{ marginTop: 12 }}>
                {fomos.slice(0, 5).map((fomo) => (
                  <div className="asset-row" key={fomo.id}>
                    <span className="user">
                      <Avatar name={fomo.user.displayName} avatar={fomo.user.avatar} />
                      <span>
                        <strong>
                          <Link href={`/profile/${fomo.user.username}`}>
                            {fomo.user.displayName}
                          </Link>
                        </strong>
                        <br />
                        <span className="muted">
                          {ago(fomo.tradedAt)} · {money(fomo.amountUsdc)} ·{" "}
                          {fomo.source ? (
                            <>
                              after{" "}
                              <Link href={`/profile/${fomo.source.user.username}`}>
                                @{fomo.source.user.username}
                              </Link>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </span>
                    {fomo.txSignature ? (
                      <span className="chip">{fomo.txSignature.slice(0, 6)}…</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <h3 className="muted" style={{ margin: "16px 0 12px" }}>
            {asset.tradeCount} indexed {asset.tradeCount === 1 ? "trade" : "trades"} by{" "}
            {asset.traderCount} {asset.traderCount === 1 ? "account" : "accounts"}
          </h3>

          {trades.length === 0 ? (
            <div className="card">
              <p className="muted">No trades in this asset yet.</p>
            </div>
          ) : (
            trades.map((trade) => <FeedCard key={trade.id} trade={trade} />)
          )}
        </section>

        <aside className="stack">
          <TradePanel
            asset={asset}
            needsWallet={viewer !== null && !viewer.walletAddress}
            balances={balances}
            position={position}
          />

          <div className="panel">
            <h3>Holders</h3>
            <p className="trade-title">
              {holders} {holders === 1 ? "account" : "accounts"}
            </p>
            <p className="muted">
              Counted from the program&apos;s own Holding accounts. Someone who sold
              everything still has an account on chain, but is not counted here.
            </p>
          </div>

          <div className="panel">
            <h3>People you follow who own this</h3>
            {!viewerId ? (
              <p className="muted">
                <Link href="/sign-in">Sign in</Link> to see which of the people you
                follow hold this.
              </p>
            ) : followedHolders.length === 0 ? (
              <p className="muted">
                Nobody you follow holds {synthetic(asset.symbol)}.{" "}
                <Link href="/friends">Find people</Link> to follow.
              </p>
            ) : (
              <div className="asset-list">
                {followedHolders.map((holder) => (
                  <div className="asset-row" key={holder.user.id}>
                    <span className="user">
                      <Avatar
                        name={holder.user.displayName}
                        avatar={holder.user.avatar}
                      />
                      <span>
                        <strong>
                          <Link href={`/profile/${holder.user.username}`}>
                            {holder.user.displayName}
                          </Link>
                        </strong>
                        <br />
                        <span className="muted">
                          {qty(holder.quantity)} shares · avg {price(holder.avgPrice)}
                        </span>
                      </span>
                    </span>
                    <strong className="muted">
                      {holder.value === null ? "—" : money(holder.value)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h3>On chain</h3>
            <dl className="muted" style={{ margin: 0 }}>
              <dt>Asset account</dt>
              <dd>
                <span className="chip">{asset.assetAddress.slice(0, 10)}…</span>
              </dd>
              <dt>Share mint</dt>
              <dd>
                <span className="chip">{asset.mintAddress.slice(0, 10)}…</span>
              </dd>
              <dt>Vault</dt>
              <dd>
                <span className="chip">{asset.vaultAddress.slice(0, 10)}…</span>
              </dd>
            </dl>
            <p className="muted" style={{ marginTop: 10 }}>
              Your balance lives in the vault program, not in this app.
            </p>
          </div>

          <div className="panel disclosure">
            <strong>Synthetic.</strong> {synthetic(asset.symbol)} is a token the
            operator mints and prices. It is not a stock, pays no dividend, and
            gives you no claim on {asset.name}.
          </div>
        </aside>
      </div>
    </>
  );
}
