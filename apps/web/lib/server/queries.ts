import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { priceHistory } from "@/lib/server/price-history";
import { parseProfileLinks } from "@/lib/profile-links";
import type {
  AssetSummary,
  FeedTrade,
  FeedUser,
  FeedView,
  HoldingView,
  NotificationView,
  PersonView,
  PortfolioView,
  PriceFeedType,
  ProfileView,
  TradeSide
} from "@/lib/types";

export type {
  AssetSummary,
  FeedAsset,
  FeedTrade,
  FeedUser,
  FeedView,
  HoldingView,
  NotificationView,
  PersonView,
  PortfolioView,
  ProfileView,
  TradeSide
} from "@/lib/types";

/**
 * Read models for the UI.
 *
 * Everything here is derived from rows the indexer wrote, plus the follow graph.
 * Two rules the old demo store broke and this must not:
 *
 *   1. No invented numbers. Anything that looks like market data (a 24h change,
 *      a holder count) is either computed from real trades or absent. A made-up
 *      percentage next to a real price is a disclosure bug, not a placeholder.
 *   2. No second source of truth. Prices come from `Asset.cachedPrice`, which
 *      the indexer reads off the oracle account — the same account the program
 *      prices trades from.
 */

const tradeInclude = {
  user: { select: { id: true, username: true, displayName: true, avatar: true } },
  asset: {
    select: {
      id: true,
      symbol: true,
      name: true,
      cachedPrice: true,
      priceUpdatedAt: true,
      priceFeedType: true,
      pythFeedId: true
    }
  },
  sourceTrade: {
    select: {
      id: true,
      amountUsdc: true,
      user: { select: { id: true, username: true, displayName: true, avatar: true } }
    }
  }
} as const;

type RawTrade = {
  id: string;
  side: string;
  amountUsdc: unknown;
  quantity: unknown;
  price: unknown;
  tradedAt: Date;
  txSignature: string | null;
  onchainReceipt: string;
  user: { id: string; username: string; displayName: string; avatar: string | null };
  asset: {
    id: string;
    symbol: string;
    name: string;
    cachedPrice: unknown;
    priceUpdatedAt: Date | null;
    priceFeedType: string;
    pythFeedId: string | null;
  };
  sourceTrade: {
    id: string;
    amountUsdc: unknown;
    user: { id: string; username: string; displayName: string; avatar: string | null };
  } | null;
};

const num = (value: unknown): number => Number(String(value));

function toFeedTrade(
  trade: RawTrade,
  fomoCount: number,
  viewerFomoed: boolean
): FeedTrade {
  return {
    id: trade.id,
    side: trade.side === "sell" ? "sell" : "buy",
    amountUsdc: num(trade.amountUsdc),
    quantity: num(trade.quantity),
    price: num(trade.price),
    tradedAt: trade.tradedAt.toISOString(),
    txSignature: trade.txSignature,
    onchainReceipt: trade.onchainReceipt,
    user: trade.user,
    asset: {
      id: trade.asset.id,
      symbol: trade.asset.symbol,
      name: trade.asset.name,
      price: trade.asset.cachedPrice === null ? null : num(trade.asset.cachedPrice),
      priceFeedType: trade.asset.priceFeedType === "pyth" ? "pyth" : "market",
      pythFeedId: trade.asset.pythFeedId,
      priceKnown: trade.asset.cachedPrice !== null,
      priceUpdatedAt: trade.asset.priceUpdatedAt?.toISOString() ?? null
    },
    fomoCount,
    viewerFomoed,
    source: trade.sourceTrade
      ? {
          id: trade.sourceTrade.id,
          user: trade.sourceTrade.user,
          amountUsdc: num(trade.sourceTrade.amountUsdc)
        }
      : null
  };
}

/**
 * Attach the FOMO counts, which are counts of *trades*, not of a separate
 * action table.
 *
 * There is no `FomoAction` model: a FOMO is a trade carrying `sourceTradeId`,
 * and the counter would be a second representation of the same fact — the first
 * thing to drift. Two grouped queries keep this to a constant number of round
 * trips regardless of feed length.
 */
async function withFomo(trades: RawTrade[], viewerId: string | null) {
  const ids = trades.map((trade) => trade.id);
  if (ids.length === 0) return [];

  const [counts, mine] = await Promise.all([
    prisma.trade.groupBy({
      by: ["sourceTradeId"],
      where: { sourceTradeId: { in: ids } },
      _count: { _all: true }
    }),
    viewerId
      ? prisma.trade.findMany({
          where: { sourceTradeId: { in: ids }, userId: viewerId },
          select: { sourceTradeId: true }
        })
      : Promise.resolve([])
  ]);

  const countByTrade = new Map(
    counts.map((row) => [row.sourceTradeId as string, row._count._all])
  );
  const viewerFomoed = new Set(mine.map((row) => row.sourceTradeId as string));

  return trades.map((trade) =>
    toFeedTrade(trade, countByTrade.get(trade.id) ?? 0, viewerFomoed.has(trade.id))
  );
}

/**
 * "following" is the product: trades by people you follow.
 * "for-you" is the wider room, which is what an empty follow graph falls back to
 * so a new account never sees a blank feed.
 *
 * `before` is the pagination cursor: a timestamp, and the page returned is the
 * trades strictly older than it. A cursor rather than an offset because the feed
 * grows at the top — an offset would re-show a trade that arrived between two
 * page fetches and skip one that scrolled past, and neither is visible until
 * someone notices a duplicate. `tradedAt` is unique in practice (it comes from
 * the receipt's own clock) but ties would only ever drop one of two trades
 * stamped within the same microsecond.
 */
export async function listFeed(input: {
  view: FeedView;
  viewerId: string | null;
  limit?: number;
  before?: Date | null;
}): Promise<FeedTrade[]> {
  const { view, viewerId, limit = 50, before = null } = input;

  let authorIds: string[] | null = null;
  if (view === "following") {
    if (!viewerId) return [];
    const following = await prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true }
    });
    authorIds = following.map((row) => row.followingId);
    // Following nobody is an empty feed, not a fallback to everyone — the
    // distinction is the whole reason the two tabs exist.
    if (authorIds.length === 0) return [];
  }

  const trades = (await prisma.trade.findMany({
    where: {
      ...(authorIds ? { userId: { in: authorIds } } : {}),
      ...(before ? { tradedAt: { lt: before } } : {})
    },
    orderBy: { tradedAt: "desc" },
    take: limit,
    include: tradeInclude
  })) as unknown as RawTrade[];

  return withFomo(trades, viewerId);
}

export async function listTradesForUser(
  userId: string,
  viewerId: string | null
): Promise<FeedTrade[]> {
  const trades = (await prisma.trade.findMany({
    where: { userId },
    orderBy: { tradedAt: "desc" },
    take: 50,
    include: tradeInclude
  })) as unknown as RawTrade[];
  return withFomo(trades, viewerId);
}

export async function getTrade(
  id: string,
  viewerId: string | null
): Promise<FeedTrade | null> {
  const trade = (await prisma.trade.findUnique({
    where: { id },
    include: tradeInclude
  })) as unknown as RawTrade | null;
  if (!trade) return null;
  const [enriched] = await withFomo([trade], viewerId);
  return enriched ?? null;
}

export async function listAssets(): Promise<AssetSummary[]> {
  const assets = await prisma.asset.findMany({
    // Bridged assets have no `onchainId`, so order by symbol for a stable list.
    orderBy: { symbol: "asc" },
    include: { _count: { select: { trades: true } } }
  });

  // Distinct traders per asset. `groupBy` counts rows rather than distinct
  // users, so this is done as one pass over (assetId, userId) pairs instead of a
  // per-asset count query.
  const byAsset = new Map<string, Set<string>>();
  for (const trade of await prisma.trade.findMany({
    select: { assetId: true, userId: true }
  })) {
    const set = byAsset.get(trade.assetId) ?? new Set<string>();
    set.add(trade.userId);
    byAsset.set(trade.assetId, set);
  }

  return assets.map((asset) => ({
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    price: asset.cachedPrice === null ? null : num(asset.cachedPrice),
    priceFeedType: asset.priceFeedType === "pyth" ? "pyth" : "market",
    pythFeedId: asset.pythFeedId,
    priceKnown: asset.cachedPrice !== null,
    priceUpdatedAt: asset.priceUpdatedAt?.toISOString() ?? null,
    kind: asset.kind,
    onchainId: asset.onchainId,
    assetAddress: asset.assetAddress,
    mintAddress: asset.mintAddress,
    vaultAddress: asset.vaultAddress,
    oracleAddress: asset.oracleAddress,
    tradeCount: asset._count.trades,
    traderCount: byAsset.get(asset.id)?.size ?? 0
  }));
}

export async function getAssetBySymbol(symbol: string) {
  const all = await listAssets();
  return all.find((asset) => asset.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

/** Trades for one asset, newest first — the chart and the recent-trades list. */
export async function listTradesForAsset(
  assetId: string,
  limit = 50
): Promise<FeedTrade[]> {
  const trades = (await prisma.trade.findMany({
    where: { assetId },
    orderBy: { tradedAt: "desc" },
    take: limit,
    include: tradeInclude
  })) as unknown as RawTrade[];
  return withFomo(trades, null);
}

/**
 * How many accounts currently hold this asset.
 *
 * Replayed from the asset's trades rather than counted off the `Holding` mirror,
 * for the same reason the portfolio is: the mirror is written per-trade and has
 * no indexer to backfill it, so a holder whose position predates that write is
 * absent from it and would be undercounted. Grouping the trades by user and
 * counting those left with a positive net quantity is the honest number.
 */
export async function countHolders(assetId: string): Promise<number> {
  const trades = await prisma.trade.findMany({
    where: { assetId },
    orderBy: { tradedAt: "asc" },
    select: { userId: true, side: true, quantity: true, price: true }
  });

  const positions = replayPositions(
    trades.map((t) => ({
      key: t.userId,
      side: t.side,
      quantity: num(t.quantity),
      price: num(t.price)
    }))
  );

  let holders = 0;
  for (const { quantity } of positions.values()) if (quantity > 0) holders += 1;
  return holders;
}

/**
 * People the viewer follows who hold this asset.
 *
 * The join is the point: this is the "people you follow own this" panel, so it
 * is filtered by the follow graph rather than listing every holder. Returns an
 * empty list when the viewer follows nobody, which is an honest empty state.
 *
 * Positions are replayed from each follower's trades on this asset, not read
 * from the `Holding` mirror, so it agrees with the portfolio and the holder
 * count and cannot miss a follower whose position predates the mirror write.
 */
export async function listFollowersHolding(assetId: string, viewerId: string | null) {
  if (!viewerId) return [];

  const following = await prisma.follow.findMany({
    where: { followerId: viewerId },
    select: { followingId: true }
  });
  const ids = following.map((row) => row.followingId);
  if (ids.length === 0) return [];

  const [trades, asset] = await Promise.all([
    prisma.trade.findMany({
      where: { assetId, userId: { in: ids } },
      orderBy: { tradedAt: "asc" },
      select: {
        userId: true,
        side: true,
        quantity: true,
        price: true,
        user: { select: { id: true, username: true, displayName: true, avatar: true } }
      }
    }),
    prisma.asset.findUnique({ where: { id: assetId }, select: { cachedPrice: true } })
  ]);

  const positions = replayPositions(
    trades.map((t) => ({
      key: t.userId,
      side: t.side,
      quantity: num(t.quantity),
      price: num(t.price)
    }))
  );
  // The user record for each follower, from any of their trades on the asset.
  const userById = new Map(trades.map((t) => [t.userId, t.user]));
  const price = asset?.cachedPrice == null ? null : num(asset.cachedPrice);

  return [...positions.entries()]
    .filter(([, position]) => position.quantity > 0)
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .map(([userId, position]) => ({
      user: userById.get(userId)!,
      quantity: position.quantity,
      avgPrice: position.avgPrice,
      // Null rather than 0 when the price is unread: "we do not know what this
      // is worth" and "this is worth nothing" are different statements.
      value: price === null ? null : position.quantity * price
    }));
}

/**
 * A user's positions, valued at the current oracle price.
 *
 * One query plus arithmetic, like `listAssets` — not a query per holding.
 *
 * The honesty rule from the top of this file applies hardest here, because a
 * portfolio is where invented numbers do the most damage. If an asset's price
 * has not been read, that holding contributes `null` to every figure derived
 * from it — its own value, its allocation, and the portfolio total — and the
 * caller is told how many holdings were left out rather than being handed a
 * total that quietly omits them. A P&L computed against a guessed price is
 * indistinguishable from a real one on screen, which is exactly why it must not
 * be computed at all.
 */

/**
 * Replay trades into net positions, grouped by a caller-chosen key.
 *
 * The key is the asset when building one user's book (`getPortfolio`), and the
 * user when counting an asset's holders (`countHolders`) — the fold is the same
 * either way. It is the same arithmetic `applyHoldingDelta` writes to the
 * `Holding` mirror one trade at a time, done here over the whole history: a buy
 * adds shares and moves the volume-weighted average entry, a sell subtracts and
 * leaves the average untouched (the cost basis of what is still held has not
 * changed). Quantity is clamped at zero — a fully exited position lands at
 * exactly zero rather than a rounding-negative — and its average resets, so a
 * zero row reads as "no position" and cannot carry a stale price into the next
 * entry.
 *
 * Trades must arrive oldest-first, so each fold sees the position the one before
 * it left.
 */
export function replayPositions(
  trades: { key: string; side: string; quantity: number; price: number }[]
): Map<string, { quantity: number; avgPrice: number }> {
  const positions = new Map<string, { quantity: number; avgPrice: number }>();
  for (const trade of trades) {
    const held = positions.get(trade.key) ?? { quantity: 0, avgPrice: 0 };
    if (trade.side === "buy") {
      const nextQty = held.quantity + trade.quantity;
      // `nextQty` is positive here (a buy adds a positive quantity), so this
      // never divides by zero.
      const nextAvg =
        nextQty > 0
          ? (held.quantity * held.avgPrice + trade.quantity * trade.price) / nextQty
          : 0;
      positions.set(trade.key, { quantity: nextQty, avgPrice: nextAvg });
    } else {
      const nextQty = Math.max(0, held.quantity - trade.quantity);
      positions.set(trade.key, {
        quantity: nextQty,
        avgPrice: nextQty > 0 ? held.avgPrice : 0
      });
    }
  }
  return positions;
}

export async function getPortfolio(userId: string): Promise<PortfolioView> {
  // Positions are replayed from the user's own trades, not read from the
  // `Holding` mirror. On the synthetic app an indexer kept that mirror in step
  // with an on-chain Holding PDA; the bridge has neither, so the only writer is
  // `applyHoldingDelta`, per trade. A position opened before that write existed
  // — or by any trade the mirror missed — would then show as nothing at all,
  // which is the "$0 while I still hold it" bug. The trades are the record this
  // app owns, so replaying them (buys add and move the average, sells subtract)
  // is the honest source of a position, and it cannot silently omit one.
  const trades = await prisma.trade.findMany({
    where: { userId },
    orderBy: { tradedAt: "asc" },
    select: {
      assetId: true,
      side: true,
      quantity: true,
      price: true,
      asset: {
        select: {
          id: true,
          symbol: true,
          name: true,
          cachedPrice: true,
          priceUpdatedAt: true,
          priceFeedType: true,
          pythFeedId: true
        }
      }
    }
  });

  const positions = replayPositions(
    trades.map((t) => ({
      key: t.assetId,
      side: t.side,
      quantity: num(t.quantity),
      price: num(t.price)
    }))
  );
  // One asset record per held asset — any trade on it carries the same one.
  const assetById = new Map<string, (typeof trades)[number]["asset"]>();
  for (const t of trades) assetById.set(t.assetId, t.asset);

  const priced = [...positions.entries()].map(([assetId, position]) => {
    const asset = assetById.get(assetId)!;
    const quantity = position.quantity;
    const avgPrice = position.avgPrice;
    const price = asset.cachedPrice === null ? null : num(asset.cachedPrice);
    const value = price === null ? null : quantity * price;
    const cost = quantity * avgPrice;
    const unrealizedPnl = value === null ? null : value - cost;
    return {
      quantity,
      avgPrice,
      value,
      cost,
      unrealizedPnl,
      unrealizedPct:
        unrealizedPnl === null || cost === 0 ? null : (unrealizedPnl / cost) * 100,
      asset: {
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        price,
        priceFeedType: (asset.priceFeedType === "pyth"
          ? "pyth"
          : "market") as PriceFeedType,
        pythFeedId: asset.pythFeedId,
        priceKnown: price !== null,
        priceUpdatedAt: asset.priceUpdatedAt?.toISOString() ?? null
      }
    };
  });

  // A holding that has been fully exited is not a position. The row stays in the
  // table (the chain keeps the account) but it would be noise on this page.
  const open = priced.filter((row) => row.quantity > 0);
  const valued = open.filter((row) => row.value !== null);
  const totalValue = valued.length === 0 ? null : valued.reduce((sum, r) => sum + r.value!, 0);
  const totalCost = valued.length === 0 ? null : valued.reduce((sum, r) => sum + r.cost, 0);
  const unrealizedPnl =
    totalValue === null || totalCost === null ? null : totalValue - totalCost;

  return {
    holdings: open.map((row) => ({
      asset: row.asset,
      quantity: row.quantity,
      avgPrice: row.avgPrice,
      value: row.value,
      allocation:
        row.value === null || totalValue === null || totalValue === 0
          ? null
          : (row.value / totalValue) * 100,
      unrealizedPnl: row.unrealizedPnl,
      unrealizedPct: row.unrealizedPct
    })),
    totalValue,
    totalCost,
    unrealizedPnl,
    unrealizedPct:
      unrealizedPnl === null || !totalCost ? null : (unrealizedPnl / totalCost) * 100,
    unpricedCount: open.length - valued.length
  };
}

/**
 * A real portfolio value-over-time series for the performance chart.
 *
 * Reconstructed, not invented: for each day in the union of the held assets'
 * public price histories, the quantity the user held on that day is replayed
 * from their trade history (buys add, sells subtract), and valued at that day's
 * close. A day where nothing priced contributes nothing — the same honesty rule
 * as the portfolio total. Returns [] when there is no trade or no history to
 * reconstruct from, and the chart shows the current value without a line.
 */
export async function portfolioHistory(
  userId: string
): Promise<{ label: string; value: number }[]> {
  const trades = await prisma.trade.findMany({
    where: { userId },
    orderBy: { tradedAt: "asc" },
    select: {
      assetId: true,
      side: true,
      quantity: true,
      price: true,
      tradedAt: true,
      asset: { select: { symbol: true, cachedPrice: true } }
    }
  });
  if (trades.length === 0) return [];

  // When there is not enough public price history to plot real movement, draw a
  // straight line instead of an empty panel: flat at the current value of the
  // priced holdings, anchored at the first trade — "the chart starts when you
  // start buying." Null only when nothing held is priced (then the caller keeps
  // its placeholder). Uses `cachedPrice`, the same mark the rest of the
  // portfolio is valued at, so the headline and the line agree.
  const flatLine = (): { label: string; value: number }[] => {
    const positions = replayPositions(
      trades.map((t) => ({
        key: t.assetId,
        side: t.side,
        quantity: num(t.quantity),
        price: num(t.price)
      }))
    );
    const priceByAsset = new Map(trades.map((t) => [t.assetId, t.asset.cachedPrice]));
    let value = 0;
    let anyPriced = false;
    for (const [assetId, position] of positions) {
      if (position.quantity <= 0) continue;
      const cached = priceByAsset.get(assetId);
      if (cached === null || cached === undefined) continue;
      value += position.quantity * num(cached);
      anyPriced = true;
    }
    if (!anyPriced) return [];
    const rounded = Math.round(value * 100) / 100;
    const start = trades[0].tradedAt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
    return [
      { label: start, value: rounded },
      { label: "Now", value: rounded }
    ];
  };

  const symbols = [...new Set(trades.map((t) => t.asset.symbol))];
  const histories = await Promise.all(
    symbols.map(async (symbol) => [symbol, await priceHistory(symbol)] as const)
  );
  const seriesBySymbol = new Map(histories);

  // The union of all price-history dates, ascending, from the first trade on.
  const firstTrade = trades[0].tradedAt.getTime();
  const dates = [
    ...new Set(
      histories.flatMap(([, points]) => points.map((p) => p.at)).filter((at) => at >= firstTrade)
    )
  ].sort((a, b) => a - b);
  if (dates.length < 2) return flatLine();

  const priceAt = (symbol: string, at: number): number | null => {
    const points = seriesBySymbol.get(symbol) ?? [];
    let value: number | null = null;
    for (const point of points) {
      if (point.at <= at) value = point.price;
      else break;
    }
    return value;
  };

  const qtyAt = (symbol: string, at: number): number =>
    trades
      .filter((t) => t.asset.symbol === symbol && t.tradedAt.getTime() <= at)
      .reduce((sum, t) => sum + (t.side === "buy" ? 1 : -1) * num(t.quantity), 0);

  const out: { label: string; value: number }[] = [];
  for (const at of dates) {
    let value = 0;
    let priced = false;
    for (const symbol of symbols) {
      const quantity = qtyAt(symbol, at);
      if (quantity <= 0) continue;
      const price = priceAt(symbol, at);
      if (price === null) continue;
      value += quantity * price;
      priced = true;
    }
    if (!priced) continue;
    out.push({
      label: new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value: Math.round(value * 100) / 100
    });
  }

  return out.length >= 2 ? out : flatLine();
}

/**
 * One position, for the trade panel's sell side.
 *
 * Replayed from this user's trades on the asset, the same way `getPortfolio`
 * builds the whole book — so the sell form and the portfolio always agree, and
 * neither can be blanked by a `Holding` mirror row that was never written.
 *
 * A holding at zero is returned as null: "you hold none of this" is the honest
 * answer to give a sell form, and `0` renders as a quantity that looks like a
 * position.
 */
export async function getHolding(
  userId: string,
  assetId: string
): Promise<{ quantity: number; avgPrice: number } | null> {
  const trades = await prisma.trade.findMany({
    where: { userId, assetId },
    orderBy: { tradedAt: "asc" },
    select: { assetId: true, side: true, quantity: true, price: true }
  });

  const position = replayPositions(
    trades.map((t) => ({
      key: t.assetId,
      side: t.side,
      quantity: num(t.quantity),
      price: num(t.price)
    }))
  ).get(assetId);

  if (!position || position.quantity <= 0) return null;
  return { quantity: position.quantity, avgPrice: position.avgPrice };
}

export async function listNotifications(
  userId: string,
  limit = 50
): Promise<NotificationView[]> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, username: true, displayName: true, avatar: true } },
      asset: { select: { symbol: true, name: true } },
      trade: { select: { amountUsdc: true, side: true, assetId: true } }
    }
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    createdAt: row.createdAt.toISOString(),
    read: row.readAt !== null,
    actor: row.actor,
    assetSymbol: row.asset?.symbol ?? null,
    assetName: row.asset?.name ?? null,
    tradeId: row.tradeId,
    amountUsdc: row.trade ? num(row.trade.amountUsdc) : null,
    side: row.trade ? (row.trade.side === "sell" ? "sell" : "buy") : null,
    // The link goes to the actor's profile for a FOMO — the point of that
    // notification is who did it, not which asset.
    href:
      row.type === "FOMO" && row.actor
        ? `/profile/${row.actor.username}`
        : row.asset
          ? `/asset/${row.asset.symbol}`
          : "/feed"
  }));
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** How many accounts this user follows — the "Following" metric on the feed. */
export async function followingCount(userId: string): Promise<number> {
  return prisma.follow.count({ where: { followerId: userId } });
}

export async function getProfile(
  username: string,
  viewerId: string | null
): Promise<ProfileView | null> {
  const user = await prisma.user.findUnique({
    where: { username: username.replace(/^@/, "") },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
      walletAddress: true,
      createdAt: true,
      bio: true,
      links: true,
      // Whether, not which: the profile surfaces that an identity is connected,
      // never the provider id itself.
      xUserId: true,
      googleId: true,
      _count: { select: { followers: true, following: true } }
    }
  });
  if (!user) return null;

  const [trades, viewerFollows] = await Promise.all([
    listTradesForUser(user.id, viewerId),
    viewerId
      ? prisma.follow
          .findUnique({
            where: {
              followerId_followingId: { followerId: viewerId, followingId: user.id }
            }
          })
          .then((row) => row !== null)
      : Promise.resolve(false)
  ]);

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      walletAddress: user.walletAddress,
      createdAt: user.createdAt.toISOString(),
      bio: user.bio,
      links: parseProfileLinks(user.links),
      hasX: user.xUserId != null,
      hasGoogle: user.googleId != null
    },
    followers: user._count.followers,
    following: user._count.following,
    trades,
    viewerFollows,
    isViewer: viewerId === user.id
  };
}

/**
 * A case-insensitive match on username or display name.
 *
 * `mode: "insensitive"` is a PostgreSQL feature. SQLite has no such argument —
 * its `LIKE` is already case-insensitive for ASCII — and passing it there is
 * rejected at runtime, so the two providers need genuinely different arguments
 * rather than one that happens to work on both.
 *
 * Which is why this is a branch *and* a cast. The cast is because Prisma
 * generates a provider-specific client and this repository generates both: with
 * the SQLite schema in hand, the PostgreSQL branch below would not typecheck,
 * and vice versa. The cast is confined to this function and the branch decides
 * what is actually sent, so the two cannot drift into a silently wrong query —
 * they can only produce the right one for the provider that is running.
 */
function nameSearch(search: string): Prisma.UserWhereInput {
  const postgres = (process.env.DATABASE_URL ?? "").startsWith("postgres");
  const match = postgres ? { contains: search, mode: "insensitive" } : { contains: search };
  return {
    OR: [{ username: match }, { displayName: match }]
  } as Prisma.UserWhereInput;
}

/**
 * People the viewer follows, plus everyone else, for the friends page.
 *
 * `query` filters by username or display name. Filtered in SQL rather than in
 * the component because the unfiltered list is every user in the database, and
 * a search that only matches within the first page of a list is a search that
 * silently stops working as the site grows.
 */
export async function listPeople(viewerId: string | null, query?: string) {
  const search = query?.trim().replace(/^@/, "") ?? "";

  const users = await prisma.user.findMany({
    where: search ? nameSearch(search) : undefined,
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatar: true,
      _count: { select: { followers: true, trades: true } }
    }
  });

  const viewerFollowing = viewerId
    ? new Set(
        (
          await prisma.follow.findMany({
            where: { followerId: viewerId },
            select: { followingId: true }
          })
        ).map((row) => row.followingId)
      )
    : new Set<string>();

  return users.map((user) => ({
    ...user,
    followerCount: user._count.followers,
    tradeCount: user._count.trades,
    viewerFollows: viewerFollowing.has(user.id),
    isViewer: viewerId === user.id
  }));
}
