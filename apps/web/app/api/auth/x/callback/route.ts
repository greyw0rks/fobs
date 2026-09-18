import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, createSession, sessionCookieOptions, sessionExpiry } from "@/lib/server/session";
import { clearFlowCookies, exchangeCode, readFlowCookies, xConfigured } from "@/lib/server/x-oauth";

export const dynamic = "force-dynamic";

/**
 * Complete X sign-in: code → profile → FOBS identity → session.
 *
 * "Signing in with X" here means creating a *real FOBS account*: a user row,
 * and the onboarding step that connects a wallet. A user exists from the moment
 * X identifies them, before they have a wallet — that is why
 * `User.walletAddress` is nullable. Landing on the feed without one is fine; the
 * first trade is what requires it.
 *
 * Username collisions are resolved rather than rejected: X usernames are unique
 * but a FOBS username may already be taken by an account that arrived another
 * way, and failing the sign-in would be a dead end.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  if (!xConfigured()) {
    return NextResponse.redirect(new URL("/sign-in?reason=unconfigured", origin));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  if (denied) {
    // The user pressed Cancel on X's consent screen. Not an error worth a stack.
    const back = new URL("/sign-in", origin);
    back.searchParams.set("reason", "denied");
    return NextResponse.redirect(back);
  }

  const { verifier, state: expectedState } = await readFlowCookies();
  await clearFlowCookies();

  // A missing verifier means the flow cookie expired or never existed; a state
  // mismatch means this callback did not originate from a flow we started.
  if (!code || !verifier || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/sign-in?reason=invalid_request", origin));
  }

  try {
    const profile = await exchangeCode({ code, verifier });

    const existing = await prisma.user.findUnique({ where: { xUserId: profile.id } });
    const user =
      existing ??
      (await prisma.user.create({
        data: {
          xUserId: profile.id,
          username: await availableUsername(profile.username),
          displayName: profile.name,
          avatar: profile.avatar
        }
      }));

    // A returning user may have changed their name or avatar on X; their
    // walletAddress and follow graph are untouched.
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { displayName: profile.name, avatar: profile.avatar }
      });
    }

    // Deliberately no wallet creation here.
    //
    // This used to call `ensureWallet` inline, which meant a keypair the server
    // controls was generated as a silent side effect of signing in — before the
    // user had been told anything about custody, devnet, or what the wallet is
    // for. Creating it now happens on `/welcome`, behind a button the user
    // presses after reading what will exist. A user who never presses it is a
    // user with no wallet, which is a legible state, and the first trade still
    // calls `ensureWallet` — so the cost of skipping the page is one extra step
    // later, not a broken account.
    const sessionId = await createSession(user.id);
    const destination = user.walletAddress ? "/feed" : "/welcome";
    const response = NextResponse.redirect(new URL(destination, origin));
    response.cookies.set(
      SESSION_COOKIE,
      sessionId,
      sessionCookieOptions(sessionExpiry())
    );
    return response;
  } catch (error) {
    console.error("X sign-in failed", error);
    const back = new URL("/sign-in", origin);
    back.searchParams.set("reason", "exchange_failed");
    return NextResponse.redirect(back);
  }
}

/** `alice`, then `alice-2`, `alice-3`… until one is free. */
async function availableUsername(preferred: string): Promise<string> {
  const base =
    preferred
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 24) || "user";

  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const taken = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true }
    });
    if (!taken) return candidate;
  }
  // Effectively unreachable; a random suffix keeps sign-in working rather than
  // failing the request outright.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
