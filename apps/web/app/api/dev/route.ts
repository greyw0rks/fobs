import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { indexAsset, indexerStatus, runIndexer } from "@/lib/server/indexer";
import { executeTradeAsTestUser } from "@/lib/server/execute-trade";
import { subscriberCount } from "@/lib/server/events";
import { devSignInAllowed } from "@/lib/server/x-oauth";
import { currentUser } from "@/lib/server/session";
import { RULES, enforce } from "@/lib/server/rate-limit";
import { TestSigningDisabledError, testUsers } from "@/lib/server/test-users";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The /dev harness API.
 *
 * One endpoint with an explicit `action`, rather than a route per button: every
 * operation here is a maintenance action on the test environment, and they share
 * the same precondition (this must not be a production deployment) and the same
 * failure mode. Splitting them into five routes would duplicate that guard five
 * times and make it five places to get wrong.
 *
 * Guarded by the same rule as test-user signing, so a production build cannot
 * reach any of it.
 */

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("status") }),
  z.object({
    action: z.literal("seed"),
    trades: z
      .array(
        z.object({
          username: z.string(),
          symbol: z.string(),
          side: z.enum(["buy", "sell"]),
          amountUsdc: z.number().positive().max(100_000)
        })
      )
      .min(1)
      .max(8)
  }),
  z.object({
    action: z.literal("index-one"),
    assetId: z.string()
  })
]);

export async function POST(request: Request) {
  if (!devSignInAllowed()) {
    return NextResponse.json(
      { error: "The dev harness is disabled on this deployment." },
      { status: 403 }
    );
  }

  // A session is required on top of the deployment guard. The guard alone makes
  // this an open "sign a transaction as any seeded account" endpoint on any
  // non-production host, which is a different thing from an open *demo* — the
  // `seed` action spends the admin's SOL and there is no bound on how often.
  //
  // This is a bar-raiser, not authorisation, and it is worth being precise about
  // which: any signed-in account can drive the harness, because on a deployment
  // where `devSignInAllowed()` is true there are no real accounts to protect and
  // the operator's own login is one of the seeded ones. The real fix, if this
  // ever ran somewhere with real users, is an operator allowlist — and at that
  // point the whole harness should be off instead.
  const viewer = await currentUser();
  if (!viewer) {
    return NextResponse.json(
      { error: "Sign in before using the dev harness." },
      { status: 401 }
    );
  }

  const limited = enforce(request, viewer.id, RULES.dev);
  if (limited) return limited;

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    switch (parsed.data.action) {
      case "refresh": {
        const result = await runIndexer();
        return NextResponse.json({ result, status: await status() });
      }

      case "status":
        return NextResponse.json({ status: await status() });

      case "index-one": {
        const result = await indexAsset(parsed.data.assetId);
        return NextResponse.json({ result, status: await status() });
      }

      case "seed": {
        // Sequential, not parallel: these are real transactions from distinct
        // wallets against the public devnet RPC, which rate-limits bursts. The
        // point of seeding is to produce trades the indexer can find, not to
        // finish quickly.
        const executed = [];
        for (const trade of parsed.data.trades) {
          const result = await executeTradeAsTestUser(trade);
          executed.push({ ...trade, signature: result.signature });
        }
        return NextResponse.json({ executed, status: await status() });
      }
    }
  } catch (error) {
    if (error instanceof TestSigningDisabledError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dev action failed" },
      { status: 502 }
    );
  }
}

async function status() {
  return {
    assets: await indexerStatus(),
    users: await testUsers().then((users) =>
      users.map((user) => ({
        username: user.username,
        displayName: user.displayName,
        walletAddress: user.walletAddress,
        tradeCount: user._count.trades
      }))
    ),
    trades: await prisma.trade.count(),
    notifications: await prisma.notification.count(),
    subscribers: subscriberCount()
  };
}
