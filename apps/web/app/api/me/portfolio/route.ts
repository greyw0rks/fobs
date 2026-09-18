import { NextResponse } from "next/server";
import { getPortfolio } from "@/lib/server/queries";
import { getWalletBalances } from "@/lib/server/balances";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's own positions.
 *
 * Always their own — the id comes from the session, never from the request, so
 * there is no parameter that could be pointed at someone else.
 *
 * The page renders this query directly on the server, so this route is not what
 * the portfolio page uses. It exists because the rehearsal needs to assert what
 * happened to a position after a trade, and the alternative was asserting it
 * against Postgres directly, which would skip the read model the page actually
 * renders.
 */
export async function GET() {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [portfolio, balances] = await Promise.all([
    getPortfolio(viewer.id),
    getWalletBalances(viewer.walletAddress)
  ]);

  return NextResponse.json(
    { portfolio, balances },
    { headers: { "cache-control": "no-store" } }
  );
}
