import { prisma } from "@/lib/prisma";
import { publish, type NotificationEvent, type TradeEvent } from "./events";
import type { Tradeable } from "./tradeable";

/**
 * Author a trade the bridge just settled, and wake the social layer.
 *
 * On the synthetic app the indexer was the only writer of `Trade` rows: it read
 * a `TradeReceipt` PDA back off the chain and mirrored it. A Jupiter swap has no
 * receipt PDA and no `Holding` account, so there is nothing to poll — the swap's
 * transaction signature *is* its identity. This route-side function takes the
 * place of the indexer for the one trade it just confirmed: it resolves the real
 * mint to an `Asset` row, writes the `Trade` keyed on the signature, and fires
 * the same feed event and notifications the indexer used to.
 *
 * Idempotent on the signature: re-submitting the same confirmed swap upserts the
 * same row rather than double-recording it.
 */

/** Ensure an Asset row exists for a real mint, and return its id. */
async function assetForTradeable(asset: Tradeable): Promise<string> {
  const row = await prisma.asset.upsert({
    where: { mintAddress: asset.mint },
    // The synthetic-program fields (onchainId, assetAddress, vault…) are left
    // null: a bridged asset has no program PDAs. `symbol` is the tradeable key,
    // which is unique across the universe.
    create: {
      symbol: asset.key,
      name: asset.name,
      mintAddress: asset.mint,
      decimals: asset.decimals,
      kind: asset.kind
    },
    update: { name: asset.name, decimals: asset.decimals, kind: asset.kind },
    select: { id: true }
  });
  return row.id;
}

export type RecordTradeInput = {
  userId: string;
  username: string;
  displayName: string;
  asset: Tradeable;
  side: "buy" | "sell";
  /** USD moved: what was spent on a buy, or received on a sell. */
  amountUsdc: number;
  /** Whole tokens bought or sold — the honest, fee-adjusted figure. */
  quantity: number;
  /** USD per token, `amountUsdc / quantity`. */
  price: number;
  /** The confirmed swap's transaction signature — this trade's identity. */
  signature: string;
  sourceTradeId?: string | null;
};

export async function recordSwapTrade(input: RecordTradeInput): Promise<{ id: string }> {
  const existing = await prisma.trade.findUnique({
    where: { txSignature: input.signature },
    select: { id: true }
  });
  if (existing) return existing;

  const assetId = await assetForTradeable(input.asset);

  let sourceTradeOwnerId: string | null = null;
  if (input.sourceTradeId) {
    const source = await prisma.trade.findUnique({
      where: { id: input.sourceTradeId },
      select: { userId: true }
    });
    sourceTradeOwnerId = source?.userId ?? null;
  }

  const tradedAt = new Date();
  const trade = await prisma.trade.create({
    data: {
      userId: input.userId,
      assetId,
      side: input.side,
      amountUsdc: input.amountUsdc,
      quantity: input.quantity,
      price: input.price,
      // The swap signature is the trade's on-chain identity now, so it fills the
      // field the receipt PDA used to and the idempotency key both.
      onchainReceipt: input.signature,
      txSignature: input.signature,
      tradedAt,
      sourceTradeId: input.sourceTradeId ?? null
    },
    select: { id: true }
  });

  // Mirror the position. The indexer used to keep `Holding` in step by reading
  // the program's Holding PDA back off the chain; a Jupiter swap has no such
  // account, so — just as this function stands in for the indexer's `Trade`
  // write — it stands in for its `Holding` write too. Without this the stock
  // balance every holdings surface reads (the trade panel's "tokens you hold",
  // the portfolio, the holder counts) never moves off zero after a swap.
  await applyHoldingDelta({
    userId: input.userId,
    assetId,
    side: input.side,
    quantity: input.quantity,
    price: input.price
  });

  const tradeEvent: TradeEvent = {
    type: "trade",
    id: trade.id,
    userId: input.userId,
    username: input.username,
    displayName: input.displayName,
    assetSymbol: input.asset.key,
    side: input.side,
    amountUsdc: input.amountUsdc.toString(),
    quantity: input.quantity.toString(),
    price: input.price.toString(),
    sourceTradeId: input.sourceTradeId ?? null,
    txSignature: input.signature,
    tradedAt: tradedAt.toISOString()
  };
  publish(tradeEvent);

  await notifyForTrade({
    tradeId: trade.id,
    assetId,
    assetSymbol: input.asset.key,
    actorUserId: input.userId,
    actorUsername: input.username,
    actorDisplayName: input.displayName,
    sourceTradeOwnerId
  });

  return { id: trade.id };
}

/**
 * Fold one confirmed swap into the `Holding` mirror.
 *
 * A buy adds shares and moves the average entry price by volume; a sell removes
 * shares and leaves the average untouched, because the cost basis of what is
 * still held has not changed. Quantity is clamped at zero: selling the whole
 * position lands the row at exactly zero rather than a tiny negative from
 * rounding, and the readers all treat a zero row as "no position".
 *
 * The economics come from the same fee-adjusted quote the `Trade` row was
 * written from, so the mirror agrees with the trade that produced it.
 */
async function applyHoldingDelta(input: {
  userId: string;
  assetId: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
}): Promise<void> {
  const existing = await prisma.holding.findUnique({
    where: { userId_assetId: { userId: input.userId, assetId: input.assetId } },
    select: { quantity: true, avgPrice: true }
  });

  const heldQty = existing ? Number(existing.quantity) : 0;
  const heldAvg = existing ? Number(existing.avgPrice) : 0;

  if (input.side === "buy") {
    const nextQty = heldQty + input.quantity;
    // Volume-weighted so the average entry reflects both lots. `nextQty` is
    // positive here (a buy adds a positive quantity), so this never divides by
    // zero.
    const nextAvg = (heldQty * heldAvg + input.quantity * input.price) / nextQty;
    await prisma.holding.upsert({
      where: { userId_assetId: { userId: input.userId, assetId: input.assetId } },
      create: {
        userId: input.userId,
        assetId: input.assetId,
        quantity: nextQty,
        avgPrice: nextAvg
      },
      update: { quantity: nextQty, avgPrice: nextAvg }
    });
    return;
  }

  // A sell of tokens we have no mirror row for (acquired outside FOBS) leaves
  // nothing to decrement; recording a negative position would be a lie.
  const nextQty = Math.max(0, heldQty - input.quantity);
  await prisma.holding.upsert({
    where: { userId_assetId: { userId: input.userId, assetId: input.assetId } },
    create: {
      userId: input.userId,
      assetId: input.assetId,
      quantity: nextQty,
      avgPrice: input.price
    },
    update: { quantity: nextQty, avgPrice: heldAvg }
  });
}

/** The trade's own owner, everyone following them, and the FOMO'd trader. */
async function notifyForTrade(input: {
  tradeId: string;
  assetId: string;
  assetSymbol: string;
  actorUserId: string;
  actorUsername: string;
  actorDisplayName: string;
  sourceTradeOwnerId: string | null;
}) {
  const rows: {
    userId: string;
    type: "TRADE_CONFIRMED" | "FRIEND_TRADE" | "FOMO";
    actorUserId: string;
    tradeId: string;
    assetId: string;
  }[] = [
    { userId: input.actorUserId, type: "TRADE_CONFIRMED", actorUserId: input.actorUserId, tradeId: input.tradeId, assetId: input.assetId }
  ];

  const followers = await prisma.follow.findMany({
    where: { followingId: input.actorUserId },
    select: { followerId: true }
  });
  for (const { followerId } of followers) {
    rows.push({ userId: followerId, type: "FRIEND_TRADE", actorUserId: input.actorUserId, tradeId: input.tradeId, assetId: input.assetId });
  }

  // FOMOing your own trade is not a thing, so a self-source fires no FOMO ping.
  if (input.sourceTradeOwnerId && input.sourceTradeOwnerId !== input.actorUserId) {
    rows.push({ userId: input.sourceTradeOwnerId, type: "FOMO", actorUserId: input.actorUserId, tradeId: input.tradeId, assetId: input.assetId });
  }

  const created = await prisma.$transaction(
    rows.map((row) =>
      prisma.notification.create({ data: row, select: { id: true, userId: true, type: true, createdAt: true } })
    )
  );

  for (const notification of created) {
    const payload: NotificationEvent = {
      type: "notification",
      id: notification.id,
      userId: notification.userId,
      kind: notification.type,
      actorUsername: input.actorUsername,
      actorDisplayName: input.actorDisplayName,
      assetSymbol: input.assetSymbol,
      tradeId: input.tradeId,
      createdAt: notification.createdAt.toISOString()
    };
    publish(payload);
  }
}
