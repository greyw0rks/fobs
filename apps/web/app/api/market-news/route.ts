import { NextResponse } from "next/server";
import { getMarketNews } from "@/lib/server/market-news";
import { currentUser } from "@/lib/server/session";
import { RULES, enforce } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Market news for the homepage panel.
 *
 * A read, but one that fans out to an external vendor, so it is rate-limited like
 * the writes — charged to the signed-in user when there is one, the IP otherwise
 * (`enforce`). The heavy lifting and the vendor-protecting cache live in
 * `getMarketNews`; this handler is the boundary and the quota.
 */
export async function GET(request: Request) {
  const viewer = await currentUser();

  const limited = enforce(request, viewer?.id ?? null, RULES.news);
  if (limited) return limited;

  return NextResponse.json(await getMarketNews());
}
