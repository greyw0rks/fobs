/**
 * Populate the markets list with the tradeable universe.
 *
 * A bridged asset only lands in the `Asset` table when someone first swaps it —
 * which leaves the markets page empty until then. This seeds the universe the
 * bridge actually opens (xStocks, Ondo, PreStocks) so the catalogue is there on
 * first visit, priced from a live read at seed time. It is a snapshot, not a
 * feed: re-run it to refresh prices. The asset *detail* pages price live.
 *
 * Idempotent: upserts on the real mint, so re-running updates prices in place
 * rather than duplicating rows. Reads only — it signs nothing.
 *
 * Run against a database:  DATABASE_URL=... pnpm --dir apps/web seed:markets
 * Against production:       railway run --service web pnpm --dir apps/web seed:markets
 */

import { prisma } from "@/lib/prisma";
import { routedEquities } from "@/lib/server/routed-equities";
import { fetchPreStocks } from "@/lib/server/prestocks";
import { readMintPolicy } from "@/lib/server/token2022";
import { referencePrice } from "@/lib/server/pyth-reference";
import { PRESTOCK_SYMBOLS } from "@/lib/server/tradeable";

type Seed = {
  symbol: string; // the tradeable key
  name: string;
  mint: string;
  decimals: number;
  kind: "xstock" | "ondo" | "prestock";
  price: number | null;
  isPyth: boolean;
};

async function upsert(seed: Seed): Promise<void> {
  await prisma.asset.upsert({
    where: { mintAddress: seed.mint },
    create: {
      symbol: seed.symbol,
      name: seed.name,
      mintAddress: seed.mint,
      decimals: seed.decimals,
      kind: seed.kind,
      cachedPrice: seed.price ?? undefined,
      // Only listed equities have a Pyth feed; a pre-IPO name is priced by its
      // live route/mark, which the legacy enum has no value for, so it stays null.
      priceFeedType: seed.isPyth ? "pyth" : null,
      priceUpdatedAt: seed.price != null ? new Date() : undefined
    },
    update: {
      name: seed.name,
      decimals: seed.decimals,
      kind: seed.kind,
      cachedPrice: seed.price ?? undefined,
      priceFeedType: seed.isPyth ? "pyth" : null,
      priceUpdatedAt: seed.price != null ? new Date() : undefined
    }
  });
  const shown = seed.price != null ? `$${seed.price.toFixed(2)}` : "no price";
  console.log(`  ${seed.kind.padEnd(8)} ${seed.symbol.padEnd(12)} ${shown}`);
}

async function main() {
  let count = 0;

  // --- Listed equities: xStocks (Backed) + Ondo, one batched Jupiter search ---
  console.log("Listed equities:");
  const { equities, failures } = await routedEquities();
  for (const equity of equities) {
    const isOndo = equity.issuer === "Ondo";
    // Price from Pyth — the reference the guard trusts. A failure here is not
    // fatal to the seed; the row still lists, priced on its detail page.
    let price: number | null = null;
    try {
      price = (await referencePrice(equity.symbol)).price;
    } catch (error) {
      console.log(`    (no Pyth price for ${equity.symbol}: ${(error as Error).message})`);
    }
    await upsert({
      symbol: isOndo ? `${equity.symbol}-ondo` : equity.symbol,
      name: equity.name,
      mint: equity.mint,
      decimals: equity.decimals,
      kind: isOndo ? "ondo" : "xstock",
      price,
      isPyth: true
    });
    count++;
  }
  for (const failure of failures) {
    console.log(`    skipped ${failure.label}: ${failure.reason}`);
  }

  // --- Pre-IPO: PreStocks, one API call, priced from the issuer's own mark ---
  console.log("Pre-IPO:");
  const tokens = await fetchPreStocks();
  const wanted = new Set<string>(PRESTOCK_SYMBOLS);
  for (const token of tokens) {
    if (!wanted.has(token.symbol.toUpperCase())) continue;
    // Decimals off the chain — the trade path re-reads the full policy at quote
    // time; here it is only for display.
    let decimals = 9;
    try {
      decimals = (await readMintPolicy(token.mint)).decimals;
    } catch {
      // Keep the default; a decimals read failing should not drop the listing.
    }
    await upsert({
      symbol: token.symbol.toUpperCase(),
      name: token.name,
      mint: token.mint,
      decimals,
      kind: "prestock",
      price: token.tokenPrice,
      isPyth: false
    });
    count++;
  }

  console.log(`\nSeeded ${count} markets.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
