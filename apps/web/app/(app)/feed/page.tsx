import Link from "next/link";
import type { Route } from "next";
import { FeedView } from "@/components/FeedView";
import { PortfolioChart } from "@/components/fobs/portfolio-chart";
import { FriendsCard } from "@/components/fobs/friends-card";
import { FomoCard } from "@/components/fobs/fomo-card";
import { MarketsRail } from "@/components/fobs/markets-table";
import { Reveal } from "@/components/fobs/motion";
import {
  followingCount,
  getPortfolio,
  listAssets,
  listFeed,
  listPeople,
  portfolioHistory,
  type FeedView as FeedViewName
} from "@/lib/server/queries";
import { getWalletBalances } from "@/lib/server/balances";
import { currentUser } from "@/lib/server/session";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABS: { id: FeedViewName; label: string }[] = [
  { id: "following", label: "Following" },
  { id: "for-you", label: "For You" }
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The feed — the product's front door, and the only page that opens without a
 * sign-in. Restyled onto the warm editorial surface; the live-events behaviour
 * (FeedView) is unchanged, and every figure is read, never invented.
 */
export default async function FeedPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const view: FeedViewName = tab === "for-you" ? "for-you" : "following";

  const viewer = await currentUser();
  const [trades, assets, people] = await Promise.all([
    listFeed({ view, viewerId: viewer?.id ?? null }),
    listAssets(),
    listPeople(viewer?.id ?? null)
  ]);

  // The signed-in summary: real portfolio value, P&L, buying power, following
  // count, and a reconstructed value-over-time series for the chart. Absent for
  // signed-out visitors — there is nothing to summarise.
  const summary = viewer
    ? await (async () => {
        const [portfolio, balances, following, series] = await Promise.all([
          getPortfolio(viewer.id),
          viewer.walletAddress ? getWalletBalances(viewer.walletAddress) : null,
          followingCount(viewer.id),
          portfolioHistory(viewer.id)
        ]);
        return { portfolio, balances, following, series };
      })()
    : null;

  // Percent change across the reconstructed series window — real, or null when
  // there aren't enough priced points to state one.
  const chartChange =
    summary && summary.series.length >= 2
      ? (() => {
          const first = summary.series[0].value;
          const last = summary.series[summary.series.length - 1].value;
          return first > 0 ? ((last - first) / first) * 100 : null;
        })()
      : null;

  const featured = trades[0] ?? null;

  return (
    <div className="space-y-5">
      <Reveal>
        <section className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-[#85867f]">The room</p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.045em]">
              {viewer ? `${greeting()}, ${viewer.displayName}` : "The room"}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-[#777872]">
              Every trade below is a real swap someone settled on mainnet. FOMO
              opens your own trade at your own size — it never copies theirs.
            </p>
          </div>

          <nav className="flex shrink-0 gap-1 rounded-lg bg-[#f2f1ec] p-1">
            {TABS.map((item) => (
              <Link
                key={item.id}
                href={`/feed?tab=${item.id}` as Route}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  view === item.id ? "bg-white shadow-sm" : "text-[#777872]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </section>
      </Reveal>

      {summary ? (
        <Reveal delay={0.05}>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="fobs-surface p-4">
              <p className="text-[10px] text-[#85867f]">Portfolio value</p>
              <p className="mt-2 text-[16px] font-semibold tracking-[-0.03em]">
                {summary.portfolio.totalValue === null
                  ? "—"
                  : money(summary.portfolio.totalValue)}
              </p>
              {summary.portfolio.unpricedCount > 0 ? (
                <p className="mt-1 text-[10px] text-[#9b9c95]">
                  {summary.portfolio.unpricedCount} not priced
                </p>
              ) : null}
            </div>

            <div className="fobs-surface p-4">
              <p className="text-[10px] text-[#85867f]">Unrealized P&amp;L</p>
              <p
                className={`mt-2 text-[16px] font-semibold tracking-[-0.03em] ${
                  summary.portfolio.unrealizedPnl === null
                    ? ""
                    : summary.portfolio.unrealizedPnl >= 0
                      ? "text-[#23845b]"
                      : "text-[#c94c4c]"
                }`}
              >
                {summary.portfolio.unrealizedPnl === null
                  ? "—"
                  : `${summary.portfolio.unrealizedPnl >= 0 ? "+" : ""}${money(summary.portfolio.unrealizedPnl)}`}
              </p>
              {summary.portfolio.unrealizedPct !== null ? (
                <p className="mt-1 text-[10px] text-[#9b9c95]">
                  {summary.portfolio.unrealizedPct >= 0 ? "+" : ""}
                  {summary.portfolio.unrealizedPct.toFixed(2)}%
                </p>
              ) : null}
            </div>

            <div className="fobs-surface p-4">
              <p className="text-[10px] text-[#85867f]">Buying power</p>
              <p className="mt-2 text-[16px] font-semibold tracking-[-0.03em]">
                {summary.balances
                  ? summary.balances.usdcAccountExists
                    ? money(summary.balances.usdc)
                    : "No USDC"
                  : "—"}
              </p>
              <p className="mt-1 text-[10px] text-[#9b9c95]">USDC in your wallet</p>
            </div>

            <div className="fobs-surface p-4">
              <p className="text-[10px] text-[#85867f]">Following</p>
              <p className="mt-2 text-[16px] font-semibold tracking-[-0.03em]">
                {summary.following}
              </p>
              <p className="mt-1 text-[10px]">
                <Link href={"/friends" as Route} className="text-[#3175c6]">
                  Find people
                </Link>
              </p>
            </div>
          </section>
        </Reveal>
      ) : null}

      {summary ? (
        <Reveal delay={0.1}>
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
            <PortfolioChart
              series={summary.series}
              totalValue={summary.portfolio.totalValue}
              change={chartChange}
            />

            <div className="space-y-5">
              <FriendsCard people={people} />
              <FomoCard trade={featured} />
            </div>
          </section>
        </Reveal>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Your feed</h2>
          </div>

          {view === "following" && !viewer ? (
            <div className="fobs-surface p-6 text-center">
              <h3 className="text-sm font-semibold">Sign in to build your feed</h3>
              <p className="mt-1 text-xs text-[#777872]">
                The Following feed is the trades of accounts you follow.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Link className="fobs-button-primary" href={"/sign-in" as Route}>
                  Sign in
                </Link>
                <Link
                  className="fobs-button-secondary"
                  href={"/feed?tab=for-you" as Route}
                >
                  See the whole room
                </Link>
              </div>
            </div>
          ) : trades.length === 0 ? (
            <div className="fobs-surface p-6 text-center">
              <h3 className="text-sm font-semibold">Nothing here yet</h3>
              <p className="mt-1 text-xs text-[#777872]">
                {view === "following"
                  ? "Nobody you follow has traded yet."
                  : "No trades have been indexed yet."}
              </p>
              <div className="mt-4 flex justify-center">
                {view === "following" ? (
                  <Link className="fobs-button-primary" href={"/friends" as Route}>
                    Find people to follow
                  </Link>
                ) : (
                  <Link className="fobs-button-primary" href={"/stocks" as Route}>
                    Make the first trade
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="fobs-feed-list space-y-3">
              <FeedView view={view} initial={trades} />
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <MarketsRail assets={assets} />

          <div className="fobs-surface p-5 text-xs leading-6 text-[#777872]">
            <strong className="font-semibold text-[#111312]">
              Real mainnet tokens.
            </strong>{" "}
            Every symbol here already trades on Solana mainnet — FOBS issues none
            of them and signs nothing; a trade is a swap your own wallet signs.
            Prices are read live, and a listed name is checked against its Pyth
            reference before it can be traded.
          </div>
        </aside>
      </div>
    </div>
  );
}
