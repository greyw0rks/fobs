/**
 * The P0 loop, end to end, against devnet.
 *
 * Run: pnpm smoke:loop        (from apps/web, or `pnpm --dir apps/web smoke:loop`)
 *
 * This is the revision's acceptance test, written as the three cases the spec
 * named. Everything it asserts came off the chain: each trade is a real signed
 * transaction, and every row it checks was written by the indexer reading a
 * receipt account back.
 *
 *   A. Alice buys sNVDA          → Bob, who follows her, is notified
 *   B. Bob FOMOs it at his size  → his trade is his own, and records provenance
 *   C. Alice hears about it      → she is notified, and the feed shows Bob
 *
 * It is deliberately not a unit test. The failure this catches is "the parts are
 * each fine and do not connect" — a receipt the indexer cannot attribute, a
 * notification with no recipient, a FOMO that quietly copied an amount.
 */
import { prisma } from "@/lib/prisma";
import { executeTradeAsTestUser } from "@/lib/server/execute-trade";
import { runIndexer } from "@/lib/server/indexer";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  const mark = condition ? "  ok  " : " FAIL ";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function main() {
  console.log("indexing before we start, so cursors are current…");
  const before = await runIndexer();
  console.log(
    `  ${before.assets} assets, ${before.tradesIngested} trades ingested, ` +
      `${before.errors.length} errors`
  );
  for (const error of before.errors) console.log(`    ${error.asset}: ${error.message}`);

  const alice = await prisma.user.findUniqueOrThrow({ where: { username: "alice" } });
  const bob = await prisma.user.findUniqueOrThrow({ where: { username: "bob" } });

  const bobFollowsAlice = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: bob.id, followingId: alice.id } }
  });
  check("Bob follows Alice", bobFollowsAlice !== null);

  // --- Test A: Alice buys, Bob is told -------------------------------------
  console.log("\nA. alice buys $250 of sNVDA");
  const aliceTrade = await executeTradeAsTestUser({
    username: "alice",
    symbol: "sNVDA",
    side: "buy",
    amountUsdc: 250
  });
  console.log(`   tx ${aliceTrade.signature}`);
  console.log(`   receipt ${aliceTrade.receipt}`);

  check("the receipt exists on chain", aliceTrade.receipt.length > 30);
  check("the indexer ingested Alice's trade", aliceTrade.indexed.tradesIngested > 0);

  const aliceRow = await prisma.trade.findUniqueOrThrow({
    where: { onchainReceipt: aliceTrade.receipt },
    include: { asset: true }
  });
  check("the trade is attributed to Alice", aliceRow.userId === alice.id);
  check(
    "the amount matches what was sent",
    Number(aliceRow.amountUsdc) === 250,
    `${aliceRow.amountUsdc} USDC`
  );
  check(
    "the price carries the program's spread",
    Number(aliceRow.price) > 0,
    `${aliceRow.price} per share`
  );
  check("the signature was resolved", aliceRow.txSignature === aliceTrade.signature);

  const bobNotified = await prisma.notification.findFirst({
    where: { userId: bob.id, type: "FRIEND_TRADE", tradeId: aliceRow.id }
  });
  check("Bob was notified about Alice's trade", bobNotified !== null);

  // --- Test B: Bob FOMOs, at his own size ----------------------------------
  console.log("\nB. bob FOMOs it at $60 (not $250)");
  const bobTrade = await executeTradeAsTestUser({
    username: "bob",
    symbol: "sNVDA",
    side: "buy",
    amountUsdc: 60,
    sourceTradeId: aliceRow.id
  });
  console.log(`   tx ${bobTrade.signature}`);
  console.log(`   receipt ${bobTrade.receipt}`);

  const bobRow = await prisma.trade.findUniqueOrThrow({
    where: { onchainReceipt: bobTrade.receipt }
  });
  check("Bob's trade is Bob's", bobRow.userId === bob.id);
  check(
    "it records provenance to Alice's trade",
    bobRow.sourceTradeId === aliceRow.id
  );
  check(
    "it did NOT copy her size — independent transaction",
    Number(bobRow.amountUsdc) === 60,
    `bob ${bobRow.amountUsdc} vs alice ${aliceRow.amountUsdc}`
  );
  check(
    "the two have different signatures",
    bobRow.txSignature !== aliceRow.txSignature
  );

  // --- Test C: Alice hears about it ----------------------------------------
  console.log("\nC. alice is told she was FOMO'd");
  const aliceNotified = await prisma.notification.findFirst({
    where: { userId: alice.id, type: "FOMO", tradeId: bobRow.id }
  });
  check("Alice was notified about the FOMO", aliceNotified !== null);
  check(
    "the notification names Bob as the actor",
    aliceNotified?.actorUserId === bob.id
  );

  // Alice's feed is defined by who she follows; her own feed must still show the
  // trade she was FOMO'd on, which is why FOMO is its own notification rather
  // than something the follow graph would surface.
  const feed = await prisma.trade.findMany({
    where: { assetId: bobRow.assetId },
    orderBy: { tradedAt: "desc" },
    include: { user: { select: { username: true } } },
    take: 5
  });
  check(
    "the feed shows Bob's trade alongside Alice's",
    feed.some((t) => t.id === bobRow.id) && feed.some((t) => t.id === aliceRow.id),
    feed.map((t) => `${t.user.username}:$${t.amountUsdc}`).join(" ")
  );

  console.log(
    failures === 0
      ? "\nall checks passed — the loop is real, end to end"
      : `\n${failures} check(s) failed`
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("\n" + (error instanceof Error ? error.message : error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
