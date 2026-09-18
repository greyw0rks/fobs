import { NextResponse } from "next/server";
import { getWalletBalances } from "@/lib/server/balances";
import { currentUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's own wallet balances.
 *
 * Only ever their own: the address is read from the session, never from the
 * request. A route that took an address would be a public balance lookup for
 * every wallet in the deployment.
 *
 * This exists so the trade panel can re-read its balance after a trade without
 * a full page reload. A balance read once at page load would be wrong the moment
 * a trade filled, and a wrong balance is what disables the button for a trade
 * that would have worked.
 */
export async function GET() {
  const viewer = await currentUser();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const balances = await getWalletBalances(viewer.walletAddress);
  return NextResponse.json(
    { address: viewer.walletAddress, balances },
    { headers: { "cache-control": "no-store" } }
  );
}
