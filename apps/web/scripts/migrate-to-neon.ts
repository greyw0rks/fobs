// scripts/migrate-to-neon.ts
//
// One-off: copy all data from the Railway Postgres (SOURCE) into Neon (DEST).
// Both URLs come from the environment so no secret is written to disk:
//
//   SOURCE_DATABASE_URL=postgresql://…(railway, via tunnel or public proxy)
//   DEST_DATABASE_URL=postgresql://…(neon direct)
//   pnpm exec tsx scripts/migrate-to-neon.ts
//
// Order respects foreign keys (parents before children). Trade has a
// self-reference (sourceTradeId → Trade), so trades are inserted with it nulled
// and then patched in a second pass. Idempotent: skipDuplicates means a re-run
// tops up rather than doubling. Delete this file once the cutover is done.

import { PrismaClient } from "@prisma/client";

const src = new PrismaClient({
  datasources: { db: { url: process.env.SOURCE_DATABASE_URL } }
});
const dst = new PrismaClient({
  datasources: { db: { url: process.env.DEST_DATABASE_URL } }
});

async function main() {
  if (!process.env.SOURCE_DATABASE_URL || !process.env.DEST_DATABASE_URL) {
    throw new Error("Set SOURCE_DATABASE_URL and DEST_DATABASE_URL.");
  }

  // Independent parents first.
  const users = await src.user.findMany();
  const assets = await src.asset.findMany();
  const nonces = await src.authNonce.findMany();

  // Children of the above.
  const wallets = await src.wallet.findMany();
  const sessions = await src.session.findMany();
  const trades = await src.trade.findMany();
  const holdings = await src.holding.findMany();
  const follows = await src.follow.findMany();
  const notifications = await src.notification.findMany();

  await dst.user.createMany({ data: users, skipDuplicates: true });
  await dst.asset.createMany({ data: assets, skipDuplicates: true });
  await dst.authNonce.createMany({ data: nonces, skipDuplicates: true });
  await dst.wallet.createMany({ data: wallets, skipDuplicates: true });
  await dst.session.createMany({ data: sessions, skipDuplicates: true });

  // Trades: null the self-reference on insert, then patch it back.
  await dst.trade.createMany({
    data: trades.map((t) => ({ ...t, sourceTradeId: null })),
    skipDuplicates: true
  });
  for (const t of trades) {
    if (t.sourceTradeId) {
      await dst.trade.update({
        where: { id: t.id },
        data: { sourceTradeId: t.sourceTradeId }
      });
    }
  }

  await dst.holding.createMany({ data: holdings, skipDuplicates: true });
  await dst.follow.createMany({ data: follows, skipDuplicates: true });
  await dst.notification.createMany({ data: notifications, skipDuplicates: true });

  // Verify: counts should match on both sides.
  const models = [
    "user", "asset", "authNonce", "wallet", "session",
    "trade", "holding", "follow", "notification"
  ] as const;
  console.log("\nrow counts (source → dest):");
  for (const m of models) {
    const s = await (src as any)[m].count();
    const d = await (dst as any)[m].count();
    const mark = s === d ? "ok" : "MISMATCH";
    console.log(`  ${m.padEnd(14)} ${String(s).padStart(6)} → ${String(d).padStart(6)}  ${mark}`);
  }
}

main()
  .then(() => console.log("\ndone."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await src.$disconnect();
    await dst.$disconnect();
  });
