import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import type { OAuthIntent } from "@/lib/server/oauth-intent";
import { authorizeStart, googleConfigured, storeFlowCookies } from "@/lib/server/google-oauth";
import { publicOrigin } from "@/lib/server/base-url";

export const dynamic = "force-dynamic";

/**
 * Start the Google sign-in flow. The mirror of `app/api/auth/x/route.ts`, and
 * the reasoning there applies unchanged: `?link=1` attaches the identity to the
 * signed-in account, the user id comes from the session rather than the query
 * string, and asking to link without a session is refused rather than quietly
 * downgraded to a sign-in.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);

  if (!googleConfigured()) {
    const back = new URL("/sign-in", origin);
    back.searchParams.set("reason", "google_unconfigured");
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
