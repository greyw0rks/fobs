/**
 * Bring an existing database up to what a fresh one gets.
 *
 * **Wallets.** Every user with a `walletAddress` but no `Wallet` row gets one.
 * Without it the indexer still works (it falls back to the column), but linking
 * a second wallet would leave the first invisible to everything that reads
 * `Wallet` — so the row has to exist before anyone links anything.
 *
 * Run: pnpm backfill
 *
 * Idempotent — the pass reads before it writes, so running it twice changes
 * nothing the second time.
 */
import { PrismaClient } from "@prisma/client";
import { backfillWallets } from "@/lib/server/wallets";

const prisma = new PrismaClient();

async function main() {
  console.log("backfilling wallets…");
  const wallets = await backfillWallets();
  console.log(`  created ${wallets.created}, already present ${wallets.skipped}`);

  const [follows, walletRows] = await Promise.all([
    prisma.follow.count(),
    prisma.wallet.count()
  ]);

  console.log("\ntotals");
  console.log(`  follows       ${follows}`);
  console.log(`  wallets       ${walletRows}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
