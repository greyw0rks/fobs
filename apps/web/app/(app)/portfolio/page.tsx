import Link from "next/link";
import type { Route } from "next";
import { FeedCard } from "@/components/TradeCard";
import { PortfolioChart } from "@/components/fobs/portfolio-chart";
import { Reveal, Stagger, StaggerItem } from "@/components/fobs/motion";
import {
  getPortfolio,
  listTradesForUser,
  portfolioHistory
} from "@/lib/server/queries";
import { getWalletBalances } from "@/lib/server/balances";
import { currentUser } from "@/lib/server/session";
import { money, price, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Your positions. Everything here mirrors something on chain — quantities and
 * average prices are read from the program's own Holding accounts, wallet
 * figures are read live each request. Where a price has not been read the page
 * says so with "—" rather than showing a number.
 */
export default async function PortfolioPage() {
  const viewer = await currentUser();

  if (!viewer) {
    return (
      <div className="space-y-5">
        <section>
          <p className="text-xs text-[#85867f]">Your positions</p>
          <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.045em]">
            Portfolio
          </h1>
          <p className="mt-1 text-sm text-[#777872]">
            Sign in to see the positions held by your wallet.
          </p>
        </section>

        <div className="fobs-surface p-6 text-center">
          <h3 className="text-sm font-semibold">Not signed in</h3>
          <p className="mt-1 text-xs text-[#777872]">
            Positions live against a wallet, and a wallet needs an account.
          </p>
          <div className="mt-4 flex justify-center">
            <Link className="fobs-button-primary" href={"/sign-in" as Route}>
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const [portfolio, balances, trades, series] = await Promise.all([
    getPortfolio(viewer.id),
    getWalletBalances(viewer.walletAddress),
    listTradesForUser(viewer.id, viewer.id),
    portfolioHistory(viewer.id)
  ]);

  const chartChange =
    series.length >= 2
      ? (() => {
          const first = series[0].value;
          const last = series[series.length - 1].value;
          return first > 0 ? ((last - first) / first) * 100 : null;
        })()
      : null;

  const pnlUp = portfolio.unrealizedPnl !== null && portfolio.unrealizedPnl >= 0;
  const shown = portfolio.holdings.filter((holding) => holding.allocation !== null);

  return (
    <div className="space-y-5">
      <Reveal>
        <section>
          <p className="text-xs text-[#85867f]">Portfolio</p>
          <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.05em]">
            {portfolio.totalValue === null ? "—" : money(portfolio.totalValue)}
          </h1>
          {portfolio.unrealizedPnl !== null ? (
            <p
              className={`mt-1 text-xs font-semibold ${
                pnlUp ? "text-[#23845b]" : "text-[#c94c4c]"
              }`}
            >
              {pnlUp ? "+" : ""}
              {money(portfolio.unrealizedPnl)}
              {portfolio.unrealizedPct !== null
                ? ` (${portfolio.unrealizedPct.toFixed(2)}%)`
                : ""}{" "}
              unrealized
            </p>
          ) : (
            <p className="mt-1 text-xs text-[#9b9c95]">No priced holdings yet</p>
          )}
        </section>
      </Reveal>

      <Reveal delay={0.05}>
        <PortfolioChart
          series={series}
          totalValue={portfolio.totalValue}
          change={chartChange}
        />
      </Reveal>

      <Reveal delay={0.1}>
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="fobs-surface p-4">
            <p className="text-[10px] text-[#85867f]">Cost basis</p>
            <p className="mt-2 text-[16px] font-semibold tracking-[-0.03em]">
              {portfolio.totalCost === null ? "—" : money(portfolio.totalCost)}
            </p>
          </div>
          <div className="fobs-surface p-4">
            <p className="text-[10px] text-[#85867f]">USDC available</p>
            <p className="mt-2 text-[16px] font-semibold tracking-[-0.03em]">
              {balances
                ? balances.usdcAccountExists
                  ? money(balances.usdc)
                  : "—"
                : "—"}
            </p>
            <p className="mt-1 text-[10px] text-[#9b9c95]">
              {balances
                ? balances.usdcAccountExists
                  ? `${balances.sol.toFixed(4)} SOL`
                  : "No token account yet"
                : "Could not read the balance"}
            </p>
          </div>
          <div className="fobs-surface p-4">
            <p className="text-[10px] text-[#85867f]">Wallet</p>
            {viewer.walletAddress ? (
              <p className="mt-2 text-xs font-medium">
                {viewer.walletAddress.slice(0, 6)}…{viewer.walletAddress.slice(-6)}
              </p>
            ) : (
              <p className="mt-2 text-xs">
                <Link href={"/welcome" as Route} className="text-[#3175c6]">
                  Set one up
                </Link>
              </p>
            )}
          </div>
        </section>
      </Reveal>

      <Reveal delay={0.12}>
        <section className="fobs-surface overflow-hidden">
          <div className="border-b border-[#e5e3dd] p-5">
            <h2 className="text-sm font-semibold">Your holdings</h2>
          </div>

          {portfolio.holdings.length === 0 ? (
            <div className="p-5 text-xs text-[#777872]">
              No positions yet —{" "}
              <Link href={"/stocks" as Route} className="text-[#3175c6]">
                browse markets
              </Link>{" "}
              to make your first trade.
            </div>
          ) : (
            portfolio.holdings.map((holding) => {
              const hUp =
                holding.unrealizedPnl !== null && holding.unrealizedPnl >= 0;
              return (
                <Link
                  key={holding.asset.id}
                  href={`/asset/${holding.asset.symbol}` as Route}
                  className="grid grid-cols-2 gap-3 border-b border-[#efeee9] p-5 last:border-b-0 sm:grid-cols-4"
                >
                  <div>
                    <p className="text-sm font-semibold">{holding.asset.symbol}</p>
                    <p className="mt-1 text-[10px] text-[#9b9c95]">
                      avg {price(holding.avgPrice)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#85867f]">Value</p>
                    <p className="mt-1 text-xs">
                      {holding.value === null ? "—" : money(holding.value)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#85867f]">Shares</p>
                    <p className="mt-1 text-xs">{qty(holding.quantity)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#85867f]">Unrealized</p>
                    {holding.unrealizedPnl === null ? (
                      <p className="mt-1 text-xs text-[#9b9c95]">price not read</p>
                    ) : (
                      <p
                        className={`mt-1 text-xs font-semibold ${
                          hUp ? "text-[#23845b]" : "text-[#c94c4c]"
                        }`}
                      >
                        {hUp ? "+" : ""}
                        {money(holding.unrealizedPnl)}
                        {holding.unrealizedPct !== null
                          ? ` (${holding.unrealizedPct.toFixed(2)}%)`
                          : ""}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </section>
      </Reveal>

      {portfolio.unpricedCount > 0 ? (
        <div className="fobs-surface p-5 text-xs leading-6 text-[#777872]">
          <strong className="font-semibold text-[#111312]">
            {portfolio.unpricedCount}{" "}
            {portfolio.unpricedCount === 1 ? "holding is" : "holdings are"} excluded
          </strong>{" "}
          from the totals above because a live price could not be read just now.
          It reappears once the route or reference returns one.
        </div>
      ) : null}

      {shown.length > 0 ? (
        <div className="fobs-surface p-5">
          <h3 className="text-sm font-semibold">Allocation</h3>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
            {shown.map((holding, index) => (
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
          <p className="mt-3 text-[10px] text-[#9b9c95]">
            {shown
              .map(
                (holding) =>
                  `${holding.asset.symbol} ${holding.allocation!.toFixed(0)}%`
              )
              .join(" · ")}
          </p>
        </div>
      ) : null}

      <section>
        <h3 className="mb-3 text-sm font-semibold">
          Trade history ({trades.length})
        </h3>

        {trades.length === 0 ? (
          <div className="fobs-surface p-6 text-center text-xs text-[#777872]">
            No trades yet.
          </div>
        ) : (
          <Stagger className="space-y-3">
            {trades.map((trade) => (
              <StaggerItem key={trade.id}>
                <FeedCard trade={trade} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>
    </div>
  );
}

/** Six light hues for the allocation bar — distinguishable as thin slivers. */
const ALLOCATION_COLOURS = [
  "#8b7cf0",
  "#23845b",
  "#3175c6",
  "#e0a63c",
  "#e08a5c",
  "#4db3b3"
];
