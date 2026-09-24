import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import type { OAuthIntent } from "@/lib/server/oauth-intent";
import { authorizeStart, storeFlowCookies, xConfigured } from "@/lib/server/x-oauth";
import { publicOrigin } from "@/lib/server/base-url";

export const dynamic = "force-dynamic";

/**
 * Start the X sign-in flow.
 *
 * When X is not configured this does not silently return a fake identity the
 * way the old demo route did — it sends you to the sign-in page, which decides
 * what to offer. That keeps "X is not configured" a visible state rather than an
 * invisibly degraded one.
 *
 * `?link=1` switches the flow from "sign in as whoever X says" to "attach this X
 * account to the person already signed in". The user id comes from the session
 * cookie, never from the query string: a caller who could name the account to
 * attach to could attach their own X account to somebody else's FOBS account.
 * Asking to link without a session is refused rather than quietly downgraded to
 * a sign-in, because the user asked for the opposite of that.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);

  if (!xConfigured()) {
    // Relative to the request, not a hard-coded host: the app runs on a dev
    // server, a tunnel and a deployed origin, and guessing wrong here sends the
    // user somewhere that does not exist.
    const back = new URL("/sign-in", origin);
    back.searchParams.set("reason", "unconfigured");
    return NextResponse.redirect(back);
  }

  let intent: OAuthIntent = { kind: "sign-in" };
  if (url.searchParams.get("link") === "1") {
    const viewer = await currentUser();
    if (!viewer) {
      const back = new URL("/sign-in", origin);
      back.searchParams.set("reason", "link_requires_session");
      return NextResponse.redirect(back);
    }
    intent = { kind: "link", userId: viewer.id };
  }

  const flow = authorizeStart(intent);
  await storeFlowCookies(flow);
  return NextResponse.redirect(flow.url);
}
