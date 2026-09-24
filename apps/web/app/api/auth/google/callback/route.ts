import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, createSession, sessionCookieOptions, sessionExpiry } from "@/lib/server/session";
import { availableUsername } from "@/lib/server/username";
import { displayNameForAddress } from "@/lib/server/wallet-auth";
import { clearFlowCookies, exchangeCode, googleConfigured, readFlowCookies } from "@/lib/server/google-oauth";
import { publicOrigin } from "@/lib/server/base-url";

export const dynamic = "force-dynamic";

/**
 * Complete Google sign-in. The mirror of the X callback, including the two
 * intents (`sign-in` opens a session, `link` attaches to the signed-in account)
 * and the same custom-session-on-sign-in-only rule.
 *
 * One thing this deliberately does **not** do: match an existing account by
 * email address.
 *
 * Google verifies emails, so "same email therefore same person" is tempting. But
 * FOBS accounts also arrive from X — which, with `users.read`/`tweet.read`
 * scopes, never gives us an email at all — and from wallets, which have none.
 * So email matching would create a one-way merge: a Google sign-in could seize
 * an X-created account, while the reverse could never happen. Silent account
 * takeover is a worse failure than a duplicate account, and the duplicate is
 * visible and fixable from `/account` by linking. So: new identity, new account.
 */
export async function GET(request: Request) {
  const origin = publicOrigin(request);

  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/sign-in?reason=google_unconfigured", origin));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  if (denied) {
    const back = new URL("/sign-in", origin);
    back.searchParams.set("reason", "denied");
    return NextResponse.redirect(back);
  }

  const { verifier, state: expectedState, intent } = await readFlowCookies();
  await clearFlowCookies();

  if (!code || !verifier || !state || state !== expectedState || !intent) {
    return NextResponse.redirect(new URL("/sign-in?reason=invalid_request", origin));
  }

  try {
    const profile = await exchangeCode({ code, verifier });

    if (intent.kind === "link") {
      return await linkToExistingAccount({ profile, intent, origin });
    }

    const existing = await prisma.user.findUnique({ where: { googleId: profile.id } });
    const user =
      existing ??
      (await prisma.user.create({
        data: {
          googleId: profile.id,
          // The email's local part makes a more username-shaped default than the
          // display name — "grey" from grey@… rather than "Grey" the person.
          username: await availableUsername(
            profile.email?.split("@")[0] || profile.name || "user"
          ),
          displayName: profile.name,
          avatar: profile.avatar
        }
      }));

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { displayName: profile.name, avatar: profile.avatar }
      });
    }

    // No wallet creation here either — see the long note in the X callback.
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
    console.error("Google sign-in failed", error);
    const back = new URL("/sign-in", origin);
    back.searchParams.set("reason", "exchange_failed");
    return NextResponse.redirect(back);
  }
}

/**
 * Attach a Google identity to the account that is already signed in. The same
 * three collisions the X callback handles, reported with Google-shaped reasons.
 */
async function linkToExistingAccount({
  profile,
  intent,
  origin
}: {
  profile: { id: string; name: string; avatar: string | null };
  intent: { kind: "link"; userId: string };
  origin: string;
}): Promise<NextResponse> {
  const account = new URL("/account", origin);

  const [target, owner] = await Promise.all([
    prisma.user.findUnique({
      where: { id: intent.userId },
      select: { id: true, googleId: true, displayName: true, walletAddress: true }
    }),
    prisma.user.findUnique({ where: { googleId: profile.id }, select: { id: true } })
  ]);

  if (!target) {
    account.searchParams.set("link", "session_expired");
    return NextResponse.redirect(account);
  }
  if (owner && owner.id !== target.id) {
    account.searchParams.set("link", "google_already_linked_elsewhere");
    return NextResponse.redirect(account);
  }
  if (target.googleId && target.googleId !== profile.id) {
    account.searchParams.set("link", "google_slot_taken");
    return NextResponse.redirect(account);
  }

  await prisma.user.update({
    where: { id: target.id },
    data: {
      googleId: profile.id,
      avatar: profile.avatar,
      // Only replace a display name that is still the wallet placeholder — the
      // same rule, and the same reason, as the X callback.
      ...(isPlaceholderName(target.displayName, target.walletAddress)
        ? { displayName: profile.name }
        : {})
    }
  });

  account.searchParams.set("link", "google_linked");
  return NextResponse.redirect(account);
}

function isPlaceholderName(displayName: string, walletAddress: string | null): boolean {
  return walletAddress !== null && displayName === displayNameForAddress(walletAddress);
}
