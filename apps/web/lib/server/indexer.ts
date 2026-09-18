import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { connection, fromBaseUnits } from "@/lib/solana/config";
import { holdingPda, receiptPda } from "@/lib/solana/pdas";
import { program } from "@/lib/solana/trade";
import { publish, type NotificationEvent, type TradeEvent } from "./events";

/**
 * Solana → Postgres.
 *
 * This is the only thing in the app that writes a `Trade`, and it writes only
 * what it read from a receipt account. Nothing here trusts an event log, a
 * client callback, or the transaction that submitted the trade — the receipt PDA
 * is the record, and it is re-read from the chain on every pass.
 *
 * The cursor is the asset's own monotonic `trade_count`, which is what makes a
 * missed pass self-healing: pass N fails, pass N+1 finds `trade_count` ahead of
 * `Asset.indexedTrades` and ingests the gap. There is no window in which a trade
 * can be skipped permanently, only delayed. Logs would not give that — a dropped
 * log line is gone.
 *
 * Receipts are addressed by index: the program seeds receipt N with the asset's
 * `trade_count` *before* incrementing, so receipts occupy `[0, trade_count)`.
 */

export type IndexResult = {
  assets: number;
  tradesIngested: number;
  pricesUpdated: number;
  /** Holdings reconciled against the program's own Holding accounts. */
  holdingsSynced: number;
  errors: { asset: string; message: string }[];
};

/**
 * The transaction that created a receipt account.
 *
 * A receipt does not store its own signature, so it has to be looked up. The
 * account is created exactly once, so the oldest signature for the address is
 * the trade. A miss is not fatal — the trade is still real and indexed — so the
 * caller treats a null signature as "no Explorer link yet" rather than an error.
 */
async function signatureFor(address: PublicKey): Promise<string | null> {
  try {
    const signatures = await connection().getSignaturesForAddress(address, { limit: 1 });
    return signatures[0]?.signature ?? null;
  } catch {
    return null;
  }
}

async function ingestAsset(asset: {
  id: string;
  symbol: string;
  onchainId: number;
  assetAddress: string;
  oracleAddress: string | null;
  indexedTrades: number;
}): Promise<{ ingested: number; priceUpdated: boolean; errors: string[] }> {
  const conn = connection();
  const assetKey = new PublicKey(asset.assetAddress);
  const anchorProgram = program(conn, PublicKey.default);
  const errors: string[] = [];

  const onchain = await anchorProgram.account.asset.fetch(assetKey);
  const tradeCount = Number(onchain.tradeCount.toString());

  // Always refresh the price, even when there are no new trades: the admin can
  // move a mock price without anyone trading, and a stale cached price would
  // then disagree with what the program would actually charge.
  let priceUpdated = false;
  if (asset.oracleAddress) {
    try {
      const oracle = await anchorProgram.account.mockOracle.fetch(
        new PublicKey(asset.oracleAddress)
      );
      await prisma.asset.update({
        where: { id: asset.id },
        data: { cachedPrice: fromBaseUnits(oracle.price) }
      });
      priceUpdated = true;
    } catch (error) {
      errors.push(`price: ${(error as Error).message}`);
    }
  }

  if (tradeCount <= asset.indexedTrades) {
    return { ingested: 0, priceUpdated, errors };
  }

  let ingested = 0;
  for (let index = asset.indexedTrades; index < tradeCount; index++) {
    const receiptAddress = receiptPda(assetKey, index);
    const receipt = await anchorProgram.account.tradeReceipt.fetch(receiptAddress);

    // The wallet that signed is the only identity link between the chain and a
    // user. A trade from a wallet we do not know about is skipped rather than
    // attributed to a guess.
    const owner = receipt.owner.toBase58();
    const user = await prisma.user.findUnique({ where: { walletAddress: owner } });
    if (!user) {
      errors.push(`receipt ${index}: no user for wallet ${owner}`);
      continue;
    }

    // Provenance only. The source trade is looked up, never copied: everything
    // about this trade came from its own receipt.
    let sourceTradeId: string | null = null;
    let sourceTradeOwnerId: string | null = null;
    if (receipt.sourceReceipt) {
      const source = await prisma.trade.findUnique({
        where: { onchainReceipt: receipt.sourceReceipt.toBase58() },
        select: { id: true, userId: true }
      });
      sourceTradeId = source?.id ?? null;
      sourceTradeOwnerId = source?.userId ?? null;
    }

    const tradedAt = new Date(Number(receipt.timestamp.toString()) * 1000);
    const side = "buy" in receipt.side ? "buy" : "sell";

    // Upsert on the receipt address: re-reading the same receipt is a no-op, so
    // a pass that crashes midway can simply be re-run.
    const existing = await prisma.trade.findUnique({
      where: { onchainReceipt: receiptAddress.toBase58() },
      select: { id: true }
    });
    if (existing) continue;

    const txSignature = await signatureFor(receiptAddress);

    const trade = await prisma.trade.create({
      data: {
        userId: user.id,
        assetId: asset.id,
        side,
        amountUsdc: fromBaseUnits(receipt.amountUsdc),
        quantity: fromBaseUnits(receipt.quantity),
        price: fromBaseUnits(receipt.price),
        onchainReceipt: receiptAddress.toBase58(),
        txSignature,
        tradedAt,
        sourceTradeId
      }
    });
    ingested++;

    const payload: TradeEvent = {
      type: "trade",
      id: trade.id,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      assetSymbol: asset.symbol,
      side,
      amountUsdc: trade.amountUsdc.toString(),
      quantity: trade.quantity.toString(),
      price: trade.price.toString(),
      sourceTradeId,
      txSignature,
      tradedAt: tradedAt.toISOString()
    };
    publish(payload);

    await notifyForTrade({
      tradeId: trade.id,
      assetId: asset.id,
      assetSymbol: asset.symbol,
      actorUserId: user.id,
      sourceTradeOwnerId
    });

    // Devnet's public RPC 429s on bursts, and a demo run is short enough that
    // pacing costs nothing.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  await prisma.asset.update({
    where: { id: asset.id },
    data: { indexedTrades: tradeCount }
  });

  return { ingested, priceUpdated, errors };
}

/**
 * The notification loop is the product, so this is where the product's meaning
 * lives: a trade becomes something for other people to see.
 *
 * Four kinds, each with a distinct recipient:
 *
 *   TRADE_CONFIRMED  the trader, that their own trade landed
 *   FRIEND_TRADE     everyone who follows the trader — this is what makes the
 *                    feed social rather than a log
 *   FOMO             the author of the source trade, that someone followed them
 *   FOLLOW           created by the follow endpoint, not here
 */
async function notifyForTrade(input: {
  tradeId: string;
  assetId: string;
  assetSymbol: string;
  actorUserId: string;
  sourceTradeOwnerId: string | null;
}) {
  const { tradeId, assetId, assetSymbol, actorUserId, sourceTradeOwnerId } = input;

  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: actorUserId },
    select: { username: true, displayName: true }
  });

  const rows: {
    userId: string;
    type: "TRADE_CONFIRMED" | "FRIEND_TRADE" | "FOMO";
    actorUserId: string;
    tradeId: string;
    assetId: string;
  }[] = [
    {
      userId: actorUserId,
      type: "TRADE_CONFIRMED",
      actorUserId,
      tradeId,
      assetId
    }
  ];

  const followers = await prisma.follow.findMany({
    where: { followingId: actorUserId },
    select: { followerId: true }
  });
  for (const { followerId } of followers) {
    rows.push({
      userId: followerId,
      type: "FRIEND_TRADE",
      actorUserId,
      tradeId,
      assetId
    });
  }

  // Only when the source trade belongs to someone else — FOMOing your own trade
  // is not a thing, and notifying yourself about it would be noise.
  if (sourceTradeOwnerId && sourceTradeOwnerId !== actorUserId) {
    rows.push({
      userId: sourceTradeOwnerId,
      type: "FOMO",
      actorUserId,
      tradeId,
      assetId
    });
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
      actorUsername: actor.username,
      actorDisplayName: actor.displayName,
      assetSymbol,
      tradeId,
      createdAt: notification.createdAt.toISOString()
    };
    publish(payload);
  }
}

/**
 * Mirror every (user, asset) holding this app knows about, by reading the
 * program's own `Holding` accounts.
 *
 * Read, not accumulated. The program maintains `quantity` and a volume-weighted
 * `avg_price` and is the authority for both; recomputing either from the trade
 * history here would be a second implementation of the program's arithmetic,
 * and the first thing to drift. Reading also means a wallet that traded before
 * this existed backfills on the next pass instead of showing nothing until it
 * trades again.
 *
 * The set of accounts to read is derived from trades we have already indexed:
 * only a wallet with a trade can have a holding, so this never guesses at
 * (user, asset) pairs. A missing account is skipped rather than written as a
 * zero row — "no Holding account" means the program never created one, and a
 * zero row would be this app asserting something the chain does not say.
 */
async function syncHoldings(asset: { id: string; assetAddress: string }): Promise<number> {
  const assetKey = new PublicKey(asset.assetAddress);
  const anchorProgram = program(connection(), PublicKey.default);

  // Distinct traders for this asset, as (user, wallet) pairs. The wallet is what
  // derives the PDA; the user id is what the row is keyed by.
  const traders = await prisma.trade.findMany({
    where: { assetId: asset.id },
    select: { userId: true, user: { select: { walletAddress: true } } },
    distinct: ["userId"]
  });

  let synced = 0;
  for (const trader of traders) {
    const wallet = trader.user.walletAddress;
    if (!wallet) continue;

    // A holder who has fully exited still has an account with quantity 0 — the
    // program keeps it — so a zero here is a real answer and is written.
    const holding = await anchorProgram.account.holding
      .fetch(holdingPda(new PublicKey(wallet), assetKey))
      .catch(() => null);
    if (!holding) continue;

    const quantity = fromBaseUnits(holding.quantity);
    const avgPrice = fromBaseUnits(holding.avgPrice);

    await prisma.holding.upsert({
      where: { userId_assetId: { userId: trader.userId, assetId: asset.id } },
      create: { userId: trader.userId, assetId: asset.id, quantity, avgPrice },
      update: { quantity, avgPrice }
    });
    synced++;
  }

  return synced;
}

/**
 * Index a single asset.
 *
 * Used straight after a trade we just sent, so the receipt we already know about
 * is in Postgres by the time the HTTP response returns. Running the full pass
 * here would work but would also re-read four unrelated assets and their
 * oracles, which on devnet means four more chances to be rate-limited.
 */
export async function indexAsset(assetId: string): Promise<IndexResult> {
  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id: assetId },
    select: {
      id: true,
      symbol: true,
      onchainId: true,
      assetAddress: true,
      oracleAddress: true,
      indexedTrades: true
    }
  });

  const { ingested, priceUpdated, errors } = await ingestAsset(asset);

  let holdingsSynced = 0;
  try {
    holdingsSynced = await syncHoldings(asset);
  } catch (error) {
    // A holdings failure must not lose the trades that just indexed. The chain
    // is still the authority and the next pass reconciles.
    errors.push(`holdings: ${(error as Error).message}`);
  }

  return {
    assets: 1,
    tradesIngested: ingested,
    pricesUpdated: priceUpdated ? 1 : 0,
    holdingsSynced,
    errors: errors.map((message) => ({ asset: asset.symbol, message }))
  };
}

/** One pass over every asset. Safe to run concurrently-ish and safe to re-run. */
export async function runIndexer(): Promise<IndexResult> {
  const assets = await prisma.asset.findMany({
    orderBy: { onchainId: "asc" },
    select: {
      id: true,
      symbol: true,
      onchainId: true,
      assetAddress: true,
      oracleAddress: true,
      indexedTrades: true
    }
  });

  const result: IndexResult = {
    assets: assets.length,
    tradesIngested: 0,
    pricesUpdated: 0,
    holdingsSynced: 0,
    errors: []
  };

  for (const asset of assets) {
    try {
      const { ingested, priceUpdated, errors } = await ingestAsset(asset);
      result.tradesIngested += ingested;
      if (priceUpdated) result.pricesUpdated++;
      for (const message of errors) result.errors.push({ asset: asset.symbol, message });

      // Reconciled on every pass, not only when trades arrived: a holding can
      // change without a new trade only if something else wrote to the chain,
      // and re-reading is cheap next to being wrong.
      try {
        result.holdingsSynced += await syncHoldings(asset);
      } catch (error) {
        result.errors.push({
          asset: asset.symbol,
          message: `holdings: ${(error as Error).message}`
        });
      }
    } catch (error) {
      // One unreachable asset must not stop the pass; the cursor means the next
      // run picks up whatever this one missed.
      result.errors.push({ asset: asset.symbol, message: (error as Error).message });
    }
  }

  publish({
    type: "indexer",
    assets: result.assets,
    tradesIngested: result.tradesIngested,
    at: new Date().toISOString()
  });

  return result;
}

/** Exported for the /dev dashboard, which lists assets with their cursor state. */
export async function indexerStatus() {
  const assets = await prisma.asset.findMany({
    orderBy: { onchainId: "asc" },
    select: {
      symbol: true,
      onchainId: true,
      assetAddress: true,
      indexedTrades: true,
      cachedPrice: true
    }
  });
  return Promise.all(
    assets.map(async (asset) => {
      const onchain = await program(connection(), PublicKey.default).account.asset
        .fetch(new PublicKey(asset.assetAddress))
        .then((account) => Number(account.tradeCount.toString()))
        .catch(() => null);
      return {
        ...asset,
        cachedPrice: asset.cachedPrice?.toString() ?? null,
        onchainTradeCount: onchain,
        behind: onchain === null ? null : onchain - asset.indexedTrades
      };
    })
  );
}
