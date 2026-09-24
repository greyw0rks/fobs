import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, createSession, currentUser, sessionCookieOptions, sessionExpiry } from "@/lib/server/session";
import { enforce, RULES } from "@/lib/server/rate-limit";
import { WalletTakenError, recordWallet } from "@/lib/server/wallets";
import { availableUsername } from "@/lib/server/username";
import {
  WalletChallengeError,
  displayNameForAddress,
  redeemChallenge,
  usernameForAddress
} from "@/lib/server/wallet-auth";

export const dynamic = "force-dynamic";

/**
 * Redeem a signed challenge — the second half of wallet sign-in, and of linking.
 *
 * What this route may do is decided entirely by the challenge it redeems, which
 * is why `purpose` and `userId` are read off the stored nonce rather than from
 * the request body. A caller cannot ask this endpoint to link a wallet to an
 * account by saying so; the only way to get a `link` challenge is to have been
 * signed in when it was issued, and the only way to redeem it is to control the
 * key. Both facts are established before this function reads a byte of the body.
 *
 * Sign-in creates an account when the address is new. Linking never does — a
 * wallet being linked is by definition attached to an account that already
 * exists, and creating one would be the account-switching this is meant to
 * replace.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    nonce?: unknown;
    address?: unknown;
    signature?: unknown;
    label?: unknown;
  };

  const viewer = await currentUser();
  const limited = enforce(request, viewer?.id ?? null, RULES.dev);
  if (limited) return limited;

  if (
    typeof body.nonce !== "string" ||
    typeof body.address !== "string" ||
    typeof body.signature !== "string"
  ) {
    return NextResponse.json(
      { error: "`nonce`, `address` and `signature` are all required." },
      { status: 400 }
    );
  }

  let redeemed;
  try {
    redeemed = await redeemChallenge({
      nonce: body.nonce,
      address: body.address,
      signature: body.signature
    });
  } catch (error) {
    if (error instanceof WalletChallengeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const label = typeof body.label === "string" ? body.label.slice(0, 40) : null;

  try {
    if (redeemed.purpose === "link") {
      return await linkWallet({ redeemed, label });
    }
    return await signInWithWallet(redeemed.address);
  } catch (error) {
    if (error instanceof WalletTakenError) {
      return NextResponse.json(
        { error: error.message, code: "wallet_taken" },
        { status: 409 }
      );
    }
    throw error;
  }
}

/**
 * Attach an address to the account that asked for the challenge.
 *
 * The signed-in user is re-read here rather than trusted from issue time: a
 * challenge lives five minutes, and a session revoked in between must not still
 * be able to link a wallet to the account it used to belong to.
 */
async function linkWallet({
  redeemed,
  label
}: {
  redeemed: { address: string; userId: string | null };
  label: string | null;
}): Promise<NextResponse> {
  const viewer = await currentUser();
  if (!viewer) {
    return NextResponse.json(
      { error: "Sign in before linking a wallet.", code: "link_requires_session" },
      { status: 401 }
    );
  }
  if (redeemed.userId !== viewer.id) {
    // The challenge was issued for a different account than the one now holding
    // the cookie. Refused rather than followed, because following it would move
    // a wallet between accounts on the strength of a cookie change.
    return NextResponse.json(
      { error: "That challenge was issued for a different account.", code: "link_wrong_account" },
      { status: 409 }
    );
  }

  // An external wallet becomes primary on link. Stated as a rule because "the
  // wallet you linked is the wallet you trade from" is predictable in a way a
  // conditional promotion would not be — and it is the only kind of wallet there
  // is now, since FOBS holds no key of its own.
  await recordWallet({
    userId: viewer.id,
    address: redeemed.address,
    source: "external",
    label,
    isPrimary: true
  });

  return NextResponse.json({ ok: true, address: redeemed.address, isPrimary: true });
}

/**
 * Resolve a proven address to a FOBS account, creating one if it is new.
 *
 * An address that already belongs to a user signs that user in without further
 * ceremony — the signature over our nonce is the whole proof, and it is a
 * stronger one than a password.
 */
async function signInWithWallet(address: string): Promise<NextResponse> {
  const existing = await prisma.wallet.findUnique({
    where: { address },
    select: { user: { select: { id: true, walletAddress: true } } }
  });
  const legacy = existing
    ? null
    : await prisma.user.findUnique({
        where: { walletAddress: address },
        select: { id: true, walletAddress: true }
      });

  const found = existing?.user ?? legacy;

  if (found) {
    // Backfill in passing: an address that predates the `Wallet` table gets its
    // row now, so linking a second wallet later cannot make this one invisible.
    await recordWallet({
      userId: found.id,
      address,
      source: "external",
      isPrimary: false
    });

    const sessionId = await createSession(found.id);
    return withSession(sessionId, found.walletAddress ? "/feed" : "/welcome");
  }

  const user = await prisma.user.create({
    data: {
      // The server never holds a key for this account: its key is in the user's
      // own wallet, and every trade it makes is signed in the browser.
      username: await availableUsername(usernameForAddress(address)),
      displayName: displayNameForAddress(address),
      walletAddress: address
    }
  });

  await recordWallet({
    userId: user.id,
    address,
    source: "external",
    isPrimary: true
  });

  const sessionId = await createSession(user.id);
  // Straight to onboarding: this account has a wallet but has not been told how
  // FOBS works, and `/welcome` is where that happens.
  return withSession(sessionId, "/welcome");
}

function withSession(sessionId: string, destination: string): NextResponse {
  const response = NextResponse.json({ ok: true, redirectTo: destination });
  response.cookies.set(SESSION_COOKIE, sessionId, sessionCookieOptions(sessionExpiry()));
  return response;
}
