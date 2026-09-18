import { NextResponse } from "next/server";
import { authorizeStart, storeFlowCookies, xConfigured } from "@/lib/server/x-oauth";

export const dynamic = "force-dynamic";

/**
 * Start the X sign-in flow.
 *
 * When X is not configured this does not silently return a fake identity the
 * way the old demo route did — it sends you to the sign-in page, which decides
 * what to offer. That keeps "X is not configured" a visible state rather than an
 * invisibly degraded one.
 */
export async function GET(request: Request) {
  if (!xConfigured()) {
    // Relative to the request, not a hard-coded host: the app runs on a dev
    // server, a tunnel and a deployed origin, and guessing wrong here sends the
    // user somewhere that does not exist.
    const back = new URL("/sign-in", new URL(request.url).origin);
    back.searchParams.set("reason", "unconfigured");
    return NextResponse.redirect(back);
  }

  const flow = authorizeStart();
  await storeFlowCookies(flow);
  return NextResponse.redirect(flow.url);
}
