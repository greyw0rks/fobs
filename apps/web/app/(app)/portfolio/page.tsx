import Link from "next/link";
import { FeedCard } from "@/components/TradeCard";
import { getPortfolio, listTradesForUser } from "@/lib/server/queries";
import { getWalletBalances } from "@/lib/server/balances";
import { currentUser } from "@/lib/server/session";
import { money, price, qty, synthetic } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Your positions.
 *
 * Everything here is a mirror of something on chain. `quantity` and `avgPrice`
 * are read from the program's own `Holding` accounts by the indexer, and the
 * balances at the top are read live from devnet on each request — a stale
 * balance is what the trade panel refuses a trade against, so it is not cached.
 *
 * Where a price has not been read, the page says so instead of showing a
 * number. That is why the totals can be absent, and why the count of unpriced
 * holdings is stated rather than quietly folded in.
 */
export default async function PortfolioPage() {
  const viewer = await currentUser();

  if (!viewer) {
    return (
      <>
        <div className="topbar">
          <div>
            <h2>Portfolio</h2>
            <p>Sign in to see your positions.</p>
          </div>
        </div>
        <div className="card">
          <h3>Not signed in</h3>
          <p className="muted">
            <Link href="/sign-in">Sign in</Link> to see the positions held by your
            wallet.
          </p>
        </div>
      </>
    );
  }

  const [portfolio, balances, trades] = await Promise.all([
    getPortfolio(viewer.id),
    getWalletBalances(viewer.walletAddress),
    listTradesForUser(viewer.id, viewer.id)
  ]);

  const pnlTone =
    portfolio.unrealizedPnl === null
      ? ""
      : portfolio.unrealizedPnl >= 0
        ? "gain"
        : "loss";

  return (
    <>
      <div className="topbar">
        <div>
          <h2>Portfolio</h2>
          <p>
            Positions are read from the program&apos;s own Holding accounts. Your
            shares live in the vault program, not in this app.
          </p>
        </div>
      </div>

      <div className="grid">
        <section className="feed">
          <div className="card">
            <h3>Holdings</h3>
            {portfolio.holdings.length === 0 ? (
              <p className="muted">
                No positions yet.{" "}
                <Link href="/stocks">Browse markets</Link> to make your first trade.
              </p>
            ) : (
              <div className="asset-list">
                {portfolio.holdings.map((holding) => (
                  <Link
                    className="asset-row"
                    key={holding.asset.id}
                    href={`/asset/${holding.asset.symbol}`}
                  >
                    <span>
                      <strong>{synthetic(holding.asset.symbol)}</strong>
                      <br />
                      <span className="muted">
                        {qty(holding.quantity)} shares · avg {price(holding.avgPrice)}
                      </span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <strong className="num">
                        {holding.value === null ? "—" : money(holding.value)}
                      </strong>
                      <br />
                      <span
                        className={
                          holding.unrealizedPnl === null ? "muted" : `num ${pnlTone}`
                        }
                      >
                        {holding.unrealizedPnl === null
                          ? "price not read"
                          : `${holding.unrealizedPnl >= 0 ? "+" : ""}${money(
                              holding.unrealizedPnl
                            )} (${holding.unrealizedPct!.toFixed(2)}%)`}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {portfolio.unpricedCount > 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                {portfolio.unpricedCount}{" "}
                {portfolio.unpricedCount === 1 ? "holding is" : "holdings are"}{" "}
                excluded from the totals below because the indexer has not read that
                asset&apos;s price yet. Refresh it from the{" "}
                <Link href="/dev">/dev harness</Link>.
              </p>
            ) : null}
          </div>

          <h3 className="muted" style={{ margin: "16px 0 12px" }}>
            Your trade history ({trades.length})
          </h3>
          {trades.length === 0 ? (
            <div className="card">
              <p className="muted">No trades yet.</p>
            </div>
          ) : (
            trades.map((trade) => <FeedCard key={trade.id} trade={trade} />)
          )}
        </section>

        <aside className="stack">
          <div className="panel">
            <h3>Total value</h3>
            {portfolio.totalValue === null ? (
              <p className="muted">
                No priced holdings yet, so there is no total to show.
              </p>
            ) : (
              <>
                <p className="trade-title num">{money(portfolio.totalValue)}</p>
                <p className={`num ${pnlTone}`}>
                  {portfolio.unrealizedPnl! >= 0 ? "+" : ""}
                  {money(portfolio.unrealizedPnl!)} unrealized
                  {portfolio.unrealizedPct !== null
                    ? ` (${portfolio.unrealizedPct.toFixed(2)}%)`
                    : ""}
                </p>
                <p className="muted num">
                  Cost basis {money(portfolio.totalCost!)}
                </p>
              </>
            )}
            {portfolio.holdings.some((h) => h.allocation !== null) ? (
              <>
                <div className="allocation">
                  {portfolio.holdings
                    .filter((holding) => holding.allocation !== null)
                    .map((holding, index) => (
                      <span
                        key={holding.asset.id}
                        style={{
                          width: `${holding.allocation}%`,
                          background: ALLOCATION_COLOURS[index % ALLOCATION_COLOURS.length]
                        }}
                        title={`${holding.asset.symbol} ${holding.allocation!.toFixed(1)}%`}
                      />
                    ))}
                </div>
                <p className="muted">
                  {portfolio.holdings
                    .filter((holding) => holding.allocation !== null)
                    .map(
                      (holding) =>
                        `${holding.asset.symbol} ${holding.allocation!.toFixed(0)}%`
                    )
                    .join(" · ")}
                </p>
              </>
            ) : null}
          </div>

          <div className="panel">
            <h3>Wallet</h3>
            {viewer.walletAddress ? (
              <>
                <p>
                  <span className="chip">
                    {viewer.walletAddress.slice(0, 6)}…{viewer.walletAddress.slice(-6)}
                  </span>
                </p>
                {balances ? (
                  <dl className="muted" style={{ margin: 0 }}>
                    <dt>Test USDC</dt>
                    <dd>
                      {balances.usdcAccountExists
                        ? money(balances.usdc)
                        : "No token account yet — created by your first trade"}
                    </dd>
                    <dt>Devnet SOL</dt>
                    <dd>{balances.sol.toFixed(4)}</dd>
                  </dl>
                ) : (
                  <p className="muted">Could not read the balance from devnet.</p>
                )}
              </>
            ) : (
              <p className="muted">
                No wallet yet. <Link href="/welcome">Set one up</Link> to trade.
              </p>
            )}
          </div>

          <div className="panel disclosure">
            <strong>Synthetic.</strong> These are tokens this program mints that track
            a company&apos;s price. They are not stock, pay no dividend, and are
            redeemable only for the test USDC in the program&apos;s vault — which is
            worth nothing.
          </div>
        </aside>
      </div>
    </>
  );
}

/**
 * Six hues for the allocation bar. Not a brand palette — the bar is only 6px
 * tall, so these are chosen to stay distinguishable from each other as thin
 * slivers against `--paper`. The previous set was picked for a light background
 * and went muddy on near-black. Every one is a light tint rather than a
 * saturated mid-tone, because a mid-tone at this height reads as a gap.
 */
const ALLOCATION_COLOURS = [
  "#6ea8ff",
  "#3ddc84",
  "#f7c948",
  "#c084fc",
  "#ff8a5c",
  "#4dd4d4"
];
