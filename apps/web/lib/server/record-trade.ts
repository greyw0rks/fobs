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
