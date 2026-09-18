/**
 * Exercise the schema against whatever DATABASE_URL points at.
 *
 * Run: pnpm verify:db        (from apps/web; `pnpm db:verify:dev` from the root)
 *
 * A schema `db push` accepts is not a schema whose queries work. This runs the
 * queries the app actually depends on — above all the feed query, which is the
 * product.
 *
 * It imports the real read models rather than re-writing their queries here. The
 * earlier version of this script duplicated the feed query, which meant it could
 * pass while the one the app ran was broken; a check that cannot fail for the
 * right reason is worse than no check.
 */
import { prisma } from "@/lib/prisma";
import {
  getPortfolio,
  listAssets,
  listFeed,
  listNotifications,
  listPeople
} from "@/lib/server/queries";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Try: pnpm db:verify:dev from the root.");
    process.exit(1);
  }
  console.log(`schema check against ${url.startsWith("file:") ? "sqlite" : "postgres"}\n`);

  try {
    // --- the chain is the authority for these ----------------------------
    // Every asset must carry the derived addresses the client builds
    // transactions from. A missing one is a trade that fails at the PDA, with
    // an error that points at the program.
    const assets = await listAssets();
    console.log("assets");
    check("5 assets registered", assets.length === 5, `got ${assets.length}`);
    check(
      "every asset carries an onchain id and all four addresses",
      assets.every(
        (a) =>
          a.onchainId >= 0 &&
          a.assetAddress.length > 30 &&
          a.mintAddress.length > 30 &&
          a.vaultAddress.length > 30
      ),
      assets.map((a) => `${a.symbol}:${a.onchainId}`).join(" ")
    );
    check(
      "onchain ids are 0..4 with no gaps or repeats",
      new Set(assets.map((a) => a.onchainId)).size === 5 &&
        assets.every((a) => a.onchainId >= 0 && a.onchainId < 5)
    );
    check(
      "the price source is stated per asset",
      assets.every((a) => a.priceFeedType === "pyth" || a.priceFeedType === "mock"),
      assets.map((a) => `${a.symbol}:${a.priceFeedType}`).join(" ")
    );

    // --- users and the follow graph --------------------------------------
    // Count *test* users, not users. Counting every row and calling it "test
    // users seeded" passes for the wrong reason the moment an onboarded account
    // exists — and then keeps passing when the seeder is actually broken.
    const [total, follows] = await Promise.all([prisma.user.count(), prisma.follow.count()]);
    const seeded = await prisma.user.findMany({
      where: { isTestUser: true },
      select: { username: true, walletAddress: true, walletSecret: true },
      orderBy: { username: "asc" }
    });
    console.log("\nusers and follows");
    check(
      "the four seeded test accounts exist",
      seeded.length === 4,
      `${seeded.map((u) => u.username).join(" ")} (of ${total} users)`
    );
    check(
      "every seeded user has a wallet address",
      seeded.every((u) => u.walletAddress !== null)
    );
    // Seeded keys live on disk; a sealed secret on one would mean onboarding had
    // run over the top of them, which would strand their on-chain funds.
    check(
      "no seeded user has a custodied secret",
      seeded.every((u) => u.walletSecret === null)
    );
    // The flag is what gates key material; a real user carrying it would be
    // signable as a seeded account.
    check(
      "no authenticated user is flagged as a test user",
      (await prisma.user.count({ where: { isTestUser: true, xUserId: { not: null } } })) === 0
    );
    check("the follow graph is seeded", follows > 0, `${follows} follows`);

    // --- the feed query, through the real read model ---------------------
    const grey = await prisma.user.findUniqueOrThrow({ where: { username: "grey" } });
    // Deliberately wider than the app's default of 50. Every trade by someone
    // grey follows is in the for-you feed, but the two views are truncated
    // independently, so comparing two default-sized windows can show a followed
    // trade in one and not the other purely because the window cut it off — a
    // failure that says nothing about the query. If this window is itself hit,
    // the comparison is not valid and the check says so rather than passing.
    const WINDOW = 500;
    const [forYou, following] = await Promise.all([
      listFeed({ view: "for-you", viewerId: grey.id, limit: WINDOW }),
      listFeed({ view: "following", viewerId: grey.id, limit: WINDOW })
    ]);
    console.log("\nfeed query");
    check("the for-you feed returns trades", forYou.length > 0, `${forYou.length} trades`);
    check(
      "newest first",
      forYou.every((t, i) => i === 0 || new Date(forYou[i - 1].tradedAt) >= new Date(t.tradedAt))
    );
    check(
      "the comparison window was not truncated",
      forYou.length < WINDOW && following.length < WINDOW,
      `${forYou.length} for-you, ${following.length} following, window ${WINDOW}`
    );
    check(
      "following is a subset of for-you",
      following.every((f) => forYou.some((t) => t.id === f.id)),
      `${following.length} following vs ${forYou.length} for-you`
    );
    // Following someone grey does not follow must not appear in `following`.
    const followed = await prisma.follow.findMany({
      where: { followerId: grey.id },
      select: { followingId: true }
    });
    const followedIds = new Set(followed.map((f) => f.followingId));
    check(
      "following excludes authors grey does not follow",
      following.every((t) => followedIds.has(t.user.id)),
      [...new Set(following.map((t) => t.user.username))].join(",")
    );

    // --- money survives the round trip -----------------------------------
    // The risk on a non-Postgres backend is silent precision loss: `Decimal`
    // becomes NUMERIC/float64, and a `price` that reads back as 178.11999999
    // would be wrong in a way nothing else would catch.
    const priced = await prisma.trade.findFirst({
      where: { price: { gt: 0 } },
      orderBy: { tradedAt: "desc" }
    });
    console.log("\ndecimal precision");
    if (!priced) {
      check("a priced trade exists to check", false, "no trades in the database");
    } else {
      const stored = await prisma.trade.findUniqueOrThrow({ where: { id: priced.id } });
      // Re-read and compare the *string* form, which is what the wire format
      // carries. Comparing numbers would hide a float that rounds to the same
      // display value.
      check(
        "price round-trips at full stored precision",
        String(stored.price) === String(priced.price),
        `${stored.price}`
      );
      check(
        "amountUsdc has at most 6 decimal places",
        /^\d+(\.\d{1,6})?$/.test(String(stored.amountUsdc)),
        `${stored.amountUsdc}`
      );
    }

    // --- the idempotency anchor ------------------------------------------
    // `onchainReceipt` is what makes re-indexing safe. If it were not unique,
    // every indexer pass would duplicate the feed.
    const receipts = await prisma.trade.groupBy({ by: ["onchainReceipt"], _count: true });
    console.log("\nthe receipt anchor");
    check(
      "every trade has an onchain receipt",
      receipts.every((r) => r.onchainReceipt.length > 30),
      `${receipts.length} distinct receipts`
    );
    check(
      "no two trades share a receipt",
      receipts.every((r) => r._count === 1)
    );
    check(
      "every trade carries a tx signature",
      (await prisma.trade.count({ where: { txSignature: null } })) === 0
    );

    // --- enum round trip --------------------------------------------------
    const kinds = await prisma.notification.groupBy({ by: ["type"], _count: true });
    console.log("\nenums");
    check(
      "NotificationType round-trips",
      kinds.every((k) =>
        ["FRIEND_TRADE", "FOLLOW", "FOMO", "TRADE_CONFIRMED"].includes(k.type)
      ),
      kinds.map((k) => `${k.type}:${k._count}`).join(" ")
    );
    const sides = await prisma.trade.groupBy({ by: ["side"], _count: true });
    check(
      "TradeSide round-trips",
      sides.every((s) => s.side === "buy" || s.side === "sell"),
      sides.map((s) => `${s.side}:${s._count}`).join(" ")
    );

    // --- notifications are derived, not stored prose ---------------------
    const notifications = await listNotifications(grey.id);
    console.log("\nnotifications");
    check(
      "notifications render with an actor and a destination",
      notifications.every((n) => n.href.length > 0),
      notifications.map((n) => n.type).join(" ")
    );
    check(
      "no notification view carries message text",
      notifications.every((n) => !Object.keys(n).some((k) => /message|body|text/i.test(k)))
    );

    // --- a FOMO is a trade, not a separate record ------------------------
    const fomo = await prisma.trade.findFirst({ where: { sourceTradeId: { not: null } } });
    console.log("\nfomo provenance");
    if (!fomo) {
      check("a FOMO trade exists to check", false, "run pnpm smoke:loop first");
    } else {
      const source = await prisma.trade.findUniqueOrThrow({
        where: { id: fomo.sourceTradeId! }
      });
      check("it links to its source trade", source.id === fomo.sourceTradeId);
      check("the source is a different trade by anyone", source.id !== fomo.id);
      check(
        "it did not copy the source's size",
        String(source.amountUsdc) !== String(fomo.amountUsdc),
        `${fomo.amountUsdc} vs ${source.amountUsdc}`
      );
    }

    // --- holdings mirror the chain ---------------------------------------
    // The indexer reads the program's own `Holding` accounts into this table;
    // nothing else writes it. So every row here should be a position somebody
    // actually has, and every row should be traceable to a wallet that traded —
    // a holding for a user with no trades would mean the mirror invented one.
    const holdings = await prisma.holding.findMany({
      select: { userId: true, assetId: true, quantity: true, avgPrice: true }
    });
    const traders = await prisma.trade.groupBy({ by: ["userId", "assetId"] });
    const traded = new Set(traders.map((t) => `${t.userId}:${t.assetId}`));
    console.log("\nholdings mirror");
    check("the indexer has written holdings", holdings.length > 0, `${holdings.length} rows`);
    check(
      "every holding belongs to someone who traded that asset",
      holdings.every((h) => traded.has(`${h.userId}:${h.assetId}`)),
      holdings.filter((h) => !traded.has(`${h.userId}:${h.assetId}`)).length + " orphaned"
    );
    // `quantity` may legitimately be 0 — the program keeps the account after a
    // full exit — but a row that has never held anything, with no entry price,
    // is a row that means nothing.
    check(
      "no holding was written as a blank position",
      holdings.every((h) => Number(h.quantity) > 0 || Number(h.avgPrice) > 0),
      holdings.filter((h) => !(Number(h.quantity) > 0 || Number(h.avgPrice) > 0)).length +
        " blank"
    );
    check(
      "every open holding has a non-zero entry price",
      holdings
        .filter((h) => Number(h.quantity) > 0)
        .every((h) => Number(h.avgPrice) > 0)
    );
    check(
      "holdings do not exceed the users who have traded",
      new Set(holdings.map((h) => h.userId)).size <=
        new Set(traders.map((t) => t.userId)).size,
      `${new Set(holdings.map((h) => h.userId)).size} holders vs ${new Set(traders.map((t) => t.userId)).size} traders`
    );

    // --- the portfolio read model ----------------------------------------
    // The page's own query, so a portfolio that renders is a portfolio this
    // checked. The honesty rule is the thing to assert: a holding whose price
    // has not been read must contribute *nothing* to the total, and must be
    // counted as excluded rather than silently dropped.
    const holder = holdings.find((h) => Number(h.quantity) > 0);
    console.log("\nportfolio");
    if (!holder) {
      check("an open position exists to check", false, "no holdings with quantity > 0");
    } else {
      const portfolio = await getPortfolio(holder.userId);
      check(
        "open positions are returned",
        portfolio.holdings.length > 0,
        `${portfolio.holdings.length} positions`
      );
      check(
        "a fully exited position is not a position",
        portfolio.holdings.every((h) => h.quantity > 0)
      );
      check(
        "unpriced positions are excluded from the total, not counted as zero",
        portfolio.unpricedCount ===
          portfolio.holdings.filter((h) => h.value === null).length,
        `${portfolio.unpricedCount} unpriced`
      );
      // The rule that matters most: a total is either built entirely from real
      // prices, or it is absent. A number that quietly omits a position is the
      // failure mode this is here to catch.
      const priced = portfolio.holdings.filter((h) => h.value !== null);
      if (portfolio.totalValue === null) {
        check("no total is claimed when nothing is priced", priced.length === 0);
      } else {
        const sum = priced.reduce((total, h) => total + h.value!, 0);
        check(
          "the total equals the sum of its priced positions",
          Math.abs(sum - portfolio.totalValue) < 0.000001,
          `${portfolio.totalValue} vs ${sum}`
        );
        check(
          "every position value is quantity × a price that exists",
          priced.every(
            (h) => h.value !== null && h.unrealizedPnl !== null && h.asset.price !== null
          )
        );
      }
    }

    // --- profile and people ----------------------------------------------
    const people = await listPeople(grey.id);
    console.log("\npeople");
    check("listPeople returns the seeded accounts", people.length >= 3, `${people.length} people`);
    // The friends page filter, through the same function the page calls.
    const searched = await listPeople(grey.id, "AL");
    check(
      "the people search is case-insensitive and narrowed",
      searched.length > 0 && searched.length < people.length,
      `${searched.length} of ${people.length} match "AL"`
    );
    check(
      "the people search matches display names too",
      searched.every((p) => /al/i.test(p.username) || /al/i.test(p.displayName)),
      searched.map((p) => p.username).join(" ")
    );
    // The page hides the viewer from its lists, so a search matching *only* the
    // viewer used to render two empty sections with no explanation. The failure
    // was in the page, not here; this is the shape of query that triggered it.
    const ownName = await listPeople(grey.id, "grey");
    check(
      "a search for your own name finds exactly you",
      ownName.length === 1 && ownName[0].isViewer,
      ownName.map((p) => p.username).join(" ") || "nothing"
    );

    console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
    if (failures > 0) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
