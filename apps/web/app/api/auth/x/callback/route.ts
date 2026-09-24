import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, createSession, sessionCookieOptions, sessionExpiry } from "@/lib/server/session";
import { displayNameForAddress } from "@/lib/server/wallet-auth";
import { availableUsername } from "@/lib/server/username";
import { clearFlowCookies, exchangeCode, readFlowCookies, xConfigured } from "@/lib/server/x-oauth";
import { publicOrigin } from "@/lib/server/base-url";

export const dynamic = "force-dynamic";

/**
 * Complete X sign-in: code → profile → FOBS identity → session.
 *
 * "Signing in with X" here means creating a *real FOBS account*: a user row.
 * A user exists from the moment X identifies them, before they have a wallet —
 * that is why `User.walletAddress` is nullable. Landing on the feed without one
 * is fine; trading requires connecting a wallet, because a trade is a swap that
 * wallet signs and FOBS holds no key of its own.
 *
 * Two flows arrive here, distinguished by the intent the start route stashed in
 * the flow cookie (see `oauth-intent.ts`):
 *
 *   - **sign-in** resolves an X identity to a FOBS account and opens a session.
 *   - **link** attaches the X identity to the account already signed in. This is
 *     what makes linking different from switching: the session that exists
 *     survives, and the identity is added to it rather than replacing it.
 *
 * Username collisions are resolved rather than rejected: X usernames are unique
 * but a FOBS username may already be taken by an account that arrived another
 * way, and failing the sign-in would be a dead end.
 */
export async function GET(request: Request) {
  const origin = publicOrigin(request);

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

  const { verifier, state: expectedState, intent } = await readFlowCookies();
  await clearFlowCookies();

  // A missing verifier means the flow cookie expired or never existed; a state
  // mismatch means this callback did not originate from a flow we started. An
  // absent intent means the same cookie jar lost track of why we left, and
  // defaulting it would be the guess this design exists to avoid.
  if (!code || !verifier || !state || state !== expectedState || !intent) {
    return NextResponse.redirect(new URL("/sign-in?reason=invalid_request", origin));
  }

  try {
    const profile = await exchangeCode({ code, verifier });

    if (intent.kind === "link") {
      return await linkToExistingAccount({ profile, intent, origin });
    }

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

    // No wallet is created here — or anywhere. FOBS holds no key: a trade is a
    // swap the user's own wallet signs, so signing in only ever creates an
    // identity. A user with no wallet is a legible state; `/welcome` points them
    // at connecting one when they want to trade.
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

/**
 * Attach an X identity to the account that is already signed in.
 *
 * The three refusals here are all the same collision seen from different sides,
 * and each gets its own reason code so the account page can say which happened:
 *
 *   - the X account already belongs to **this** user — nothing to do, not an error;
 *   - the X account belongs to **someone else** — the interesting case, and the
 *     one worth a clear sentence rather than a silent merge of two accounts;
 *   - the signed-in user already has a **different** X account linked.
 *
 * No session is created or rotated: the user is already signed in, and issuing a
 * fresh session on a linking callback would hand a new cookie to whoever
 * followed the redirect.
 */
async function linkToExistingAccount({
  profile,
  intent,
  origin
}: {
  profile: { id: string; username: string; name: string; avatar: string | null };
  intent: { kind: "link"; userId: string };
  origin: string;
}): Promise<NextResponse> {
  const account = new URL("/account", origin);

  const [target, owner] = await Promise.all([
    prisma.user.findUnique({
      where: { id: intent.userId },
      select: { id: true, xUserId: true, displayName: true, walletAddress: true }
    }),
    prisma.user.findUnique({
      where: { xUserId: profile.id },
      select: { id: true }
    })
  ]);

  if (!target) {
    account.searchParams.set("link", "session_expired");
    return NextResponse.redirect(account);
  }
  if (owner && owner.id !== target.id) {
    account.searchParams.set("link", "x_already_linked_elsewhere");
    return NextResponse.redirect(account);
  }
  if (target.xUserId && target.xUserId !== profile.id) {
    account.searchParams.set("link", "x_slot_taken");
    return NextResponse.redirect(account);
  }

  await prisma.user.update({
    where: { id: target.id },
    data: {
      xUserId: profile.id,
      // The avatar is safe to refresh unconditionally — it is the X account's
      // own picture, and this is now the X account behind this user.
      avatar: profile.avatar,
      // The display name is only filled when it is still the placeholder derived
      // from the wallet address. A user who has since chosen their own name is
      // not silently renamed by linking an X account.
      ...(isPlaceholderName(target.displayName, target.walletAddress)
        ? { displayName: profile.name }
        : {})
    }
  });

  account.searchParams.set("link", "x_linked");
  return NextResponse.redirect(account);
}

/**
 * Is this display name still the one the system made up?
 *
 * A wallet-created account is named `displayNameForAddress` — `7xKX…9fQm`. That
 * is a placeholder, not a choice, so linking an identity that knows a real name
 * may replace it. Anything else was either typed by the user or came from another
 * provider, and is left alone.
 */
function isPlaceholderName(displayName: string, walletAddress: string | null): boolean {
  return walletAddress !== null && displayName === displayNameForAddress(walletAddress);
}

