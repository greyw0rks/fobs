import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Avatar, FeedCard, TradePanel } from "@/components/TradeCard";
import { PortfolioChart } from "@/components/fobs/portfolio-chart";
import { Reveal, Stagger, StaggerItem } from "@/components/fobs/motion";
import {
  countHolders,
  getAssetBySymbol,
  getHolding,
  listFollowersHolding,
  listTradesForAsset
} from "@/lib/server/queries";
import { getWalletBalances } from "@/lib/server/balances";
import { priceHistory, type PricePoint } from "@/lib/server/price-history";
import { currentUser } from "@/lib/server/session";
import { ago, money, price, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

/** A neutral market label from the asset's kind, never "synthetic". */
function kindLabel(kind: string | null): string {
  if (kind === "xstock") return "xStock";
  if (kind === "prestock") return "Pre-IPO";
  if (kind === "ondo") return "Ondo";
  return "Market";
}

/**
 * One asset. The price is the headline; the trade panel (the real mainnet
 * sign/quote/submit lifecycle from TradeCard — unchanged) is pinned to the top
 * of the rail. Restyled onto the warm surface; every figure is read, not made.
 */
export default async function AssetPage({
  params
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const viewer = await currentUser();
  const asset = await getAssetBySymbol(symbol);
  if (!asset) notFound();

  const viewerId = viewer?.id ?? null;

  const isListed = asset.kind === "xstock" || asset.kind === "ondo";
  const ticker = asset.symbol.replace(/-ondo$/i, "").toUpperCase();

  const [trades, holders, followedHolders, balances, position, history] =
    await Promise.all([
      listTradesForAsset(asset.id, 50),
      countHolders(asset.id),
      listFollowersHolding(asset.id, viewerId),
      getWalletBalances(viewer?.walletAddress ?? null),
      viewerId ? getHolding(viewerId, asset.id) : Promise.resolve(null),
      isListed ? priceHistory(ticker) : Promise.resolve<PricePoint[]>([])
    ]);

  const fomos = trades.filter((trade) => trade.source !== null);

  const oracle = asset.priceFeedType === "pyth" ? "Pyth reference" : "Live price";

  // The real market series, mapped for the chart. Change is close-to-close over
  // the window — real, or null when there aren't two points.
  const series = history.map((point) => ({
    label: new Date(point.at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    }),
    value: point.price
  }));
  const seriesChange =
    series.length >= 2 && series[0].value > 0
      ? ((series[series.length - 1].value - series[0].value) / series[0].value) *
        100
      : null;

  return (
    <div className="space-y-5">
      <Link href={"/stocks" as Route} className="text-xs text-[#3175c6]">
        ← Markets
      </Link>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Reveal>
            <div className="fobs-surface p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e8eee4] font-bold">
                    {asset.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <h1 className="flex items-center gap-2 text-[22px] font-semibold">
                      {asset.symbol}
                      <span className="rounded-full bg-[#f2f1ec] px-2 py-0.5 text-[10px] font-medium text-[#777872]">
                        {kindLabel(asset.kind)}
                      </span>
                    </h1>
                    <p className="text-xs text-[#777872]">{asset.name}</p>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[28px] font-semibold tracking-[-0.03em]">
                    {asset.priceKnown ? price(asset.price) : "—"}
                  </div>
                  <div className="text-[10px] text-[#9b9c95]">
                    {oracle}
                    {asset.priceUpdatedAt
                      ? ` · moved ${ago(asset.priceUpdatedAt)}`
                      : ""}
                  </div>
                </div>
              </div>

              <p className="mt-4 text-xs leading-6 text-[#777872]">
                A real mainnet token for {asset.name}, reached through a swap your
                own wallet signs. It is not the share itself and FOBS does not
                issue it.
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.05}>
            {series.length >= 2 ? (
              <PortfolioChart
                series={series}
                totalValue={asset.priceKnown ? asset.price : null}
                change={seriesChange}
                title={`${ticker} · ${series.length}-day daily close`}
              />
            ) : (
              <div className="fobs-surface p-6">
                <p className="text-xs font-medium">Price history</p>
                <div className="mt-4 flex h-[220px] items-center justify-center rounded-lg bg-[#f7f6f2] text-center text-xs text-[#85867f]">
                  {isListed
                    ? "Not enough price history yet to chart this market."
                    : "No public price history for a pre-IPO name."}
                </div>
              </div>
            )}
          </Reveal>

          {!asset.priceKnown ? (
            <div className="fobs-surface p-5 text-xs leading-6 text-[#777872]">
              <strong className="font-semibold text-[#111312]">
                The price could not be read.
              </strong>{" "}
              The live route or reference for this asset did not return a usable
              price just now — until it does, this page will not show a price, a
              total, or a gain rather than invent one.
            </div>
          ) : null}

          {fomos.length > 0 ? (
            <div className="fobs-surface p-5">
              <h3 className="text-sm font-semibold">
                Recent FOMO actions ({fomos.length})
              </h3>
              <p className="mt-1 text-xs text-[#777872]">
                Each of these is somebody&apos;s own trade — their size, their
                signature, priced when they placed it.
              </p>
              <div className="mt-4 space-y-4">
                {fomos.slice(0, 5).map((fomo) => (
                  <div
                    key={fomo.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={fomo.user.displayName} avatar={fomo.user.avatar} />
                      <div>
                        <Link
                          href={`/profile/${fomo.user.username}` as Route}
                          className="text-xs font-semibold"
                        >
                          {fomo.user.displayName}
                        </Link>
                        <p className="mt-0.5 text-[10px] text-[#9b9c95]">
                          {ago(fomo.tradedAt)} · {money(fomo.amountUsdc)}
                          {fomo.source ? (
                            <>
                              {" "}
                              · after{" "}
                              <Link
                                href={`/profile/${fomo.source.user.username}` as Route}
                                className="text-[#3175c6]"
                              >
                                @{fomo.source.user.username}
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </div>
                    </div>
                    {fomo.txSignature ? (
                      <span className="rounded-full bg-[#f2f1ec] px-2 py-0.5 text-[10px] text-[#777872]">
                        {fomo.txSignature.slice(0, 6)}…
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Every trade</h3>
              <span className="text-[10px] text-[#9b9c95]">
                {asset.tradeCount} {asset.tradeCount === 1 ? "trade" : "trades"} ·{" "}
                {asset.traderCount}{" "}
                {asset.traderCount === 1 ? "account" : "accounts"}
              </span>
            </div>

            {trades.length === 0 ? (
              <div className="fobs-surface p-6 text-center">
                <h3 className="text-sm font-semibold">No trades in this asset yet</h3>
                <p className="mt-1 text-xs text-[#777872]">
                  The first swap someone signs will settle on mainnet and appear
                  here.
                </p>
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

        <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
          <TradePanel
            asset={asset}
            needsWallet={viewer !== null && !viewer.walletAddress}
            walletAddress={viewer?.walletAddress ?? null}
            balances={balances}
            position={position}
          />

          <div className="fobs-surface p-5">
            <h3 className="text-sm font-semibold">Holders</h3>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{holders}</p>
            <p className="mt-1 text-[10px] leading-5 text-[#9b9c95]">
              {holders === 1 ? "Account" : "Accounts"} counted from the program&apos;s
              own Holding accounts.
            </p>
          </div>

          <div className="fobs-surface p-5">
            <h3 className="text-sm font-semibold">People you follow who own this</h3>
            {!viewerId ? (
              <p className="mt-2 text-xs text-[#777872]">
                <Link href={"/sign-in" as Route} className="text-[#3175c6]">
                  Sign in
                </Link>{" "}
                to see which of the people you follow hold this.
              </p>
            ) : followedHolders.length === 0 ? (
              <p className="mt-2 text-xs text-[#777872]">
                Nobody you follow holds {asset.symbol}.{" "}
                <Link href={"/friends" as Route} className="text-[#3175c6]">
                  Find people
                </Link>{" "}
                to follow.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {followedHolders.map((holder) => (
                  <div
                    key={holder.user.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={holder.user.displayName}
                        avatar={holder.user.avatar}
                      />
                      <div>
                        <Link
                          href={`/profile/${holder.user.username}` as Route}
                          className="text-xs font-semibold"
                        >
                          {holder.user.displayName}
                        </Link>
                        <p className="mt-0.5 text-[10px] text-[#9b9c95]">
                          {qty(holder.quantity)} shares · avg {price(holder.avgPrice)}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[#777872]">
                      {holder.value === null ? "—" : money(holder.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="fobs-surface p-5">
            <h3 className="text-sm font-semibold">On chain</h3>
            <dl className="mt-3 space-y-2 text-[10px] text-[#777872]">
              {asset.assetAddress ? (
                <div className="flex items-center justify-between">
                  <dt>Asset account</dt>
                  <dd className="font-medium">{asset.assetAddress.slice(0, 10)}…</dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <dt>Mint</dt>
                <dd className="font-medium">{asset.mintAddress.slice(0, 10)}…</dd>
              </div>
              {asset.vaultAddress ? (
                <div className="flex items-center justify-between">
                  <dt>Vault</dt>
                  <dd className="font-medium">{asset.vaultAddress.slice(0, 10)}…</dd>
                </div>
              ) : null}
              {asset.pythFeedId ? (
                <div className="flex items-center justify-between">
                  <dt>Mainnet Pyth feed</dt>
                  <dd className="font-medium">{asset.pythFeedId.slice(0, 10)}…</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-3 text-[10px] text-[#9b9c95]">
              Your balance lives in your own wallet, not in this app.
            </p>
          </div>

          <div className="fobs-surface p-5 text-xs leading-6 text-[#777872]">
            <strong className="font-semibold text-[#111312]">
              FOBS does not issue this.
            </strong>{" "}
            {asset.symbol} is a real token that already trades on mainnet; FOBS
            only routes a swap your wallet signs. A tokenized equity is not the
            share itself — issuer terms, liquidity, and price dislocation are real
            risks.
          </div>
        </aside>
      </div>
    </div>
  );
}
